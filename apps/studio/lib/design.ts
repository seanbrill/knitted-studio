// A design frame as the studio shows it: its page, with the project's fonts and its Yarn
// from this server.

import { framePage, type DesignFrame, type Swatch } from "@knitted/core";

export function frameDoc(f: Pick<DesignFrame, "name" | "width" | "height" | "html" | "css">, swatch: Swatch, projectId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return framePage(f, { swatch, fontsHref: `${origin}/api/projects/${projectId}/fonts.css`, yarnUrl: (id) => `${origin}/api/yarn/${id}/file` });
}

/** Wait for a frame's fonts and pictures, then how tall what is in it is. */
export async function frameHeight(el: HTMLIFrameElement): Promise<number | null> {
  const doc = el.contentDocument;
  if (!doc) return null;
  await doc.fonts?.ready;
  await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  // At one pixel tall: a page is never shorter than its window.
  const was = el.style.height;
  el.style.height = "1px";
  const h = doc.documentElement.scrollHeight;
  el.style.height = was;
  return Math.max(40, h);
}
