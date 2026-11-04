import { PageHero } from "../../components/PageHero";
import changelog from "../../content/changelog.json";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Changelog",
  description: "What has changed in knitted.studio, newest first.",
  path: "/changelog/",
});

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
              <ul>{e.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
