import { searchIndex } from "../../../lib/docs";

export const dynamic = "force-static";

// The search index for /docs, built from the markdown at build time.
export function GET() {
  return Response.json(searchIndex());
}
