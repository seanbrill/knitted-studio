// The list of releases, newest first, as the Download page has it. The desktop app
// reads this to see whether there is a newer version (apps/studio/electron/update.mjs),
// so the app and the page can never disagree about what is out or what its SHA-256 is.
import releases from "../../content/releases.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json({ releases: releases.releases });
}
