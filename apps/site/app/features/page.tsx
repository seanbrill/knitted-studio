import { PageHero } from "../../components/PageHero";
import { Badge } from "../../components/Badge";
import { GROUPS, FEATURES } from "../../lib/features";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Features",
  description: "Patterns, Swatches, Yarn, Parts, Motion, Voice, your model and posting. What knitted.studio does today, and anything still coming.",
  path: "/features/",
});

export default function Features() {
  const shipped = FEATURES.filter((f) => f.status === "shipped").length;
  return (
    <>
      <PageHero eyebrow="Features" title="Everything on the needle." lead="What you work with. Each one says plainly whether it is available now or still coming." />
      <div className="wrap">
        <p className="notice" style={{ margin: "var(--space-10) 0 0" }}>
          {shipped === FEATURES.length
            ? <>All {FEATURES.length} features here are available today. Anything still to come is labelled <strong>Coming soon</strong>, and is not a promise with a date.</>
            : <>{shipped} of {FEATURES.length} features are available today. The rest are labelled <strong>Coming soon</strong> and are not promises with dates.</>}
        </p>
        {GROUPS.map((g) => (
          <section key={g.id} className="feature-group" id={g.id} aria-labelledby={`${g.id}-t`}>
            <p className="eyebrow eyebrow-ember">{g.name}</p>
            <h2 id={`${g.id}-t`} className="h1" style={{ fontSize: 40 }}>{g.line}</h2>
            <p className="line" />
            <div className="grid grid-2">
              {FEATURES.filter((f) => f.group === g.id).map((f) => (
                <article key={f.id} className="card feature">
                  <Badge status={f.status} />
                  <h3 className="h2">{f.name}</h3>
                  <p className="body-lg">{f.summary}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
