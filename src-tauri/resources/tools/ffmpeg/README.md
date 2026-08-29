# Bundled FFmpeg

Place the real `ffmpeg.exe` binary in this folder for bundled clip support.
If the build is dynamically linked, place required sibling `.dll` files too.
Do not use Chocolatey shim binaries from `C:\ProgramData\chocolatey\bin`.

Required files:
- `ffmpeg.exe`
- `ffmpeg-provenance.json` (includes version, sourceUrl, sha256, archiveSha256)

Reproducibility:
- `ffmpeg-provenance.json` is the source of truth for CI verification. CI runs `update_ffmpeg_bundle.ps1` then verifies `sha256` matches the bundled `ffmpeg.exe`.
- To pin a specific FFmpeg version, set `downloadUrl` and `archiveSha256` in provenance and use `Invoke-WebRequest + Get-FileHash` instead of `choco install`. See `update_ffmpeg_bundle.ps1` header.

The app will prefer this bundled binary when `ffmpegPath` is not set.
