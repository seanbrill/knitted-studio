# Releasing

1. `npm run lint && npm run typecheck && npm test && npm run test:render && npm run test:e2e`
2. Bump `version` in the root and `apps/studio/package.json`, update the changelog page (`apps/site/app/changelog`).
3. `git tag vX.Y.Z && git push --tags`. The `release` workflow builds macOS, Windows and Linux installers and attaches them, with checksums, to a **draft** release.
4. On a clean machine per system, install, go offline, and run the first journey: make a project, upload a photo, build a pattern, knit a PNG and an MP4. Note the time.
5. Publish the draft. The site's download page reads the release list at build time.

Local build for this machine: `npm run desktop:dist`, output in `dist/desktop`. For a quick check without an installer, `npm run desktop:pack` and open the app in `dist/desktop/<platform>`.

## Signing (when certificates exist)

macOS: remove `identity: null`, add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets and `notarize: true`. Windows: `CSC_LINK`/`CSC_KEY_PASSWORD` for the NSIS target. Nothing else changes.

## Downgrading

Install the older release over the newer one. The library format is migrated forward only, so keep a backup (Settings, Storage) before updating across a version that changes it.
