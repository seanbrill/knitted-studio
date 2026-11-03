import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import { DocsShell } from "../../components/DocsShell";
import { Badge } from "../../components/Badge";
import { allDocs } from "../../lib/docs";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Docs",
  description: "Quick start, the vocabulary, guides for every part of knitted.studio, the MCP reference and the FAQ. Pages for unbuilt features say so.",
  path: "/docs/",
});

export default function DocsIndex() {
  const docs = allDocs();
  return (
    <>
      <PageHero eyebrow="Docs" title="Learn the stitches." lead="Written for people who are not engineers. Pages about things that are not built yet say so at the top." />
      <div className="wrap">
        <DocsShell docs={docs}>
          <ul className="docs-index-grid" style={{ marginTop: 0 }}>
            {docs.map((d) => (
              <li key={d.slug}>
                <Link href={`/docs/${d.slug}/`} className="card">
                  <span className="h3" style={{ display: "block" }}>{d.title}</span>
                  <p className="body-sm">{d.summary}</p>
                  {d.status === "soon" ? <Badge status="soon" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </DocsShell>
      </div>
    </>
  );
}
