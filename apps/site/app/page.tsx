import Link from "next/link";
import home from "../content/home.json";
import gallery from "../content/gallery.json";
import releases from "../content/releases.json";
import { Nav } from "../components/Nav";
import { ChevronField, ChevronRow } from "../components/Chevrons";
import { Demo } from "../components/Demo";
import { PostArt, type Theme, type Layout } from "../components/PostArt";
import { Reveal } from "../components/Reveal";
import { Badge } from "../components/Badge";
import { feature } from "../lib/features";
import { GITHUB, SITE_URL, TAGLINE } from "../lib/site";

const ld = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "knitted.studio",
  url: SITE_URL,
  description: TAGLINE,
  applicationCategory: "DesignApplication",
  operatingSystem: "Windows, macOS, Linux",
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  codeRepository: GITHUB,
};

const icon = (d: string) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
);

// content/releases.json is filled from the release folder when the site is built.
const released = releases.releases.length > 0;

export default function Home() {
  const h = home;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      {/* 1. Hero */}
      <section className="field-ember hero" aria-labelledby="hero-title">
        <Nav />
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow on-field">{h.hero.eyebrow}</p>
            <h1 id="hero-title" className="display-xl">
              Make it <span className="accent">knitted.</span>
            </h1>
            <p className="body-lg lead">{h.hero.sub}</p>
            <div className="cta-row">
              <a href={GITHUB} className="btn btn-dark btn-lg">{h.hero.cta}</a>
              <Link href="/how-it-works/" className="link-on-field">{h.hero.ghost}</Link>
            </div>
          </div>
          <figure className="hero-visual" style={{ margin: 0 }}>
            <div className="mock" aria-hidden="true">
              <div className="mock-rail"><i /><i /><i /><i /></div>
              <div className="mock-canvas">
                <PostArt theme="cream" layout="headline" eyebrow="New this week" headline="Make it knitted." tag="Pattern: Launch story" aspect="4 / 5" alt="" className="" />
              </div>
            </div>
            <figcaption className="caption">Illustration of the studio. The editor is still being built.</figcaption>
          </figure>
        </div>
      </section>
      <div className="honest-strip">
        <div className="wrap"><p><strong>Early days</strong> {h.hero.strip}</p></div>
      </div>

      {/* 2. The idea in one picture */}
      <section className="sec" id="idea" aria-labelledby="idea-title">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">{h.idea.eyebrow}</p>
            <h2 id="idea-title" className="display">{h.idea.title}</h2>
            <p className="body-lg prose muted">{h.idea.lead}</p>
          </div>
          <Demo />
        </div>
      </section>

      {/* 3. Three steps */}
      <section className="sec field-white" aria-labelledby="steps-title" id="how">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">{h.steps.eyebrow}</p>
            <h2 id="steps-title" className="display">{h.steps.title}</h2>
          </div>
          <Reveal>
            <ol className="grid grid-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {h.steps.items.map((s) => (
                <li key={s.n} className="card card-pad step">
                  <span className="step-num">{s.n}</span>
                  <h3 className="h2">{s.title}</h3>
                  <p className="body-lg muted" style={{ margin: 0 }}>{s.text}</p>
                </li>
              ))}
            </ol>
          </Reveal>
          <div className="chev-divider"><ChevronRow count={7} /></div>
        </div>
      </section>

      {/* 4. Brand lock */}
      <section className="sec field-oxblood" aria-labelledby="lock-title">
        <div className="wrap">
          <p className="eyebrow">{h.lock.eyebrow}</p>
          <h2 id="lock-title" className="display" style={{ margin: "var(--space-3) 0 var(--space-6)" }}>{h.lock.title}</h2>
          <p className="body-lg prose">{h.lock.text}</p>
          <div className="lockrow">
            <div className="stitch-locked"><span className="eyebrow" style={{ color: "var(--ember-ink)" }}>Locked by the pattern</span><p className="label">Logo, colours, type</p></div>
            <div className="stitch-free"><span className="eyebrow">Free to change</span><p className="label">Headline, photo, caption</p></div>
          </div>
          <p style={{ marginTop: "var(--space-6)" }}>
            <Badge status={feature("locked-stitches").status} />
          </p>
        </div>
      </section>

      {/* 5. Two front doors */}
      <section className="sec" aria-labelledby="doors-title">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">{h.doors.eyebrow}</p>
            <h2 id="doors-title" className="display">{h.doors.title}</h2>
          </div>
          <div className="split">
            <div className="card door">
              <h3 className="h1">{h.doors.studio.title}</h3>
              <p className="body-lg muted">{h.doors.studio.text}</p>
              <p><Badge status={feature("pattern-editor").status} /></p>
              <div className="stitch-free" style={{ padding: "var(--space-4)", marginTop: "var(--space-4)" }}>
                <span className="eyebrow">Headline, free</span>
                <p className="label" style={{ margin: "4px 0 0" }}>Make it knitted.</p>
              </div>
              <div className="stitch-locked" style={{ padding: "var(--space-4)", marginTop: "var(--space-3)" }}>
                <span className="eyebrow">Logo, locked</span>
              </div>
            </div>
            <div className="card door">
              <h3 className="h1">{h.doors.model.title}</h3>
              <p className="body-lg muted">{h.doors.model.text}</p>
              <p><Badge status="shipped" /></p>
              <pre className="term" tabIndex={0} aria-label="Example transcript of a model calling fill_slots">
{`your model  `}<span className="dim">fill_slots</span>{`
  headline: "Make it knitted."
  eyebrow:  "Big news"

knitted     `}<span className="ok">filled</span>{`  headline
            `}<span className="bad">refused</span>{` eyebrow
              locked by the pattern;
              unlock it in the studio first`}
              </pre>
              <p className="body-sm muted">Example of the real response shape. <Link className="link" href="/mcp/">See the MCP tools</Link>.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Motion and voice */}
      <section className="sec field-sunken" aria-labelledby="motion-title">
        <div className="wrap split">
          <div>
            <p className="eyebrow eyebrow-ember">{h.motion.eyebrow}</p>
            <h2 id="motion-title" className="display" style={{ margin: "var(--space-3) 0 var(--space-6)" }}>{h.motion.title}</h2>
            <p className="body-lg prose">{h.motion.text}</p>
          </div>
          <div className="stack">
            <div className="card card-pad">
              <h3 className="h2">Frame-accurate animation</h3>
              <p className="muted">Easing, fades and slides in real brand type.</p>
              <Badge status={feature("render-engine").status} />
            </div>
            <div className="card card-pad">
              <h3 className="h2">Local voiceover</h3>
              <p className="muted">{h.motion.voice}</p>
              <Badge status={feature("local-voiceover").status} />
            </div>
          </div>
        </div>
      </section>

      {/* 7. Gallery strip */}
      <section className="sec" aria-labelledby="gallery-title">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">{h.gallery.eyebrow}</p>
            <h2 id="gallery-title" className="display">{h.gallery.title}</h2>
            <p className="body prose muted">{h.gallery.note}</p>
          </div>
          <Reveal>
            <ul className="gallery-strip" style={{ listStyle: "none", margin: 0 }} aria-label="Sample patterns" tabIndex={0}>
              {gallery.items.slice(0, 8).map((g) => (
                <li key={g.id}>
                  <PostArt theme={g.theme as Theme} layout={g.layout as Layout} eyebrow={g.eyebrow} headline={g.headline} tag={g.tag} aspect={g.aspect} alt={g.alt} />
                </li>
              ))}
            </ul>
          </Reveal>
          <p><Link className="link" href="/gallery/">See all sample patterns</Link></p>
        </div>
      </section>

      {/* 8. Local, private, open */}
      <section className="sec field-white" aria-labelledby="local-title">
        <div className="wrap">
          <p className="eyebrow eyebrow-ember">{h.local.eyebrow}</p>
          <h2 id="local-title" className="h1" style={{ margin: "var(--space-3) 0 var(--space-8)" }}>Yours to keep.</h2>
          <div className="icons">
            {h.local.items.map((it, i) => (
              <div key={it.title}>
                {icon(["M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01", "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M16 18l6-6-6-6M8 6l-6 6 6 6"][i])}
                <h3 className="h2">{it.title}</h3>
                <p className="body-lg muted" style={{ margin: "var(--space-2) 0 0" }}>{it.text}</p>
              </div>
            ))}
          </div>
          <p style={{ marginTop: "var(--space-8)" }}><a className="link" href={GITHUB}>Read the source on GitHub</a></p>
        </div>
      </section>

      {/* 9. Final CTA */}
      <section className="final field-ember" aria-labelledby="final-title">
        <ChevronField />
        <div className="wrap">
          <p className="eyebrow">{h.final.eyebrow}</p>
          <h2 id="final-title" className="display-xl">{h.final.title}</h2>
          <p className="body-lg prose" style={{ marginBottom: "var(--space-8)" }}>{released ? h.final.released : h.final.text}</p>
          <div className="cta-row">
            <a href={GITHUB} className="btn btn-dark btn-lg">Star on GitHub</a>
            <Link href="/download/" className="link-on-field">{released ? "Download for Windows, macOS and Linux" : "Windows, macOS and Linux: not released yet"}</Link>
          </div>
        </div>
      </section>
    </>
  );
}
