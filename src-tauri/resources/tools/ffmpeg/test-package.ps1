[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [string]$Updater
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$BaselineInstallerBytes = 240387488 # Published LeagueRecord 1.3.0 Windows installer.

function Get-PackageEntries([string]$Path) {
    $Absolute = (Resolve-Path -LiteralPath $Path).Path
    $Entries = @(& 7z l -slt $Absolute | ForEach-Object {
        if ($_ -match '^Path = (.*)$' -and $Matches[1] -ne $Absolute) {
            $Matches[1].Replace('\', '/')
        }
    })
    if (-not ($Entries -match '(^|/)LeagueRecord\.exe$')) { throw "Could not inspect NSIS payload: $Path" }
    return $Entries
}

$Entries = Get-PackageEntries $Installer
foreach ($Name in @('ffmpeg.exe', 'ffmpeg-provenance.json', 'FFmpeg-LICENSE.txt')) {
    if (@($Entries -match "(^|/)tools/ffmpeg-clip/$([regex]::Escape($Name))$").Count -ne 1) {
        throw "Expected exactly one tools/ffmpeg-clip/$Name in the installer."
    }
}
if (@($Entries -match '(^|/)ffmpeg\.exe$').Count -ne 1 -or
    @($Entries -match '(^|/)tools/ffmpeg-clip/[^/]+$').Count -ne 3 -or
    ($Entries -match '(^|/)(ffprobe\.exe|ffplay\.exe|ffmpeg[^/]*\.zip)$')) {
    throw 'Unexpected FFmpeg runtime files in the installer.'
}
$Bytes = (Get-Item -LiteralPath $Installer).Length
Write-Host "Installer: $Bytes bytes (1.3.0: $BaselineInstallerBytes bytes)."
if ($Bytes -ge $BaselineInstallerBytes) { throw 'Installer is not smaller than the 1.3.0 baseline.' }

if ($Updater) {
    $Entries = Get-PackageEntries $Updater
    if ($Entries -match '(^|/)(ffmpeg\.exe|ffprobe\.exe|ffplay\.exe|ffmpeg[^/]*\.zip|FFmpeg-LICENSE\.txt)$' -or
        $Entries -match '(^|/)tools/ffmpeg-clip/') {
        throw 'Unexpected bundled FFmpeg in the updater.'
    }
    Write-Host "Updater: $((Get-Item -LiteralPath $Updater).Length) bytes (1.3.0: 25360946 bytes)."
}
