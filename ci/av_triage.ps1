param(
    [string]$ApiKey = "",
    [string[]]$Profiles = @(),
    [switch]$UploadToVirusTotal,
    [switch]$SkipBuild,
    [ValidateSet("exe", "nsis")]
    [string]$Target = "exe",
    [ValidateSet("all", "trapmine", "quick")]
    [string]$Preset = "all",
    [switch]$UseBuildCache,
    [switch]$ForceRebuild,
    [switch]$BackendOnly,
    [switch]$SkipFrontendBuild,
    [switch]$UseSccache,
    [string]$CargoTargetDir = "",
    [int]$PollSeconds = 15,
    [int]$PollMax = 20
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$root = Split-Path -Parent $PSScriptRoot
$defaultCargoTargetDir = Join-Path $root "target_alt\av_shared"
$effectiveCargoTargetDir = if ([string]::IsNullOrWhiteSpace($CargoTargetDir)) { $defaultCargoTargetDir } else { $CargoTargetDir }
$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$outDir = Join-Path $root "av-triage-results"
$cacheDir = Join-Path $outDir "cache"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
New-Item -ItemType Directory -Path $effectiveCargoTargetDir -Force | Out-Null

if ($BackendOnly -and $Target -eq "nsis") {
    throw "BackendOnly mode only supports Target=exe."
}

$profileMap = [ordered]@{
    "full" = ""
    "no_updater" = "av-disable-updater"
    "no_recorder" = "av-disable-recorder,av-disable-updater"
    "default_core" = "av-no-plugins,av-no-invoke,av-no-setup"
    "default_setup" = "av-no-plugins,av-no-invoke"
    "setup_safe" = "av-no-plugins,av-no-invoke,av-safe-setup"
    "setup_no_tray" = "av-no-plugins,av-no-invoke,av-setup-no-tray"
    "setup_no_updatecheck" = "av-no-plugins,av-no-invoke,av-setup-no-updatecheck"
    "setup_no_autostart" = "av-no-plugins,av-no-invoke,av-setup-no-autostart"
    "setup_no_hotkeys" = "av-no-plugins,av-no-invoke,av-setup-no-hotkeys"
    "setup_no_fshooks" = "av-no-plugins,av-no-invoke,av-setup-no-fs-hooks"
    "setup_no_recorder" = "av-no-plugins,av-no-invoke,av-disable-recorder"
    "setup_safe_plus_updatecheck" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-updatecheck"
    "setup_safe_plus_tray" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-tray"
    "setup_safe_plus_autostart" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-autostart"
    "setup_safe_plus_hotkeys" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-hotkeys"
    "setup_safe_plus_fshooks" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-fshooks"
    "setup_safe_plus_recorder" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-recorder"
    "setup_safe_plus_cleanup" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime" = "av-no-plugins,av-no-invoke,av-safe-setup,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_no_lcu" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-obs-no-lcu-listener,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_no_credential_poll" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-disable-credential-poll,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_no_ws" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-disable-ws-subscribe,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_no_auto_accept" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-disable-auto-accept,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_no_ingame_poller" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-disable-ingame-poller,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_lcu_independent" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-independent-recorder,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_local_lockfile_credentials" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-credentials-local-lockfile,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "setup_safe_plus_runtime_obs_credentials_no_listener" = "av-no-plugins,av-no-invoke,av-safe-setup,av-force-obs-recorder,av-lcu-credentials-no-listener,av-safe-setup-enable-autostart,av-safe-setup-enable-hotkeys,av-safe-setup-enable-fshooks,av-safe-setup-enable-recorder,av-safe-setup-enable-cleanup"
    "safe_plugins" = "av-safe-plugins,av-disable-updater"
    "limited_plugins" = "av-disable-process,av-disable-autostart,av-disable-shell,av-disable-updater"
    "safe_invoke" = "av-safe-invoke,av-disable-updater"
    "minimal" = "av-minimal,av-no-plugins,av-no-invoke,av-no-setup"
}

if ($Profiles.Count -eq 0) {
    switch ($Preset) {
        "trapmine" { $Profiles = @("full", "no_updater", "no_recorder", "safe_plugins", "limited_plugins") }
        "quick" { $Profiles = @("full", "safe_plugins") }
        default { $Profiles = @("full", "no_updater", "safe_plugins", "limited_plugins", "safe_invoke", "minimal") }
    }
}

foreach ($p in $Profiles) {
    if (-not $profileMap.Contains($p)) {
        throw "Unknown profile '$p'. Valid profiles: $($profileMap.Keys -join ', ')"
    }
}

if ($BackendOnly) {
    $manifest = Join-Path $root "src-tauri\Cargo.toml"
    if (Test-Path $manifest) {
        $manifestText = Get-Content $manifest -Raw
        if ($manifestText -match "artifact\s*=") {
            Write-Host "[triage] BackendOnly requested, but Cargo manifest uses artifact dependencies (-Z bindeps). Falling back to tauri build mode."
            $BackendOnly = $false
        }
    }
}

function Get-BuildStamp {
    Push-Location $root
    try {
        $head = (git rev-parse --short=12 HEAD).Trim()
        if (-not $head) {
            return "nogit"
        }
        $dirty = (git status --porcelain)
        if ($dirty) {
            $diff = (git diff -- .)
            $sha = [System.Security.Cryptography.SHA256]::Create()
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($diff)
            $hashBytes = $sha.ComputeHash($bytes)
            $hash = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLower().Substring(0, 12)
            return "$head-dirty-$hash"
        }
        return "$head-clean"
    } catch {
        return "nogit"
    } finally {
        Pop-Location
    }
}

function Invoke-VtGetFile([string]$apiKey, [string]$sha256) {
    $headers = @{ "x-apikey" = $apiKey }
    try {
        return Invoke-RestMethod -Method Get -Uri "https://www.virustotal.com/api/v3/files/$sha256" -Headers $headers
    } catch {
        if ($_.Exception.Response.StatusCode.Value__ -eq 404) {
            return $null
        }
        throw
    }
}

function Invoke-VtUpload([string]$apiKey, [string]$filePath) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($null -eq $curl) {
        throw "curl.exe is required for VT upload on this PowerShell version."
    }

    $raw = & curl.exe --silent --show-error `
        -H "x-apikey: $apiKey" `
        -F "file=@$filePath" `
        "https://www.virustotal.com/api/v3/files"
    if ($LASTEXITCODE -ne 0) {
        throw "VirusTotal upload failed (curl exit=$LASTEXITCODE)"
    }

    $upload = $raw | ConvertFrom-Json
    return $upload.data.id
}

function Wait-VtAnalysis([string]$apiKey, [string]$analysisId, [int]$pollSeconds, [int]$pollMax) {
    $headers = @{ "x-apikey" = $apiKey }
    for ($i = 0; $i -lt $pollMax; $i++) {
        $resp = Invoke-RestMethod -Method Get -Uri "https://www.virustotal.com/api/v3/analyses/$analysisId" -Headers $headers
        $status = $resp.data.attributes.status
        if ($status -eq "completed") {
            return $resp
        }
        Start-Sleep -Seconds $pollSeconds
    }
    return $null
}

function Enable-BuildAccelerators {
    if (-not $BackendOnly) {
        return
    }

    $env:CARGO_INCREMENTAL = "1"
    $env:CARGO_TARGET_DIR = $effectiveCargoTargetDir

    if ($UseSccache) {
        $sccache = Get-Command sccache -ErrorAction SilentlyContinue
        if ($null -eq $sccache) {
            throw "UseSccache was specified but 'sccache' was not found in PATH."
        }
        & sccache --start-server | Out-Null
        $env:RUSTC_WRAPPER = "sccache"
    }
}

function Build-FrontendOnce {
    if (-not $BackendOnly -or $SkipBuild -or $SkipFrontendBuild) {
        return
    }

    Push-Location $root
    try {
        Write-Host "[frontend] building web assets once..."
        & bun run --bun build
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend build failed (exit=$LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
}

function Build-Profile([string]$name, [string]$featureCsv) {
    if ($SkipBuild) {
        Write-Host "[$name] skipping build"
        return
    }

    Write-Host "[$name] building target '$Target'..."
    Push-Location $root
    try {
        if ($BackendOnly) {
            $cargoArgs = @("build", "--manifest-path", "src-tauri/Cargo.toml", "--release")
            if (-not [string]::IsNullOrWhiteSpace($featureCsv)) {
                $cargoArgs += @("--features", $featureCsv)
            }

            $cargoOutput = & cargo @cargoArgs 2>&1
            $cargoExit = $LASTEXITCODE
            if ($cargoExit -eq 0) {
                return
            }

            $cargoText = ($cargoOutput | Out-String)
            if ($cargoText -match "requires -Z bindeps") {
                Write-Host "[$name] backend-only is unsupported for this manifest (artifact dep). Falling back to tauri build."
            } else {
                throw "Cargo build failed for profile '$name' (exit=$cargoExit)`n$cargoText"
            }
        } else {
            # continue below with tauri build
        }

        $args = @("run", "--bun", "tauri", "build")
        if ($Target -eq "exe") {
            $args += "--no-bundle"
        }
        if (-not [string]::IsNullOrWhiteSpace($featureCsv)) {
            $args += @("--features", $featureCsv)
        }

        if ($SkipFrontendBuild) {
            $env:SKIP_FRONTEND_BUILD = "1"
        } else {
            Remove-Item Env:SKIP_FRONTEND_BUILD -ErrorAction SilentlyContinue
        }

        & bun @args
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed for profile '$name' (exit=$LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
}

function Get-LiveArtifact {
    if ($BackendOnly -and (Test-Path (Join-Path $effectiveCargoTargetDir "release\LeagueRecord.exe"))) {
        $exePath = Join-Path $effectiveCargoTargetDir "release\LeagueRecord.exe"
        return Get-Item $exePath
    }

    if ($Target -eq "nsis") {
        return Get-ChildItem -Path $bundleDir -Filter "*_x64-setup.exe" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }

    $exePath = Join-Path $root "src-tauri\target\release\LeagueRecord.exe"
    if (Test-Path $exePath) {
        return Get-Item $exePath
    }

    return $null
}

function Get-CachePath([string]$profile, [string]$featureCsv, [string]$stamp) {
    $mode = if ($BackendOnly) { "backend" } else { "tauri" }
    $key = "${mode}__${Target}__${profile}__${stamp}"
    if (-not [string]::IsNullOrWhiteSpace($featureCsv)) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($featureCsv)
        $hashBytes = $sha.ComputeHash($bytes)
        $featureHash = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLower().Substring(0, 16)
        $key = "${key}__f${featureHash}"
    }

    $ext = if ($Target -eq "nsis") { "setup.exe" } else { "exe" }
    return Join-Path $cacheDir "$key.$ext"
}

function Get-SafeFileName([string]$name) {
    return ($name -replace "[^a-zA-Z0-9._-]", "_")
}

$buildStamp = Get-BuildStamp
Write-Host "Build stamp: $buildStamp"
Write-Host "Mode: $([string]::Format("backend_only={0}, sccache={1}", $BackendOnly.IsPresent, $UseSccache.IsPresent))"

Enable-BuildAccelerators
Build-FrontendOnce

$records = @()

foreach ($profile in $Profiles) {
    $features = $profileMap[$profile]
    $cachePath = Get-CachePath -profile $profile -featureCsv $features -stamp $buildStamp

    $artifactPath = $null
    $artifactName = $null
    $buildSource = "cache"
    $buildSeconds = 0.0

    if ($UseBuildCache -and -not $ForceRebuild -and (Test-Path $cachePath)) {
        Write-Host "[$profile] using cached artifact: $(Split-Path -Leaf $cachePath)"
        $artifactPath = $cachePath
        $artifactName = Split-Path -Leaf $cachePath
    } else {
        if ($SkipBuild) {
            throw "SkipBuild requires a cached artifact for profile '$profile'. Re-run once without -SkipBuild to populate cache."
        }
        $buildSource = "built"
        $buildStart = Get-Date
        Build-Profile -name $profile -featureCsv $features
        $buildSeconds = [math]::Round(((Get-Date) - $buildStart).TotalSeconds, 2)
        Write-Host "[$profile] build_seconds=$buildSeconds"

        $artifact = Get-LiveArtifact
        if ($null -eq $artifact) {
            throw "Artifact not found for target '$Target'"
        }

        $artifactPath = $artifact.FullName
        $artifactName = $artifact.Name

        if ($UseBuildCache) {
            Copy-Item -Force $artifactPath $cachePath
            $artifactPath = $cachePath
            $artifactName = Split-Path -Leaf $cachePath
        }
    }

    $artifactItem = Get-Item $artifactPath
    $hash = (Get-FileHash $artifactPath -Algorithm SHA256).Hash.ToLower()
    $copiedName = Get-SafeFileName "$profile-$artifactName"
    $copiedPath = Join-Path $outDir $copiedName
    Copy-Item -Force $artifactPath $copiedPath

    $record = [ordered]@{
        profile = $profile
        features = $features
        build_source = $buildSource
        build_seconds = $buildSeconds
        preset = $Preset
        build_stamp = $buildStamp
        target = $Target
        artifact = $copiedName
        size = $artifactItem.Length
        sha256 = $hash
        vt_status = "not_checked"
        vt_malicious = ""
        vt_suspicious = ""
        vt_undetected = ""
        vt_trapmine = ""
        vt_microsoft = ""
        vt_link = "https://www.virustotal.com/gui/file/$hash"
    }

    if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
        $vt = Invoke-VtGetFile -apiKey $ApiKey -sha256 $hash
        if ($null -eq $vt -and $UploadToVirusTotal) {
            Write-Host "[$profile] uploading to VirusTotal..."
            $analysisId = Invoke-VtUpload -apiKey $ApiKey -filePath $copiedPath
            $analysis = Wait-VtAnalysis -apiKey $ApiKey -analysisId $analysisId -pollSeconds $PollSeconds -pollMax $PollMax
            if ($null -ne $analysis) {
                $vt = Invoke-VtGetFile -apiKey $ApiKey -sha256 $hash
            } else {
                $record.vt_status = "uploaded_pending"
            }
        }

        if ($null -ne $vt) {
            $stats = $vt.data.attributes.last_analysis_stats
            $results = $vt.data.attributes.last_analysis_results

            $trapmine = ""
            if ($results.PSObject.Properties.Name -contains "Trapmine") {
                $trapmine = $results.Trapmine.result
            }

            $microsoft = ""
            if ($results.PSObject.Properties.Name -contains "Microsoft") {
                $microsoft = $results.Microsoft.result
            }

            $record.vt_status = "available"
            $record.vt_malicious = $stats.malicious
            $record.vt_suspicious = $stats.suspicious
            $record.vt_undetected = $stats.undetected
            $record.vt_trapmine = $trapmine
            $record.vt_microsoft = $microsoft
        } elseif ($record.vt_status -eq "not_checked") {
            $record.vt_status = "not_found"
        }
    }

    $records += [pscustomobject]$record
    Write-Host "[$profile] sha256=$hash status=$($record.vt_status) trapmine='$($record.vt_trapmine)'"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$csvPath = Join-Path $outDir "summary-$timestamp.csv"
$jsonPath = Join-Path $outDir "summary-$timestamp.json"
$latestCsvPath = Join-Path $outDir "summary.csv"
$latestJsonPath = Join-Path $outDir "summary.json"

$records | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
$records | ConvertTo-Json -Depth 6 | Set-Content -Path $jsonPath -Encoding UTF8
$records | Export-Csv -Path $latestCsvPath -NoTypeInformation -Encoding UTF8
$records | ConvertTo-Json -Depth 6 | Set-Content -Path $latestJsonPath -Encoding UTF8

Write-Host ""
Write-Host "AV triage completed."
Write-Host "Summary CSV: $latestCsvPath"
Write-Host "Summary JSON: $latestJsonPath"
Write-Host "Timestamped CSV: $csvPath"
Write-Host "Timestamped JSON: $jsonPath"
