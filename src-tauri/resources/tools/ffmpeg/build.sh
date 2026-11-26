#!/usr/bin/env bash
set -euo pipefail

# Run from the extracted, signature-verified FFmpeg source directory.
if ! ./configure \
    --target-os=mingw32 --arch=x86_64 --extra-ldflags=-static \
    --enable-static --disable-shared --enable-small \
    --disable-everything --disable-autodetect --disable-network \
    --disable-doc --disable-ffplay --disable-ffprobe --disable-avdevice \
    --disable-x86asm --disable-gpl --disable-version3 --disable-nonfree \
    --enable-protocol=file,pipe --enable-demuxer=mov --enable-muxer=mp4 \
    --enable-parser=h264,hevc,av1,aac --enable-decoder=h264,hevc,av1,aac; then
    tail -n 80 ffbuild/config.log >&2
    exit 1
fi
# Native Windows make passes FFmpeg's quiet-recipe @printf through to sh.
make -j"${FFMPEG_BUILD_JOBS:-4}" V=1 ffmpeg.exe
strip ffmpeg.exe
