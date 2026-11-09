import Link from "next/link";
import { DownloadButton } from "../../components/DownloadButton";
import { PageHero } from "../../components/PageHero";
import { ReleaseList } from "../../components/Releases";
import changelog from "../../content/changelog.json";
import releases from "../../content/releases.json";
import type { Release } from "../../lib/downloads";
import { GITHUB } from "../../lib/site";
import { pageMeta } from "../../lib/meta";

// Written by scripts/fetch-releases.mjs from the FileFreak release folder when the site is
// built, newest first. It is what the page shows first; in the browser the page then reads
// the folder as it is now (components/Releases.tsx). Installed apps read the folder
// themselves too (apps/studio/electron/update.mjs).
const released = (releases.releases as Release[]).length > 0;
// The changelog as the site was built, for the dates and the links to each version's entry.
const dates = Object.fromEntries(changelog.entries.map((e) => [e.version, e.date]));
const noted = changelog.entries.map((e) => e.version);

export const metadata = pageMeta({
  title: "Download",
  description: released
    ? "Download the knitted.studio desktop app. Free and open source, and it works offline."
    : "The knitted.studio desktop app for Windows, macOS and Linux is not released yet. Star the project on GitHub to follow along.",
  path: "/download/",
});

export default function Download() {
  const list = releases.releases as Release[];
  return (
    <>
      <PageHero eyebrow="Download" title={list.length ? "Get the app." : "Not released yet."} lead={list.length
        ? "Free and open source. Everything it needs comes with it, including the video tools, and it works offline. These early builds have no developer certificate yet, so your computer asks for one extra click the first time: the install guide shows where."
        : "A desktop app for Windows, macOS and Linux is planned. Until it exists, there is nothing to download, and this page will not pretend otherwise."}>
        {list.length ? <DownloadButton built={list} /> : null}
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
            <ReleaseList built={list} dates={dates} noted={noted} />
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
