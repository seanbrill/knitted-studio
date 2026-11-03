import { fontFaceCss, manifest } from "@knitted/fonts";
import { listYarn } from "@knitted/core/node";
import { route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Every @font-face a project can use: the bundled families plus any font it has
 * uploaded as Yarn. One stylesheet, so the editor, thumbnails and swatch preview
 * all see the same faces.
 */
export const GET = route(async (_: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = store();
  const css = [
    fontFaceCss(manifest.map((f: { family: string }) => f.family), (file: string) => `/api/fonts/${file}`),
    ...listYarn(s, (await params).id, { kind: "font" }).map((y) => `@font-face{font-family:"${(y.meta.family ?? y.name).replace(/"/g, "")}";src:url("/api/yarn/${y.id}/file?v=${y.hash.slice(0, 10)}");font-display:block}`),
  ].join("\n");
  return new Response(css, { headers: { "content-type": "text/css", "cache-control": "no-cache" } });
});
