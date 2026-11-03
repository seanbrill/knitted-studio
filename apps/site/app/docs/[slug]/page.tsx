import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHero } from "../../../components/PageHero";
import { DocsShell } from "../../../components/DocsShell";
import { CopyCode } from "../../../components/CopyCode";
import { allDocs, renderDoc } from "../../../lib/docs";
import { pageMeta } from "../../../lib/meta";
import { GITHUB } from "../../../lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = allDocs().find((x) => x.slug === slug);
  return pageMeta({ title: d?.title ?? "Docs", description: d?.summary ?? "knitted.studio docs", path: `/docs/${slug}/` });
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const docs = allDocs();
  const i = docs.findIndex((d) => d.slug === slug);
  if (i < 0) notFound();
  const doc = docs[i];
  const html = renderDoc(doc);
  const prev = docs[i - 1];
  const next = docs[i + 1];
  return (
    <>
      <PageHero eyebrow="Docs" title={doc.title} lead={doc.summary} />
      <div className="wrap">
        <DocsShell docs={docs} current={slug}>
          {doc.status !== "shipped" ? (
            <div className="notice notice-soon" style={{ marginBottom: "var(--space-8)" }} role="note">
              <strong>{doc.status === "soon" ? "Coming soon." : "Partly available."}</strong>{" "}
              {doc.note || (doc.status === "soon" ? "This describes something that is not built yet." : "Some of this is not built yet.")}
            </div>
          ) : null}
          <article id="doc-body" className="doc" dangerouslySetInnerHTML={{ __html: html }} />
          <CopyCode targetId="doc-body" />
          <p className="docs-edit body-sm">
            <a className="link" href={`${GITHUB}/edit/main/docs/user/${doc.file}`}>Edit this page on GitHub</a>
          </p>
          <nav className="docs-nav" aria-label="Previous and next">
            {prev ? <Link href={`/docs/${prev.slug}/`}><span className="eyebrow">Previous</span>{prev.title}</Link> : <span />}
            {next ? <Link href={`/docs/${next.slug}/`}><span className="eyebrow">Next</span>{next.title}</Link> : <span />}
          </nav>
        </DocsShell>
      </div>
    </>
  );
}
