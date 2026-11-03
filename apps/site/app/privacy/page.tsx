import { PageHero } from "../../components/PageHero";
import { GITHUB } from "../../lib/site";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Privacy",
  description: "Plain-language privacy for knitted.studio: local first, no tracking, and nothing leaves your computer except what you choose to send.",
  path: "/privacy/",
});

export default function Privacy() {
  return (
    <>
      <PageHero eyebrow="Privacy" title="Nothing leaves your machine." lead="Unless you send it. In plain words." />
      <section className="sec-tight">
        <div className="wrap-narrow doc">
          <h2>This website</h2>
          <p>This site sets no cookies, runs no analytics and loads nothing from other companies. Fonts and scripts come from the same place as the page. We do not know who visits.</p>
          <h2>The studio</h2>
          <p>Your projects, Yarn and knits are plain files in a folder on your computer. The app does not need an account and does not upload your work.</p>
          <p>The only time something leaves your machine is when you choose to connect a service. For example, if you give the app a key for a model, the text you ask it about is sent to that model&rsquo;s provider, under that provider&rsquo;s terms. If you point voiceover at a speech model on your own computer, it stays on your own computer.</p>
          <h2>Questions</h2>
          <p>Open an issue on <a className="link" href={GITHUB}>GitHub</a>. A contact email will be added here before launch.</p>
        </div>
      </section>
    </>
  );
}
