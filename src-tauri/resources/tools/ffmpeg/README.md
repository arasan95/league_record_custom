# Windows x64 FFmpeg for LeagueRecord clips

LeagueRecord uses FFmpeg to copy part of an MP4 recording into another MP4.
The bundle supports H.264, HEVC and AV1 video with optional AAC audio.
The build includes FFmpeg's native parsers and decoders to inspect the streams.
Clip creation copies the compressed streams and keeps the existing keyframe-based seek behavior.

The normal installer includes the executable, its provenance and LGPL 2.1 license.
Automatic app updates continue to use the existing app-local FFmpeg.
The recording engine and its OBS resources use their own build.

## Build from source

From the repository root in PowerShell 7 on Windows x64:

```powershell
./src-tauri/resources/tools/ffmpeg/build.ps1 -ReferenceFfmpeg 'C:/reference/bin/ffmpeg.exe'
bunx tauri build --config src-tauri/target/clip-ffmpeg/installer.conf.json -- --locked
```

The first command uses Git for Windows, 7-Zip and curl to verify the pinned FFmpeg source
and install the pinned portable MinGW-w64 toolchain into a temporary build directory.
The reference FFmpeg and its sibling `ffprobe.exe` are only used to create and inspect
synthetic test clips. Use a reference build with libx264, libx265 and libaom.

The same `build.sh` in this source archive contains the configure options.
To reproduce the executable independently, verify the enclosed source archive with the enclosed
release key, extract it, and run `bash /path/to/build.sh` from the extracted source directory
with w64devkit on PATH. The pinned versions, hashes and signer are recorded in `build.ps1`.

FFmpeg is distributed under LGPL-2.1-or-later. The corresponding upstream source,
signature, license and build scripts are in `ffmpeg-<version>-leaguerecord-source.zip`
alongside the LeagueRecord installer on GitHub Releases.
