// A design frame as the studio shows it: its page, with the project's fonts and its Yarn
// from this server.

import { framePage, frameRev, tokensCss, type DesignFrame, type FrameMeta, type Swatch } from "@knitted/core";
import { api } from "@knitted/core/client";

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

/** A short name for some text: what tells one draft, or one brand, from another. */
export function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** What a frame's picture is drawn with besides its own code: the brand. A change to it is a new picture. */
export const brandKey = (swatch: Swatch) => hashOf(tokensCss(swatch) + JSON.stringify(swatch.logos));

/** A frame's picture, drawn by the studio and kept by the window until the frame or the brand changes. */
export const framePicUrl = (designId: string, f: Pick<FrameMeta, "id" | "code" | "width" | "height">, brand: string) => api.designs.thumbUrl(designId, f.id, `${frameRev(f)}.${brand}`);
