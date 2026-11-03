import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import releases from "../../content/releases.json";
import { GITHUB } from "../../lib/site";
import { pageMeta } from "../../lib/meta";

interface Release { version: string; files: { platform: string; name: string; url: string; size: string; sha256: string }[] }
// Written by scripts/fetch-releases.mjs from the FileFreak release folder when the site is built.
const released = (releases.releases as Release[]).length > 0;

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
        ? "Free and open source. Everything it needs comes with it, including the video tools, and it works offline. These are early, unsigned builds: the install guide shows the one extra click your computer asks for."
        : "A desktop app for Windows, macOS and Linux is planned. Until it exists, there is nothing to download, and this page will not pretend otherwise."} />
      <section className="sec-tight">
        <div className="wrap-narrow stack-lg">
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
            list.map((r) => (
              <div key={r.version}>
                <h2 className="h1">Version {r.version}</h2>
                <div className="table-wrap doc">
                  <table>
                    <thead><tr><th>Platform</th><th>File</th><th>Size</th><th>SHA-256</th></tr></thead>
                    <tbody>
                      {r.files.map((f) => (
                        <tr key={f.name}><td>{f.platform}</td><td><a className="link" href={f.url}>{f.name}</a></td><td>{f.size}</td><td><code>{f.sha256}</code></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
          <div className="stack">
            <h2 className="h1">What to expect</h2>
            <p className="body-lg">The first installers will be unsigned previews. Your computer will show a warning the first time you open them. That is expected, and the <Link className="link" href="/download/install/">install guide</Link> walks through it.</p>
            <h3 className="h2">Requirements</h3>
            <p className="body-lg">Knitting stills and motion uses a browser engine and ffmpeg. The desktop app brings ffmpeg with it and downloads its browser engine once, the first time you knit, when you say so. If you run from source, you install Playwright and ffmpeg yourself. See the <Link className="link" href="/docs/quick-start/">quick start</Link>.</p>
            <p className="body-lg">Want to run it today? You can <Link className="link" href="/open-source/">run it from source</Link>.</p>
          </div>
        </div>
      </section>
    </>
  );
}
