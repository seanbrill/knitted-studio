// The list of releases, newest first, as the Download page has it. The desktop app reads
// the release folder itself (apps/studio/electron/update.mjs), and this when it cannot.
// Copies before 0.1.2 read only this, so it stays.
import releases from "../../content/releases.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json({ releases: releases.releases });
}
