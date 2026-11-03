import { Mark } from "./Logo";
import { ChevronField } from "./Chevrons";

export type Theme = "ember" | "red" | "oxblood" | "cream" | "ink";
export type Layout = "headline" | "quote" | "stat" | "chevrons";

export interface PostArtProps {
  theme: Theme;
  layout: Layout;
  eyebrow: string;
  headline: string;
  tag: string;
  aspect: string;
  alt: string;
  /** When set, the locked stitches become buttons that call this with their name. */
  onLocked?: (name: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A sample post drawn from the brand tokens: HTML and CSS only, no image files.
 * Every size is in cqmin, so the same composition holds at any canvas size,
 * which is the point of a Pattern.
 */
export function PostArt({ theme, layout, eyebrow, headline, tag, aspect, alt, onLocked, className = "", style }: PostArtProps) {
  const interactive = Boolean(onLocked);
  const lock = (name: string, label: string, content: React.ReactNode, cls: string, visible?: string) =>
    interactive ? (
      <button type="button" className={`art-lock ${cls}`} onClick={() => onLocked?.(name)} aria-label={`${visible ?? label}, locked`}>
        {content}
      </button>
    ) : (
      <span className={cls}>{content}</span>
    );

  const body = (
    <div className="art-in">
      {layout === "chevrons" ? <ChevronField className="art-chev" /> : null}
      <div className="art-top">
        {lock("Logo", "Logo", <Mark size={64} />, "art-logo")}
        {interactive ? lock("Brand colour", "Brand colour", <span className="art-dot" />, "art-colour") : null}
      </div>
      <div className={`art-main art-${layout}`}>
        <span className="art-eyebrow">{eyebrow}</span>
        <span className={`art-headline ${interactive ? "stitch-free" : ""}`}>{headline}</span>
      </div>
      <div className="art-foot">{lock("Footer line", "Footer line", tag, "art-tag", tag)}</div>
    </div>
  );

  // A decorative composition: described once from outside, its inner text is not read twice.
  if (interactive) {
    return (
      <div className={`art art-${theme} ${className}`} style={{ aspectRatio: aspect, ...style }} role="group" aria-label={alt}>
        {body}
      </div>
    );
  }
  return (
    <div className={`art art-${theme} ${className}`} style={{ aspectRatio: aspect, ...style }} role="img" aria-label={alt}>
      {body}
    </div>
  );
}
