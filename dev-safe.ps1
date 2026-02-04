$tomlPath = Join-Path $PSScriptRoot "src-tauri/Cargo.toml"
$content = Get-Content $tomlPath -Raw -Encoding UTF8

$originalNameLine = 'name = "LeagueRecord"'
$devNameLine = 'name = "LeagueRecord_dev"'

$originalDefaultRun = 'default-run = "LeagueRecord"'
$devDefaultRun = 'default-run = "LeagueRecord_dev"'

if ($content -match $originalNameLine) {
    # Replace both name and default-run
    $newContent = $content.Replace($originalNameLine, $devNameLine).Replace($originalDefaultRun, $devDefaultRun)

    Set-Content $tomlPath $newContent -Encoding UTF8 -NoNewline
    Write-Host "Temporarily renamed 'LeagueRecord' to 'LeagueRecord_dev' (and updated default-run) in Cargo.toml." -ForegroundColor Cyan
}
elseif ($content -match $devNameLine) {
    Write-Host "Cargo.toml already uses dev name. Proceeding..." -ForegroundColor Yellow
}
else {
    Write-Warning "Could not find package name in Cargo.toml."
}

try {
    # Run user's dev command
    bun x tauri dev
}
finally {
    # Restore
    $finalContent = Get-Content $tomlPath -Raw -Encoding UTF8
    if ($finalContent -match $devNameLine) {
        $restored = $finalContent.Replace($devNameLine, $originalNameLine).Replace($devDefaultRun, $originalDefaultRun)
        Set-Content $tomlPath $restored -Encoding UTF8 -NoNewline
        Write-Host "`nRestored Cargo.toml to original name." -ForegroundColor Green
    }
}
