# Releasing

1. `npm run lint && npm run typecheck && npm test && npm run test:render && npm run test:e2e`
2. Bump `version` in the root and `apps/studio/package.json`, add the version to the changelog (`apps/site/content/changelog.json`).
3. On a Mac, `npm run release`. It builds the installers for macOS (Apple silicon and Intel), Windows (x64) and Linux (x64 and ARM), and uploads them with a `SHA256SUMS.txt` to `v<version>` in the FileFreak release folder. It needs `FILEFREAK_KEY` in `.env`, the release folder's write key (see `.env.example`), and checks the key before it builds. Only a Mac can build all three, because electron-builder builds macOS apps only on macOS. Running a version again replaces its files.
4. On a clean machine per system, install from the uploaded files, go offline, and run the first journey: make a project, upload a photo, build a pattern, knit a PNG and an MP4. Note the time.
5. Push to main, or run the site pipeline in EZPIPELINE. The site's Download page lists the release folder when the site is built, so the new version appears with that deploy.

Each installer carries its own system's ffmpeg, ffprobe and sharp, fetched once into `node_modules/.cache` by `scripts/desktop-binaries.mjs` and checked to be built for that system. This machine's copies, the ones npm installed, fit no other system.

Local build without uploading: `npm run desktop:dist` builds the installers for this machine's system, in `dist/desktop`. For a quick check without an installer, `npm run desktop:pack` and open the app in `dist/desktop/<platform>`.

The `release` GitHub workflow (tag `v*`) builds the same installers on GitHub's runners, one per system, into a draft GitHub release. It does not upload to FileFreak.

## Updates

Installed apps check `/releases.json` on the site (`apps/site/app/releases.json`, the same list the Download page shows), so a release reaches them when the site deploys (step 5). The updater (`apps/studio/electron/update.mjs`) installs the Mac `.zip`, the Windows `.exe` and the Linux `.AppImage`, so a release needs those, and only installs a file whose SHA-256 the list records. Versions must go up. A test version such as `0.2.0-beta.1` is offered only to copies that are test versions themselves.

To check the swap by hand on a Mac, pack two versions into a scratch folder: `npx electron-builder --dir --mac --arm64 -c.directories.output=<old>`, then `npx electron-builder --mac zip --arm64 -c.extraMetadata.version=<next> -c.directories.output=<new>` (in `apps/studio`). Serve a `releases.json` on 127.0.0.1 that lists the zip and its SHA-256, and open the old app with `KNITTED_UPDATE_URL=http://127.0.0.1:<port>/releases.json` and `--user-data-dir=<scratch>`, so it does not touch your own settings or library.

## Signing (when certificates exist)

Today the Mac app is ad-hoc signed (`identity: "-"` in `apps/studio/electron-builder.yml`): its signature is whole, so macOS does not call it damaged, but it names no developer, so a downloaded copy opens only after **Open Anyway** (docs/INSTALL.md). An Apple Developer ID and notarisation remove that step.

macOS: delete `identity: "-"` and `hardenedRuntime: false` from `mac` (notarisation needs the hardened runtime, which is the default, and electron-builder's default entitlements allow what Electron needs), and add the Developer ID Application certificate to `.env` as `CSC_LINK` and `CSC_KEY_PASSWORD`. Notarisation runs when `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` are set, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. `npm run release` passes `.env` to electron-builder. Windows: `CSC_LINK`/`CSC_KEY_PASSWORD` for the NSIS target. Nothing else changes.

## Downgrading

Install the older release over the newer one. The library format is migrated forward only, so keep a backup (Settings, Storage) before updating across a version that changes it.
