import Link from "next/link";
import { Badge } from "../../components/Badge";
import { PageHero } from "../../components/PageHero";
import changelog from "../../content/changelog.json";
import releases from "../../content/releases.json";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Changelog",
  description: "What has changed in knitted.studio, newest first.",
  path: "/changelog/",
});

// The versions the Download page offers, from the same list. A release's entry is on main
// before npm run release uploads its installers, so until then it says it is not out yet,
// and nobody goes looking for it. With no list at all (a build without the key), nothing is marked.
const out = new Set((releases.releases as { version: string }[]).map((r) => r.version));
const notOut = (version: string) => out.size > 0 && !out.has(version);

export default function Changelog() {
  return (
    <>
      <PageHero eyebrow="Changelog" title="Row by row." lead="What changed, newest first." />
      <section className="sec-tight">
        <div className="wrap-narrow doc">
          {changelog.entries.map((e) => (
            <article key={e.version} id={`v${e.version}`} className="changelog-entry">
              <h2>{e.version}: {e.title}</h2>
              <p className="eyebrow">{e.date}</p>
              {notOut(e.version) && <p><Badge status="soon" /> The <Link className="link" href="/download/">Download page</Link> has the newest version you can install.</p>}
              <ul>{e.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
