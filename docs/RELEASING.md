# Releasing

1. `npm run lint && npm run typecheck && npm test && npm run test:render && npm run build:app && npm run test:e2e` (the link tests run the built server, as the desktop app does)
2. Bump `version` in the root and `apps/studio/package.json`, add the version to the changelog (`apps/site/content/changelog.json`).
3. On a Mac, `npm run release`. It builds the installers for macOS (Apple silicon and Intel), Windows (x64) and Linux (x64 and ARM), uploads them with a `SHA256SUMS.txt` to `v<version>` in the FileFreak release folder, and checks that the folder shows each system's file and its SHA-256 the way installed apps read it. Installed apps are offered the new version from then on. Only a Mac can build all three, because electron-builder builds macOS apps only on macOS. Running a version again replaces its files.

   It needs one key in `.env` (see `.env.example`): `FILEFREAK_KEY`, the release folder's write key. Before it builds anything it checks that the key can write, and that this checkout has everything on `origin/main`, since the installers are built from here.
4. On a clean machine per system, install from the uploaded files, go offline, and run the first journey: make a project, upload a photo, build a pattern, knit a PNG and an MP4. Note the time.
5. Push to main. The site pipeline in EZPIPELINE builds and deploys the site on every push, and the build lists the release folder, so the Download page shows the new version (with the older versions below). If the release commit was pushed before step 3, run the pipeline (`knitted release`) in EZPIPELINE instead.

The site is static: its Download page and `/releases.json` list the release folder as it was when the site was built. A visitor's browser cannot read the folder itself. FileFreak refuses a key sent from a web page, and its public answers (`/api/public/files/...`, which need no key) send no `Access-Control-Allow-Origin`, so a page on another site may not read them. If they did, as FileFreak's `/v1` API does, the Download page could read the folder live, as the apps do.

Each installer carries its own system's ffmpeg, ffprobe and sharp, fetched once into `node_modules/.cache` by `scripts/desktop-binaries.mjs` and checked to be built for that system. This machine's copies, the ones npm installed, fit no other system.

Local build without uploading: `npm run desktop:dist` builds the installers for this machine's system, in `dist/desktop`. For a quick check without an installer, `npm run desktop:pack` and open the app in `dist/desktop/<platform>`.

The `release` GitHub workflow (tag `v*`) builds the same installers on GitHub's runners, one per system, into a draft GitHub release. It does not upload to FileFreak.

## Updates

Installed apps read the release folder itself, through FileFreak's public answers (no key: the folder is public), so a release reaches them as soon as step 3 has uploaded it. An up-to-date copy asks for one listing; one with an update also reads that version's folder and its `SHA256SUMS.txt`. If the folder cannot be read, they ask the site's `/releases.json` (`apps/site/app/releases.json`, the list the Download page shows, built from the same folder). Copies before 0.1.2 only ask the site, so they see a release once the site has been built after it (step 5). The updater (`apps/studio/electron/update.mjs`) installs the Mac `.zip`, the Windows `.exe` and the Linux `.AppImage`, so a release needs those, and only installs a file whose SHA-256 its `SHA256SUMS.txt` records. Versions must go up. A test version such as `0.2.0-beta.1` is offered only to copies that are test versions themselves.

To check the swap by hand on a Mac, pack two versions into a scratch folder: `npx electron-builder --dir --mac --arm64 -c.directories.output=<old>`, then `npx electron-builder --mac zip --arm64 -c.extraMetadata.version=<next> -c.directories.output=<new>` (in `apps/studio`). Serve a `releases.json` on 127.0.0.1 that lists the zip and its SHA-256, and open the old app with `KNITTED_UPDATE_URL=http://127.0.0.1:<port>/releases.json` and `--user-data-dir=<scratch>`, so it does not touch your own settings or library.

## Signing (when certificates exist)

Today the Mac app is ad-hoc signed (`identity: "-"` in `apps/studio/electron-builder.yml`): its signature is whole, so macOS does not call it damaged, but it names no developer, so a downloaded copy opens only after **Open Anyway** (docs/INSTALL.md). An Apple Developer ID and notarisation remove that step.

macOS: delete `identity: "-"` and `hardenedRuntime: false` from `mac` (notarisation needs the hardened runtime, which is the default, and electron-builder's default entitlements allow what Electron needs), and add the Developer ID Application certificate to `.env` as `CSC_LINK` and `CSC_KEY_PASSWORD`. Notarisation runs when `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` are set, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. `npm run release` passes `.env` to electron-builder. Windows: `CSC_LINK`/`CSC_KEY_PASSWORD` for the NSIS target. Nothing else changes.

## Downgrading

Install the older release over the newer one. The library format is migrated forward only, so keep a backup (Settings, Storage) before updating across a version that changes it.
