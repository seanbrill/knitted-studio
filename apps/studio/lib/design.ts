// A design frame as the studio shows it: its page, with the project's fonts and its Yarn
// from this server.

import { framePage, type DesignFrame, type Swatch } from "@knitted/core";

// Addresses from the root, the same on the server as in the window, so the page the server
// sends matches the one the window makes. A frame's srcdoc reads them against the studio's page.
export function frameDoc(f: Pick<DesignFrame, "name" | "width" | "height" | "html" | "css">, swatch: Swatch, projectId: string): string {
  return framePage(f, { swatch, fontsHref: `/api/projects/${projectId}/fonts.css`, yarnUrl: (id) => `/api/yarn/${id}/file` });
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
