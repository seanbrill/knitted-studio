import Link from "next/link";
import { PageHero } from "../../components/PageHero";
import { Badge } from "../../components/Badge";
import { MCP_TOOLS, MCP_CONFIG, MCP_COMMAND } from "../../content/mcp-tools";
import { CopyCode } from "../../components/CopyCode";
import { pageMeta } from "../../lib/meta";

export const metadata = pageMeta({
  title: "Use it from your model",
  description: "An MCP server lets Claude Code and other models read Patterns, fill free slots and knit. Locked slots are refused and reported.",
  path: "/mcp/",
});

/** A tool's own description marks names with backticks, as markdown does. */
const withCode = (text: string) => text.split("`").map((part, i) => (i % 2 ? <code key={i} className="code">{part}</code> : part));

export default function Mcp() {
  return (
    <>
      <PageHero eyebrow="Your model" title="Let your model knit." lead="The studio and your model use the same tools against the same store. Nothing is a model-only back door." />
      <section className="sec-tight">
        <div className="wrap-narrow" id="mcp-body">
          <p><Badge status="shipped" /></p>
          <h2 className="h1" style={{ margin: "var(--space-4) 0" }}>Add it to your model</h2>
          <h3 className="h3" style={{ margin: "var(--space-8) 0 var(--space-2)" }}>From the desktop app</h3>
          <p className="body-lg">Open Settings, Model, and copy the command under Connect Claude Code. Run it in a terminal, or paste it into Claude Code and ask it to connect to knitted. It looks like this, with your own address:</p>
          <div className="doc"><pre tabIndex={0}><code>{MCP_COMMAND}</code></pre></div>
          <p className="body">Other MCP clients take the address on its own. It works while knitted is open, and it holds a key, so keep it to yourself. Settings can make a new one and shut the old.</p>
          <h3 className="h3" style={{ margin: "var(--space-8) 0 var(--space-2)" }}>From a clone</h3>
          <p className="body-lg">The server also speaks over stdio, so it needs no ports and no account. Clone the repository, run <code className="code">npm install</code>, then add this to your client&rsquo;s MCP settings with your own path.</p>
          <div className="doc"><pre tabIndex={0}><code>{MCP_CONFIG}</code></pre></div>
          <p className="body">From a clone, knitting needs Playwright and ffmpeg installed. The other tools do not.</p>

          <h2 className="h1" style={{ margin: "var(--space-12) 0 var(--space-4)" }}>The {MCP_TOOLS.length} tools</h2>
          {MCP_TOOLS.map((t) => (
            <article key={t.name} className="card tool">
              <h3 className="h3">{t.name}</h3>
              <p className="body-lg" style={{ margin: "var(--space-2) 0" }}>{withCode(t.summary)}</p>
              <p className="body-sm muted" style={{ margin: 0 }}>
                {t.params.length ? `Takes ${t.params.map((p) => p.name + (p.required ? "" : " (optional)")).join(", ")}.` : "Takes nothing."}
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
