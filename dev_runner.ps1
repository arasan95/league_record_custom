$ErrorActionPreference = "Stop"
$initialDir = Get-Location

try {
    Write-Host "Killing existing LeagueRecord processes (Force kill)..." -ForegroundColor Yellow
    cmd /c "taskkill /F /IM LeagueRecord.exe /T 2>NUL"
    cmd /c "taskkill /F /IM LeagueRecordx.exe /T 2>NUL"
    # Give OS a moment to release file handles
    Start-Sleep -Seconds 1

    # ---------------------------------------------------------
    # 1. Dev Server Check (Port 1420)
    # ---------------------------------------------------------
    $port = 1420
    $isDevServerRunning = $false
    try {
        # Check if something is listening on the port
        $tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop
        if ($tcp.State -eq 'Listen') {
            $isDevServerRunning = $true
        }
    }
    catch {
        # If Get-NetTCPConnection throws, it usually means no connection found
        $isDevServerRunning = $false
    }

    if (-not $isDevServerRunning) {
        Write-Host "Dev server (port $port) is not running. Starting 'bun run dev'..." -ForegroundColor Cyan
        # Start bun run dev in a new window so it stays alive
        Start-Process "bun" -ArgumentList "run dev" -WorkingDirectory $PSScriptRoot
        Write-Host "Waiting 5 seconds for dev server to verify..."
        Start-Sleep -Seconds 5
    }
    else {
        Write-Host "Dev server is already running on port $port." -ForegroundColor Green
    }

    # ---------------------------------------------------------
    # 2. Build Rust Binary (Cargo Build)
    # ---------------------------------------------------------
    # We use 'cargo build' instead of 'tauri build'. 
    # 'cargo build' creates a binary that respects tauri.conf.json 'devUrl', 
    # so it will connect to localhost:1420 (the dev server).
    Write-Host "Building Rust binary (Debug, custom target)..." -ForegroundColor Cyan
    
    # Clean up previous target_alt if needed to avoid stale locks? 
    # No, cargo usually handles incremental builds well.
    
    Set-Location "$PSScriptRoot/src-tauri"
    $env:CARGO_TARGET_DIR = "$PSScriptRoot/target_alt"

    # Run cargo build
    & cargo build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Cargo build failed with exit code $LASTEXITCODE"
        exit 1
    }

    # ---------------------------------------------------------
    # 3. Sandbox Setup
    # ---------------------------------------------------------
    Set-Location $PSScriptRoot
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $buildDir = "$PSScriptRoot/target_alt/debug"
    $sandboxDir = "$PSScriptRoot/run_sandbox/$timestamp"

    # Detect Exe Name:
    # Cargo usually names the binary after the package name in Cargo.toml.
    # We check for likely candidates.
    $exeCandidates = @("LeagueRecord.exe", "league_record_custom.exe", "app.exe")
    $exeName = $null
    foreach ($cand in $exeCandidates) {
        if (Test-Path "$buildDir/$cand") {
            $exeName = $cand
            break
        }
    }

    if ($null -eq $exeName) {
        Write-Error "Could not find compiled executable in $buildDir. Checked: $($exeCandidates -join ', ')"
        exit 1
    }

    Write-Host "Creating Sandbox: $sandboxDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $sandboxDir | Out-Null

    # Copy libobs dependencies if they exist (OBS plugin related)
    if (Test-Path "$buildDir/libobs") {
        Write-Host "Copying libobs..."
        Copy-Item -Recurse -Force "$buildDir/libobs" "$sandboxDir/libobs"
        Get-ChildItem "$buildDir/libobs/*.dll" | Copy-Item -Destination $sandboxDir -ErrorAction SilentlyContinue
        if (Test-Path "$buildDir/libobs/data") {
            Copy-Item -Recurse -Force "$buildDir/libobs/data" "$sandboxDir/data"
        }
    }
    
    # Copy Main Executable
    Write-Host "Copying $exeName..."
    Copy-Item -Force "$buildDir/$exeName" "$sandboxDir/$exeName"

    # Copy root DLLs if any
    Get-ChildItem "$buildDir/*.dll" | Copy-Item -Destination $sandboxDir -ErrorAction SilentlyContinue

    # ---------------------------------------------------------
    # 4. Launch
    # ---------------------------------------------------------
    Write-Host "Launching $exeName from Sandbox..." -ForegroundColor Green
    Start-Process "$sandboxDir/$exeName" -WorkingDirectory $sandboxDir
}
catch {
    Write-Error "An unexpected error occurred: $_"
}
finally {
    Set-Location $initialDir
}
