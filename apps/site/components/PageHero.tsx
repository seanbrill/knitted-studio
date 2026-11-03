import { Nav } from "./Nav";

/** The ember band that opens every inner page: nav, eyebrow, short headline, one line. */
export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: React.ReactNode; lead?: string }) {
  return (
    <div className="field-ember page-hero">
      <Nav />
      <div className="wrap page-hero-body">
        <p className="eyebrow on-field">{eyebrow}</p>
        <h1 className="display">{title}</h1>
        {lead ? <p className="body-lg lead">{lead}</p> : null}
      </div>
    </div>
  );
}
