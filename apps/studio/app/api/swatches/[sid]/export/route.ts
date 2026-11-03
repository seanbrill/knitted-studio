import { exportSwatch, getSwatch } from "@knitted/core/node";
import { route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

export const GET = route(async (_: Request, { params }: { params: Promise<{ sid: string }> }) => {
  const s = store();
  const { sid } = await params;
  const sw = getSwatch(s, sid);
  return new Response(JSON.stringify(await exportSwatch(s, sid), null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${sw.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.knitted-swatch.json"` },
  });
});
