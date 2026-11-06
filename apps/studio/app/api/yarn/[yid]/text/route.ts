import { getYarn, pdfText } from "@knitted/core/node";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** A PDF's text, page by page. */
export const GET = route(async (_: Request, { params }: { params: Promise<{ yid: string }> }) => {
  const s = store();
  return ok({ pages: await pdfText(s, getYarn(s, (await params).yid)) });
});
