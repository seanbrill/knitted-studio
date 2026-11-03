import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import { GITHUB } from "../../lib/site";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Open source",
  description: "knitted.studio is MIT licensed. Read the source, run it from a clone, and help build it.",
  path: "/open-source/",
});

export default function OpenSource() {
  return (
    <>
      <PageHero eyebrow="Open source" title="Free forever." lead="MIT licensed. Read it, change it, keep it." />
      <section className="sec-tight">
        <div className="wrap-narrow doc">
          <h2>Licence</h2>
          <p>knitted.studio is released under the MIT licence. You can use it for your own work, change it and share it, including commercially.</p>
          <h2>Run it from source</h2>
          <p>You need Node 22.13 or newer.</p>
          <pre tabIndex={0}><code>{`git clone ${GITHUB}.git
cd knitted-studio
npm install
npm run dev`}</code></pre>
          <p>That starts the studio shell and this site side by side. Knitting needs Playwright and ffmpeg too, as the <Link className="link" href="/docs/quick-start/">quick start</Link> explains.</p>
          <h2>Roadmap</h2>
          <p>Every feature and whether it is built yet is listed on the <Link className="link" href="/features/">features page</Link>. The order of work is public in the repository.</p>
          <h2>Contributing</h2>
          <p>Read <a className="link" href={`${GITHUB}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</a>. One house rule: no em dashes, anywhere.</p>
          <p><a className="link" href={GITHUB}>knitted-studio on GitHub</a></p>
        </div>
      </section>
    </>
  );
}
