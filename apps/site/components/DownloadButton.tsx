"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { detect, diskImages, offer, type Offer, type Release, type Signals } from "../lib/downloads";
import { useReleases } from "./Releases";

interface UAData { platform: string; mobile: boolean; getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }> }

async function signals(): Promise<Signals> {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  const high = await data?.getHighEntropyValues(["architecture"]).catch(() => undefined);
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, platform: data?.platform, mobile: data?.mobile, architecture: high?.architecture };
}

/** The graphics chip's name, which WebGL shows where nothing else says which Mac this is. */
function gpu(): string | undefined {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return undefined;
    // Firefox gives the name as RENDERER. Chromium and Safari give "WebKit WebGL" there and the name through the extension.
    let name = String(gl.getParameter(gl.RENDERER));
    const info = /WebKit|Mozilla/.test(name) ? gl.getExtension("WEBGL_debug_renderer_info") : null;
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return undefined;
  }
}

/**
 * One button for this visitor's computer, on the Download page's ember band, for the newest
 * release: of `built`, then of the release folder as it is now (components/Releases.tsx).
 * Before the browser is asked (and with no JavaScript) it points at the full list below.
 */
export function DownloadButton({ built }: { built: Release[] }) {
  const releases = useReleases(built);
  const version = releases[0]?.version ?? "";
  const files = releases[0]?.files;
  // An older version's .dmg files, when this version has none (lib/downloads.ts).
  const dmgs = useMemo(() => diskImages(releases), [releases]);
  const [o, setO] = useState<Offer | null>(null);
  useEffect(() => {
    if (!files) return;
    let live = true;
    void signals().then((s) => {
      let m = detect(s);
      // Only a Mac's chip hides from the browser, and WebGL costs a moment, so only then.
      if (m.system === "macOS" && m.guessed) m = detect({ ...s, gpu: gpu() });
      if (live) setO(offer(files, m, dmgs));
    });
    return () => { live = false; };
  }, [files, dmgs]);

  const all = <a className="link-on-field" href="#all-downloads">All downloads</a>;
  const guide = <Link className="link-on-field" href="/download/install/">Install guide</Link>;
  if (o?.kind === "file") {
    return (
      <div className="get">
        <a className="btn btn-dark btn-lg" href={o.file.url}>Download for {o.file.platform}</a>
        <p className="get-file mono">{o.file.name}, {o.file.size}</p>
        <p className="get-more">
          {o.intel ? <span>On an Intel Mac? <a className="link-on-field" href={o.intel.url}>Get the Intel version</a></span> : null}
          {o.diskImage ? <span>Prefer a disk image? <a className="link-on-field" href={o.diskImage.file.url}>Get version {o.diskImage.version}&rsquo;s .dmg</a></span> : null}
          {all}{guide}
        </p>
      </div>
    );
  }
  if (o?.kind === "mobile" || o?.kind === "none") {
    return (
      <div className="get">
        <p className="body-lg">{o.kind === "mobile"
          ? "knitted is a desktop app. Open this page on a Mac, a Windows PC or a Linux computer to download it."
          : `Version ${version} has no download for this computer yet.`}</p>
        <p className="get-more">{all}</p>
      </div>
    );
  }
  return (
    <div className="get">
      <a className="btn btn-dark btn-lg" href="#all-downloads">Choose your download</a>
      <p className="get-more">Version {version}, for macOS, Windows and Linux. {guide}</p>
    </div>
  );
}
