import Link from "next/link";
import home from "../content/home.json";
import releases from "../content/releases.json";
import { Nav } from "../components/Nav";
import { ChevronField, ChevronRow } from "../components/Chevrons";
import { Demo } from "../components/Demo";
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
const latest = (releases.releases as { version: string }[])[0];
const released = !!latest;

export default function Home() {
  const h = home;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      {/* 1. Hero: what it is, in one line, and the studio itself */}
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
              {released
                ? <Link href="/download/" className="btn btn-dark btn-lg">{h.hero.cta}</Link>
                : <a href={GITHUB} className="btn btn-dark btn-lg">Star on GitHub</a>}
              <Link href="/how-it-works/" className="link-on-field">{h.hero.ghost}</Link>
            </div>
            <p className="hero-facts">{released ? `Version ${latest.version} · ` : ""}Windows, macOS and Linux · MIT licensed</p>
          </div>
          <figure className="hero-visual hero-shot" style={{ margin: 0 }}>
            <div className="shot-window"><img src="/shots/studio-editor.jpg" width={1440} height={900} alt="The knitted studio's pattern editor, with a post on the canvas, the project's patterns and layers on the left and its settings on the right" /></div>
            <img className="hero-knit hero-knit-1" src="/shots/knits/five-gb-free.jpg" width={432} height={540} alt="" />
            <img className="hero-knit hero-knit-2" src="/shots/knits/share-links.jpg" width={432} height={540} alt="" />
            <span className="hero-model" aria-hidden="true"><i />Claude Code · Filling the headline</span>
            <figcaption className="sr-only">{h.hero.caption}</figcaption>
          </figure>
        </div>
      </section>
      <div className="today-strip">
        <div className="wrap">
          <p className="today-label">{h.today.label}</p>
          <ul aria-label={h.today.label}>{h.today.items.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>

      {/* 2. Three steps, each as it looks in the studio */}
      <section className="sec field-white" aria-labelledby="steps-title" id="how">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">{h.steps.eyebrow}</p>
            <h2 id="steps-title" className="display">{h.steps.title}</h2>
          </div>
          <Reveal>
            <ol className="grid grid-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {h.steps.items.map((s) => (
                <li key={s.n} className="card card-pad step step-shot">
                  <span className="step-num">{s.n}</span>
                  <h3 className="h2">{s.title}</h3>
                  <p className="body-lg muted">{s.text}</p>
                  <img src={s.shot} width={1440} height={900} alt={s.alt} loading="lazy" />
                </li>
              ))}
            </ol>
          </Reveal>
          <div className="chev-divider"><ChevronRow count={7} /></div>
        </div>
      </section>

      {/* 3. The idea in one picture: a small working model */}
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

      {/* 4. Your model, beside you */}
      <section className="sec field-black" aria-labelledby="model-title" id="model">
        <div className="wrap split split-media">
          <div>
            <p className="eyebrow eyebrow-glow">{h.model.eyebrow}</p>
            <h2 id="model-title" className="display" style={{ margin: "var(--space-3) 0 var(--space-6)" }}>{h.model.title}</h2>
            <p className="body-lg prose">{h.model.text}</p>
            <ul className="ticks">{h.model.ticks.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="body-sm"><Link className="link link-glow" href="/mcp/">See what your model can do</Link></p>
          </div>
          <img className="media-shot" src={h.model.shot} width={1440} height={900} alt={h.model.alt} loading="lazy" />
        </div>
      </section>

      {/* 5. Real knits */}
      <section className="sec" aria-labelledby="gallery-title">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">{h.gallery.eyebrow}</p>
            <h2 id="gallery-title" className="display">{h.gallery.title}</h2>
            <p className="body prose muted">{h.gallery.note}</p>
          </div>
          <Reveal>
            <ul className="knit-strip" aria-label="Knitted posts">
              {h.gallery.items.map((g) => <li key={g.src}><img src={g.src} width={432} height={540} alt={g.alt} loading="lazy" /></li>)}
            </ul>
          </Reveal>
          <p><Link className="link" href="/gallery/">See more knits</Link></p>
        </div>
      </section>

      {/* 6. Brand lock */}
      <section className="sec field-oxblood" aria-labelledby="lock-title">
        <div className="wrap split split-media">
          <div>
            <p className="eyebrow">{h.lock.eyebrow}</p>
            <h2 id="lock-title" className="display" style={{ margin: "var(--space-3) 0 var(--space-6)" }}>{h.lock.title}</h2>
            <p className="body-lg prose">{h.lock.text}</p>
            <p style={{ marginTop: "var(--space-6)" }}><Badge status={feature("locked-stitches").status} /></p>
          </div>
          <div className="stack">
            <div className="lockrow" style={{ marginTop: 0 }}>
              <div className="stitch-locked"><span className="eyebrow" style={{ color: "var(--ember-ink)" }}>Locked by the pattern</span><p className="label">Logo, colours, type</p></div>
              <div className="stitch-free"><span className="eyebrow">Free to change</span><p className="label">Headline, photo, caption</p></div>
            </div>
            <pre className="term" tabIndex={0} aria-label="Example transcript of a model calling fill_slots">
{`your model  `}<span className="dim">fill_slots</span>{`
  headline: "Make it knitted."
  logo:     "a bigger logo"

knitted     `}<span className="ok">filled</span>{`  headline
            `}<span className="bad">refused</span>{` logo
              locked by the pattern;
              ask the person to unlock it`}
            </pre>
          </div>
        </div>
      </section>

      {/* 7. Motion and voice */}
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

      {/* 8. Design sheets */}
      <section className="sec" aria-labelledby="sheets-title">
        <div className="wrap split split-media split-flip">
          <img className="media-shot media-shot-light" src={h.sheets.shot} width={1440} height={900} alt={h.sheets.alt} loading="lazy" />
          <div>
            <p className="eyebrow eyebrow-ember">{h.sheets.eyebrow}</p>
            <h2 id="sheets-title" className="display" style={{ margin: "var(--space-3) 0 var(--space-6)" }}>{h.sheets.title}</h2>
            <p className="body-lg prose muted">{h.sheets.text}</p>
          </div>
        </div>
      </section>

      {/* 9. Local, private, open */}
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

      {/* 10. Final CTA */}
      <section className="final field-ember" aria-labelledby="final-title">
        <ChevronField />
        <div className="wrap">
          <p className="eyebrow">{h.final.eyebrow}</p>
          <h2 id="final-title" className="display-xl">{h.final.title}</h2>
          <p className="body-lg prose" style={{ marginBottom: "var(--space-8)" }}>{released ? h.final.released : h.final.text}</p>
          <div className="cta-row">
            {released
              ? <><Link href="/download/" className="btn btn-dark btn-lg">Download knitted</Link><a href={GITHUB} className="link-on-field">Star on GitHub</a></>
              : <><a href={GITHUB} className="btn btn-dark btn-lg">Star on GitHub</a><Link href="/download/" className="link-on-field">Windows, macOS and Linux: not released yet</Link></>}
          </div>
        </div>
      </section>
    </>
  );
}
