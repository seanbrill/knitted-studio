import Link from "next/link";
import { DownloadButton } from "../../components/DownloadButton";
import { PageHero } from "../../components/PageHero";
import changelog from "../../content/changelog.json";
import releases from "../../content/releases.json";
import { diskImages, type Release } from "../../lib/downloads";
import { GITHUB } from "../../lib/site";
import { pageMeta } from "../../lib/meta";

// Written by scripts/fetch-releases.mjs from the FileFreak release folder when the site is
// built, newest first. The pipeline builds the site on every push to main; installed apps
// read the folder themselves (apps/studio/electron/update.mjs).
const released = (releases.releases as Release[]).length > 0;
const dates = new Map(changelog.entries.map((e) => [e.version, e.date]));
const noted = new Set(changelog.entries.map((e) => e.version));

/** What changed in a version, on the changelog, when it has an entry there. */
const changes = (version: string) => (noted.has(version) ? <Link className="link" href={`/changelog/#v${version}`}>What changed</Link> : null);

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

export const metadata = pageMeta({
  title: "Download",
  description: released
    ? "Download the knitted.studio desktop app. Free and open source, and it works offline."
    : "The knitted.studio desktop app for Windows, macOS and Linux is not released yet. Star the project on GitHub to follow along.",
  path: "/download/",
});

export default function Download() {
  const list = releases.releases as Release[];
  const [latest, ...older] = list;
  // The pipeline publishes a version with the Mac app as a .zip only; a Mac adds the .dmg.
  const dmgs = diskImages(list);
  return (
    <>
      <PageHero eyebrow="Download" title={list.length ? "Get the app." : "Not released yet."} lead={list.length
        ? "Free and open source. Everything it needs comes with it, including the video tools, and it works offline. These early builds have no developer certificate yet, so your computer asks for one extra click the first time: the install guide shows where."
        : "A desktop app for Windows, macOS and Linux is planned. Until it exists, there is nothing to download, and this page will not pretend otherwise."}>
        {list.length ? <DownloadButton version={list[0].version} files={list[0].files} diskImages={dmgs} /> : null}
      </PageHero>
      <section className="sec-tight">
        <div className="wrap-narrow stack-lg" id="all-downloads">
          {list.length === 0 ? (
            <div className="stack">
              <h2 className="h1">Follow along</h2>
              <p className="body-lg">Starring the project on GitHub is the best way to see the first release the moment it lands.</p>
              <p><a href={GITHUB} className="btn btn-primary btn-lg">Star on GitHub</a></p>
              <h3 className="h2" style={{ marginTop: "var(--space-8)" }}>Planned platforms</h3>
              <ul className="grid grid-3" style={{ listStyle: "none", padding: 0 }}>
                {["Windows", "macOS", "Linux"].map((p) => (
                  <li key={p} className="card card-pad"><span className="label">{p}</span><br /><span className="eyebrow">Not released yet</span></li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div>
                <h2 className="h1">Version {latest.version}</h2>
                <p className="release-meta">
                  <span className="eyebrow eyebrow-ember">Latest</span>
                  {dates.has(latest.version) ? <span className="eyebrow">{dates.get(latest.version)}</span> : null}
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
                        <summary><span className="label">Version {r.version}</span>{dates.has(r.version) ? <span className="eyebrow">{dates.get(r.version)}</span> : null}</summary>
                        {noted.has(r.version) ? <p className="release-meta">{changes(r.version)}</p> : null}
                        <Files r={r} />
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="stack">
            <h2 className="h1">What to expect</h2>
            <p className="body-lg">The first installers are previews without a developer certificate, so your computer shows a warning the first time you open one. That is expected, and the <Link className="link" href="/download/install/">install guide</Link> walks through it.</p>
            <h3 className="h2">Requirements</h3>
            <p className="body-lg">Knitting stills and motion uses a browser engine and ffmpeg. The desktop app brings ffmpeg with it and downloads its browser engine once, the first time you knit, when you say so. If you run from source, you install Playwright and ffmpeg yourself. See the <Link className="link" href="/docs/quick-start/">quick start</Link>.</p>
            <p className="body-lg">Want to run it today? You can <Link className="link" href="/open-source/">run it from source</Link>.</p>
          </div>
        </div>
      </section>
    </>
  );
}
