[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReferenceFfmpeg)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$Version = '8.1.3'
$Signer = 'FCF986EA15E6E293A5644F10B4322F04D67658D8'
$SourceHash = '7138D28C96D9D3E3AF4EE3D8CAD72741F8FFB40DA90C1112235DEA3ECD3178A3'
$ToolchainVersion = '2.11.0'
$ToolchainHash = '54C2BB9962E8A30C8270E34C5EFC3D5FEE579F53087FA7D435B95FBBA2AF7B2B'
$SourceUrl = "https://ffmpeg.org/releases/ffmpeg-$Version.tar.xz"
$Bash = Join-Path $env:ProgramFiles 'Git/bin/bash.exe'
$TauriDir = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$Stage = Join-Path $TauriDir 'target/clip-ffmpeg'
$TempRoot = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetTempPath())
$Work = New-Item -ItemType Directory (Join-Path $TempRoot "leaguerecord-ffmpeg-$([guid]::NewGuid())")
$OriginalPath = $env:PATH

function Get-VerifiedDownload($Url, $Destination, $Sha256) {
    & curl.exe --fail --silent --show-error --location --retry 3 --connect-timeout 30 --max-time 300 $Url -o $Destination
    if ($Sha256 -and (Get-FileHash -LiteralPath $Destination).Hash -ne $Sha256) {
        throw "SHA-256 mismatch for $Url"
    }
}

try {
    $Archive = Join-Path $Work "ffmpeg-$Version.tar.xz"
    $Signature = "$Archive.asc"
    $Key = Join-Path $Work 'ffmpeg-devel.asc'
    New-Item -ItemType Directory (Join-Path $Work 'gpg') | Out-Null
    Get-VerifiedDownload $SourceUrl $Archive $SourceHash
    Get-VerifiedDownload "$SourceUrl.asc" $Signature
    Get-VerifiedDownload 'https://ffmpeg.org/ffmpeg-devel.asc' $Key
    Push-Location $Work
    try {
        # Public-key verification does not require gpg-agent on headless runners.
        & $Bash -c '/usr/bin/gpg --batch --no-options --no-autostart --dearmor --output gpg/ffmpeg-release.gpg ffmpeg-devel.asc'
        $Status = & $Bash -c '/usr/bin/gpgv --homedir "$PWD/gpg" --keyring "$PWD/gpg/ffmpeg-release.gpg" --status-fd 1 "$1.asc" "$1"' verify "ffmpeg-$Version.tar.xz"
    } finally {
        Pop-Location
    }
    if (-not ($Status -cmatch "^\[GNUPG:\] VALIDSIG $Signer ")) {
        throw 'FFmpeg source was not signed by the pinned FFmpeg release key.'
    }

    $Toolchain = "w64devkit-x64-$ToolchainVersion.7z.exe"
    Get-VerifiedDownload "https://github.com/skeeto/w64devkit/releases/download/v$ToolchainVersion/$Toolchain" (Join-Path $Work $Toolchain) $ToolchainHash
    & 7z x -y "-o$Work" (Join-Path $Work $Toolchain) | Out-Null
    $env:PATH = "$(Join-Path $Work 'w64devkit/bin');$OriginalPath"
    Push-Location $Work
    try {
        & $Bash -c "tar -xf ffmpeg-$Version.tar.xz"
        Set-Location "ffmpeg-$Version"
        & $Bash ($PSScriptRoot.Replace('\', '/') + '/build.sh')
        New-Item -ItemType Directory -Force $Stage | Out-Null
        Copy-Item -LiteralPath 'ffmpeg.exe' -Destination $Stage -Force
        Copy-Item -LiteralPath 'COPYING.LGPLv2.1' -Destination (Join-Path $Stage 'FFmpeg-LICENSE.txt') -Force
    } finally {
        Pop-Location
        $env:PATH = $OriginalPath
    }

    $Exe = Join-Path $Stage 'ffmpeg.exe'
    & "$PSScriptRoot/test-clips.ps1" -Candidate $Exe -Reference $ReferenceFfmpeg
    $Provenance = @{
        sourceName = 'LeagueRecord clip-only FFmpeg'
        sourceUrl = $SourceUrl
        version = $Version
        license = 'LGPL-2.1-or-later'
        sha256 = (Get-FileHash -LiteralPath $Exe).Hash.ToLowerInvariant()
        downloadUrl = $null
        archiveSha256 = $SourceHash.ToLowerInvariant()
        fetchedAt = [DateTime]::UtcNow.ToString('o')
        notes = "Corresponding source, signature and build scripts are in ffmpeg-$Version-leaguerecord-source.zip alongside the LeagueRecord installer. Toolchain: w64devkit $ToolchainVersion."
    }
    $Provenance | ConvertTo-Json | Set-Content -Encoding utf8NoBOM (Join-Path $Stage 'ffmpeg-provenance.json')

    $SourceBundle = Join-Path $Stage "ffmpeg-$Version-leaguerecord-source.zip"
    $SourceFiles = @($Archive, $Signature, $Key, "$PSScriptRoot/build.sh", "$PSScriptRoot/build.ps1",
        "$PSScriptRoot/test-clips.ps1", "$PSScriptRoot/README.md", (Join-Path $Stage 'FFmpeg-LICENSE.txt'))
    Compress-Archive -LiteralPath $SourceFiles -DestinationPath $SourceBundle -Force

    # The default and updater configurations contain no executable. Only this overlay bundles it.
    $Resources = @{}
    foreach ($File in @('ffmpeg.exe', 'ffmpeg-provenance.json', 'FFmpeg-LICENSE.txt')) {
        $Resources["target/clip-ffmpeg/$File"] = "tools/ffmpeg-clip/$File"
    }
    @{ bundle = @{ resources = $Resources } } | ConvertTo-Json -Depth 5 |
        Set-Content -Encoding utf8NoBOM (Join-Path $Stage 'installer.conf.json')
} finally {
    $env:PATH = $OriginalPath
    if ($null -ne $Work -and $Work.Parent.FullName -eq $TempRoot -and
        $Work.Name -match '^leaguerecord-ffmpeg-[a-f\d-]{36}$') {
        Remove-Item -LiteralPath $Work.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}
