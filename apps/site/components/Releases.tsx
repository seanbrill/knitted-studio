"use client";

// The Download page's list of versions. It shows the list the site was built with, and then
// the release folder as it is now (lib/live-releases.ts), so a version or a .dmg that went
// up since the build is listed without one. With no JavaScript, or when FileFreak does not
// answer, the built list stays.

import Link from "next/link";
import { useEffect, useState } from "react";
import { diskImages, type Release } from "../lib/downloads";
import { liveReleases } from "../lib/live-releases";

// One read per visit, shared by the button at the top and the list.
let reading: Promise<Release[] | null> | null = null;

/** The releases, newest first: `built` at first, then the folder's, once it has answered. */
export function useReleases(built: Release[]): Release[] {
  const [list, setList] = useState(built);
  useEffect(() => {
    let live = true;
    reading ??= liveReleases((url, init) => fetch(url, init), built).catch(() => null);
    void reading.then((now) => { if (live && now && JSON.stringify(now) !== JSON.stringify(built)) setList(now); });
    return () => { live = false; };
  }, [built]);
  return list;
}

function Files({ r }: { r: Release }) {
  return (
    <div className="table-wrap doc">
      <table className="downloads">
        <thead><tr><th>Platform</th><th>File</th><th>Size</th><th>SHA-256</th></tr></thead>
        <tbody>
          {r.files.map((f) => (
            <tr key={f.name}>
              <td>{f.platform}</td>
              {/* On a phone the checksum moves under the file name: a column of its own is four characters wide there. */}
              <td><a className="link" href={f.url}>{f.name}</a><span className="sha-narrow"><span className="eyebrow">SHA-256</span> <code>{f.sha256}</code></span></td>
              <td className="size">{f.size}</td>
              <td className="sha-wide"><code>{f.sha256}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The newest version's files, the Mac disk images when it has none, and every older version.
 * dates and noted: the changelog's, as the site was built. A version newer than the build
 * has neither yet, so it shows no date and no link to an entry the site does not have.
 */
export function ReleaseList({ built, dates, noted }: { built: Release[]; dates: Record<string, string>; noted: string[] }) {
  const list = useReleases(built);
  const [latest, ...older] = list;
  const dmgs = diskImages(list);
  const changes = (version: string) => (noted.includes(version) ? <Link className="link" href={`/changelog/#v${version}`}>What changed</Link> : null);
  if (!latest) return null;
  return (
    <>
      <div>
        <h2 className="h1">Version {latest.version}</h2>
        <p className="release-meta">
          <span className="eyebrow eyebrow-ember">Latest</span>
          {dates[latest.version] ? <span className="eyebrow">{dates[latest.version]}</span> : null}
          {changes(latest.version)}
        </p>
        <Files r={latest} />
      </div>
      {dmgs ? (
        <div className="stack" id="disk-images">
          <h2 className="h2">macOS disk images</h2>
          <p className="body-lg">Version {latest.version} comes for macOS as a .zip: open it, and drag knitted to Applications. If you would rather have a disk image (.dmg), the newest is version {dmgs.version}&rsquo;s. Install it, and knitted updates itself to {latest.version} the first time it checks for updates.</p>
          <Files r={dmgs} />
        </div>
      ) : null}
      {older.length > 0 && (
        <div className="stack" id="older-versions">
          <h2 className="h2">Older versions</h2>
          <p className="body-lg">Every release stays here, with its checksums. To go back, install an older one over the newer: if the newer one updated your library, it kept a backup from before, in Settings, Storage. knitted then offers the newest again, so turn off the automatic check in the knitted menu (the Help menu on Windows and Linux) to stay.</p>
          <div>
            {older.map((r) => (
              <details key={r.version} className="older-release">
                <summary><span className="label">Version {r.version}</span>{dates[r.version] ? <span className="eyebrow">{dates[r.version]}</span> : null}</summary>
                {noted.includes(r.version) ? <p className="release-meta">{changes(r.version)}</p> : null}
                <Files r={r} />
              </details>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
