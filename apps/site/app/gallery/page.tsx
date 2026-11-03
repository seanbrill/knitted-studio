import { PageHero } from "../../components/PageHero";
import { PostArt, type Theme, type Layout } from "../../components/PostArt";
import { Reveal } from "../../components/Reveal";
import gallery from "../../content/gallery.json";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Gallery of sample patterns",
  description: "Sample patterns drawn from the knitted.studio brand tokens: stories, squares, portraits and wide ads. Not real knitted output yet.",
  path: "/gallery/",
});

export default function Gallery() {
  return (
    <>
      <PageHero eyebrow="Sample patterns" title="What a pattern looks like." lead="Ten compositions in the sizes people actually post." />
      <section className="sec-tight">
        <div className="wrap">
          <p className="notice">
            These are <strong>sample patterns</strong>, drawn from the knitted.studio brand tokens with plain HTML and CSS. They are not output from the studio yet, because the studio is still being built. When it can knit, real work replaces them. They use only our own brand, no stock photos and no one else&rsquo;s logo.
          </p>
          <Reveal className="gallery-grid" >
            {gallery.items.map((g) => (
              <figure key={g.id}>
                <PostArt theme={g.theme as Theme} layout={g.layout as Layout} eyebrow={g.eyebrow} headline={g.headline} tag={g.tag} aspect={g.aspect} alt={g.alt} />
                <figcaption>
                  <span className="label">{g.title}</span>
                  <br />
                  <span className="eyebrow">{g.format}</span>
                </figcaption>
              </figure>
            ))}
          </Reveal>
        </div>
      </section>
    </>
  );
}
