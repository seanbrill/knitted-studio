import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import { Badge } from "../../components/Badge";
import { MCP_TOOLS, MCP_CONFIG } from "../../content/mcp-tools";
import { CopyCode } from "../../components/CopyCode";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Use it from your model",
  description: "A four-tool MCP server lets Claude and other models read Patterns, fill free slots and knit. Locked slots are refused and reported.",
  path: "/mcp/",
});

export default function Mcp() {
  return (
    <>
      <PageHero eyebrow="Your model" title="Let your model knit." lead="The studio and your model use the same four tools against the same store. Nothing is a model-only back door." />
      <section className="sec-tight">
        <div className="wrap-narrow" id="mcp-body">
          <p><Badge status="shipped" /></p>
          <h2 className="h1" style={{ margin: "var(--space-4) 0" }}>Add it to your model</h2>
          <p className="body-lg">Point any MCP client at the server. It speaks over stdio, so it needs no ports and no account. Clone the repository, run <code className="code">npm install</code>, then add this to your client&rsquo;s MCP settings with your own path.</p>
          <div className="doc"><pre tabIndex={0}><code>{MCP_CONFIG}</code></pre></div>
          <p className="body">Knitting needs Playwright and ffmpeg installed. The other three tools do not.</p>

          <h2 className="h1" style={{ margin: "var(--space-12) 0 var(--space-4)" }}>The four tools</h2>
          {MCP_TOOLS.map((t) => (
            <article key={t.name} className="card tool">
              <h3 className="h3">{t.name}</h3>
              <p className="body-lg" style={{ margin: "var(--space-2) 0" }}>{t.summary}</p>
              <p className="body-sm muted" style={{ margin: 0 }}>
                {t.params.length ? `Takes ${t.params.map((p) => p.name + (p.required ? "" : " (optional)")).join(", ")}.` : "Takes nothing."} {t.returns}
              </p>
            </article>
          ))}

          <h2 className="h1" style={{ margin: "var(--space-12) 0 var(--space-4)" }}>The rule that keeps it safe</h2>
          <p className="body-lg">A locked stitch cannot be changed through this interface. <code className="code">fill_slots</code> refuses it and says so in its reply, so your model never believes it wrote a headline that it did not. Unlocking is a human act in the studio.</p>
          <p><Link className="link" href="/docs/mcp-reference/">Full MCP reference</Link> · <Link className="link" href="/docs/using-your-model/">Using your model</Link></p>
        </div>
      </section>
      <CopyCode targetId="mcp-body" />
    </>
  );
}
