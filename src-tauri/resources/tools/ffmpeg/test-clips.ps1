[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Candidate,
    [Parameter(Mandatory)][string]$Reference
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$Candidate = (Resolve-Path -LiteralPath $Candidate).Path
$Reference = (Get-Command $Reference -CommandType Application | Select-Object -First 1).Source
$Probe = Join-Path (Split-Path -Parent $Reference) 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $Probe -PathType Leaf)) { throw "Reference ffprobe.exe is missing: $Probe" }
if ((Get-Item -LiteralPath $Candidate).Length -gt 20MB) { throw 'Clip FFmpeg exceeds 20 MiB.' }
$TempRoot = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetTempPath())
$Work = New-Item -ItemType Directory (Join-Path $TempRoot "leaguerecord-clip-test-$([guid]::NewGuid())")
$OriginalPath = $env:PATH

try {
    Push-Location $Work
    try {
        # A Unicode path and spaces exercise the same Windows argument handling as user recordings.
        $Video = @('-f', 'lavfi', '-i', 'color=size=64x64:rate=12', '-t', '3')
        $Audio = @('-f', 'lavfi', '-i', 'sine=frequency=440')
        $OtherAudio = @('-f', 'lavfi', '-i', 'sine=frequency=880')
        $Common = @('-hide_banner', '-loglevel', 'error', '-nostdin')
        & $Reference @Common @Video -c:v libx264 -g 12 'H264 録画.mp4'
        & $Reference @Common @Audio @Video -c:v libaom-av1 -cpu-used 8 -g 12 -c:a aac 'AV1 録画.mp4'
        & $Reference @Common @Audio @OtherAudio @Video -map 2:v -map 0:a -map 1:a -c:v libx265 -x265-params 'pools=1:log-level=error' -g 12 -c:a aac -metadata:s:a:0 language=eng -metadata:s:a:1 language=jpn 'HEVC 録画.mp4'

        # Copy the one executable out of the build directory and remove all toolchain/program paths.
        Copy-Item -LiteralPath $Candidate -Destination 'ffmpeg.exe'
        $Standalone = Join-Path $Work 'ffmpeg.exe'
        $env:PATH = "$env:SystemRoot/System32;$env:SystemRoot"
        $Version = & $Standalone -version
        if ($Version[0] -notmatch '^ffmpeg version \d') { throw 'Standalone FFmpeg did not report its version.' }
        $License = (& $Standalone -hide_banner -L) -join ' '
        if ($License -notmatch 'GNU Lesser General Public\s+License.*version 2\.1.*any later version') {
            throw 'FFmpeg did not report LGPL 2.1.'
        }

        # The app expects -i without an output to report tracks on stderr and exit nonzero.
        $PSNativeCommandUseErrorActionPreference = $false
        try {
            $Tracks = (& $Standalone -hide_banner -i 'HEVC 録画.mp4' 2>&1) -join "`n"
        } finally {
            $PSNativeCommandUseErrorActionPreference = $true
        }
        if ($Tracks -notmatch 'Stream #0:1.*Audio: aac' -or $Tracks -notmatch 'Stream #0:2.*Audio: aac') {
            throw 'Could not enumerate both AAC tracks with the clip binary.'
        }
        foreach ($Case in @(
            @{ File = 'H264 録画.mp4'; Codec = 'h264'; Audio = 0 },
            @{ File = 'AV1 録画.mp4'; Codec = 'av1'; Audio = 1 },
            @{ File = 'HEVC 録画.mp4'; Codec = 'hevc'; Audio = 1; Map = @('-map', '0:v:0', '-map', '0:a:1'); Language = 'jpn' }
        )) {
            $Map = $Case.Map ?? @()
            $Output = "clip-$($Case.Codec).mp4"
            $Progress = & $Standalone @Common -nostats -progress pipe:1 -ss 1 -i $Case.File -t 1 @Map -c copy $Output
            if ($Progress -notcontains 'progress=end' -or -not ($Progress -match '^out_time_us=\d+')) {
                throw "No completed clip progress for $($Case.Codec)."
            }
            $env:PATH = $OriginalPath
            try {
                $Info = (& $Probe -v error -show_streams -show_format -of json $Output) | ConvertFrom-Json
                & $Reference @Common -xerror -i $Output -f null -
            } finally {
                $env:PATH = "$env:SystemRoot/System32;$env:SystemRoot"
            }
            $VideoStreams = @($Info.streams | Where-Object codec_type -eq 'video')
            $AudioStreams = @($Info.streams | Where-Object codec_type -eq 'audio')
            $Duration = [double]::Parse($Info.format.duration, [Globalization.CultureInfo]::InvariantCulture)
            if ($VideoStreams.Count -ne 1 -or $VideoStreams[0].codec_name -ne $Case.Codec -or
                $AudioStreams.Count -ne $Case.Audio -or ($AudioStreams | Where-Object codec_name -ne 'aac') -or
                ($Case.Language -and $AudioStreams[0].tags.language -ne $Case.Language) -or
                $Duration -lt 0.8 -or $Duration -gt 1.5) {
                throw "Unexpected streams or clip duration for $($Case.Codec)."
            }
        }
        Write-Host "Standalone FFmpeg passed clip checks ($((Get-Item -LiteralPath $Candidate).Length) bytes)."
    } finally {
        Pop-Location
    }
} finally {
    $env:PATH = $OriginalPath
    if ($Work.Parent.FullName -eq $TempRoot -and
        $Work.Name -match '^leaguerecord-clip-test-[a-f\d-]{36}$') {
        Remove-Item -LiteralPath $Work.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}
