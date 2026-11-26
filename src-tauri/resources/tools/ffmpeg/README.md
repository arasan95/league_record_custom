# Bundled FFmpeg

Place the real `ffmpeg.exe` binary in this folder for bundled clip support.
If the build is dynamically linked, place required sibling `.dll` files too.
Do not use Chocolatey shim binaries from `C:\ProgramData\chocolatey\bin`.

Required files:
- `ffmpeg.exe`
- `ffmpeg-provenance.json` (already included template)

The app will prefer this bundled binary when `ffmpegPath` is not set.
