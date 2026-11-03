import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import { Demo } from "../../components/Demo";
import { ChevronRow } from "../../components/Chevrons";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "How it works",
  description: "Pattern once, knit forever. Locked stitches hold your brand, free stitches are yours to change, and your model follows the same rules.",
  path: "/how-it-works/",
});

export default function HowItWorks() {
  return (
    <>
      <PageHero eyebrow="How it works" title="Pattern once. Knit forever." lead="One idea runs through everything: decide the brand once, then change only what should change." />
      <section className="sec">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow eyebrow-ember">Try it</p>
            <h2 className="display">Locked or free.</h2>
            <p className="body-lg prose muted">Click a locked stitch on the post and it will politely refuse. Then edit the headline and watch six sizes follow.</p>
          </div>
          <Demo />
        </div>
      </section>
      <section className="sec field-white">
        <div className="wrap-narrow doc">
          <h2>What locked means</h2>
          <p>A locked stitch is drawn with a dashed orange outline. It is the part of the Pattern the brand decided: the logo, the colours, the type. Whoever uses the Pattern cannot move or restyle it.</p>
          <p>A free stitch has a plain solid outline. The headline, the photo and the caption are usually free. They are yours to change, one post at a time.</p>
          <h2>Your model follows the same rules</h2>
          <p>When your model fills a Pattern it works by slot name, such as <code>headline</code>. If it tries to write into a locked slot, the write is refused and the refusal comes back in the reply. It is never skipped quietly. Unlocking is something a person does in the studio.</p>
          <h2>Then you knit</h2>
          <p>Knitting turns a Pattern into files: stills, and motion built frame by frame. Ask for twelve and you get twelve files, not twelve descriptions of files.</p>
          <div className="chev-divider" style={{ justifyContent: "flex-start" }}><ChevronRow count={6} /></div>
          <p>Want the details? Read <Link className="link" href="/docs/the-vocabulary/">the vocabulary</Link>, or see <Link className="link" href="/mcp/">how your model uses it</Link>.</p>
        </div>
      </section>
    </>
  );
}
