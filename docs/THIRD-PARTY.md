# Third-party software shipped inside the installer

- **ffmpeg and ffprobe** (via `ffmpeg-static` and `@ffprobe-installer/ffprobe`; the `ffprobe-static` package was dropped because its macOS arm64 file is really an Intel build). The ffmpeg build is GPL-licensed (it includes x264). It runs as a **separate program** that knitted starts, and is not linked into it, so knitted itself stays MIT. Its licence text ships beside it (`ffmpeg.LICENSE`), and the source is available from the FFmpeg project and the `ffmpeg-static` repository. If you redistribute knitted, keep those notices.
- Each installer carries the ffmpeg, ffprobe and sharp builds for its own system, fetched by `scripts/desktop-binaries.mjs` from the same places those packages install from.
- **sharp and libvips** (thumbnails and image work). sharp is Apache-2.0. The libvips it loads is LGPL-3.0-or-later and ships as its own shared library beside sharp (`@img/sharp-libvips-*`; on Windows, inside `@img/sharp-win32-*`), not built into knitted.
- **Electron / Chromium.** Licences are in the app (`LICENSES.chromium.html`).
- **Fonts** are open licences (OFL / Apache); each is listed in `packages/fonts/src/manifest.json` with its licence.
- **Voices** are not shipped. Piper and others are downloaded only on request, with their own licences shown first.
- **PDFium** (reading and drawing PDFs), through `@hyzyla/pdfium` (MIT), which ships PDFium built as WebAssembly. PDFium is BSD-3-Clause, with parts under Apache-2.0; its licences are in the PDFium source from Google.
