import { toSrt } from "@knitted/core";
import { getYarn } from "@knitted/core/node";
import { route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Subtitles for every spoken line, as a standard .srt, for platforms that take their own. */
export const GET = route(async (_: Request, { params }: { params: Promise<{ pid: string }> }) => {
  const s = store();
  const p = s.getPattern((await params).pid);
  const lines = (p.motion?.audio ?? []).filter((a) => a.kind === "voice" && a.label).map((a) => {
    let len = 0; try { len = getYarn(s, a.yarnId).durationMs ?? 0; } catch { /* a deleted file has no length */ }
    return { text: a.label!, startMs: a.startMs, endMs: a.startMs + len };
  }).filter((l) => l.endMs > l.startMs);
  return new Response(toSrt(lines), { headers: { "content-type": "application/x-subrip; charset=utf-8", "content-disposition": `attachment; filename="${p.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.srt"` } });
});
