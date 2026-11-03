# Third-party software shipped inside the installer

- **ffmpeg and ffprobe** (via `ffmpeg-static` and `@ffprobe-installer/ffprobe`; the `ffprobe-static` package was dropped because its macOS arm64 file is really an Intel build). The ffmpeg build is GPL-licensed (it includes x264). It runs as a **separate program** that knitted starts, and is not linked into it, so knitted itself stays MIT. Its licence text ships beside it (`ffmpeg.LICENSE`), and the source is available from the FFmpeg project and the `ffmpeg-static` repository. If you redistribute knitted, keep those notices.
- **Electron / Chromium.** Licences are in the app (`LICENSES.chromium.html`).
- **Fonts** are open licences (OFL / Apache); each is listed in `packages/fonts/src/manifest.json` with its licence.
- **Voices** are not shipped. Piper and others are downloaded only on request, with their own licences shown first.
