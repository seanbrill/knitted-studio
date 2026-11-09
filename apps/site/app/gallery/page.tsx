import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import { Reveal } from "../../components/Reveal";
import { LoopVideo } from "../../components/LoopVideo";
import gallery from "../../content/gallery.json";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Gallery",
  description: "Real knits from the studio: stories, posts, carousels, reels, squares and wide posts, all from one brand's patterns.",
  path: "/gallery/",
});

type Item = { src: string; w: number; h: number; title: string; alt: string };
type Clip = Item & { poster: string };

export default function Gallery() {
  return (
    <>
      <PageHero eyebrow="Gallery" title="Made with knitted." lead="Real knits, straight out of the studio, in the sizes people post." />
      <section className="sec-tight">
        <div className="wrap">
          <p className="notice">{gallery.note}</p>
          {gallery.groups.map((g) => (
            <section key={g.id} className="knit-group" aria-labelledby={`g-${g.id}`}>
              <header className="knit-group-head">
                <h2 id={`g-${g.id}`} className="h1">{g.title}</h2>
                <p className="eyebrow">{g.size}</p>
                <p className="body-lg muted">{g.text}</p>
              </header>
              <Reveal className={`knit-grid knit-grid-${g.shape}`}>
                {"videos" in g
                  ? (g.videos as Clip[]).map((v) => (
                    <figure key={v.src}>
                      <LoopVideo src={v.src} poster={v.poster} width={v.w} height={v.h} label={v.alt} />
                      <figcaption className="label">{v.title}</figcaption>
                    </figure>
                  ))
                  : (g.items as Item[]).map((it) => (
                    <figure key={it.src}>
                      <img src={it.src} width={it.w} height={it.h} alt={it.alt} loading="lazy" />
                      <figcaption className="label">{it.title}</figcaption>
                    </figure>
                  ))}
              </Reveal>
            </section>
          ))}
          <p className="knit-group-foot body-lg">
            Each set came from patterns made once and filled again and again. <Link className="link" href="/how-it-works/">See how it works</Link>
          </p>
        </div>
      </section>
    </>
  );
}
