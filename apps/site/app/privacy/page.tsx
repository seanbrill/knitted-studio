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
          <p>If you connect Claude Code or another app at the address in Settings, Model, that app can read and change your library, the same way the in-app model can, and what it sends to its own model is under its own terms.</p>
          <h2>Social accounts</h2>
          <p>If you connect an account in Settings, Social, the app signs in through a developer app you made on that platform, and keeps the sign-in in your computer&rsquo;s secret store. What you post goes from your computer to the platform. Instagram and Threads fetch pictures and video from a public address, so the app puts those files in storage you chose, just before posting, and removes them after.</p>
          <p>Instagram, Threads, LinkedIn and X send your browser back to a page on this site after you sign in, because they need a web address and the app has none. That page hands what they sent on to the app on your computer. It keeps nothing and sends it nowhere else, though, like any address you open, it reaches the host that serves this site. The code in it works once, for a few minutes, and only with what the app kept on your computer when you pressed Connect.</p>
          <h2>Updates</h2>
          <p>The app asks once whether to check for updates by itself. If you say yes, it reads the list of releases once a day, the way a browser opens a page, and sends nothing about your work. It reads the list in the release folder on FileFreak, where the installers are kept, or this website&rsquo;s copy if it cannot (versions before 0.1.2 always ask this website). When you install an update, it downloads that file from the release folder. You can turn the check off in the knitted menu (the Help menu on Windows and Linux), and Check for Updates there works either way.</p>
          <h2>The browser for knitting</h2>
          <p>Knitting draws each frame in a browser of its own, which is not in the installer because it is large (about 100 MB). When the app starts without it, it downloads it once from Playwright&rsquo;s servers, <code>cdn.playwright.dev</code>, or Microsoft&rsquo;s <code>playwright.download.prss.microsoft.com</code> if that one does not answer. It is an ordinary download that sends nothing about your work, and the browser is kept in your data folder.</p>
          <h2>Questions</h2>
          <p>Open an issue on <a className="link" href={GITHUB}>GitHub</a>. A contact email will be added here before launch.</p>
        </div>
      </section>
    </>
  );
}
