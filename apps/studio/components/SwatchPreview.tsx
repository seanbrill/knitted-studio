import type { Swatch, Yarn } from "@knitted/core";
import { colorFor, fontFor, readableOn } from "@knitted/core";
import { yarnFileUrl } from "@knitted/core/client";

/**
 * A small post, drawn with the swatch: what the brand looks like in use. It is
 * deliberately NOT the real renderer (that arrives with the editor); it exists
 * so someone defining a brand sees the colours and faces together, not as a list.
 */
export function SwatchPreview({ swatch, logo }: { swatch: Swatch; logo?: Yarn }) {
  const primary = colorFor(swatch, "primary");
  const bg = colorFor(swatch, "background");
  const text = colorFor(swatch, "text");
  const accent = colorFor(swatch, "accent");
  const onPrimary = readableOn(primary, text);
  const r = `${swatch.rules.cornerRadius * 100 * 4}cqw`;
  return (
    <div role="img" aria-label={`Preview of the ${swatch.name} swatch`} style={{ containerType: "inline-size", aspectRatio: "4 / 5", background: bg, borderRadius: "var(--radius-md)", overflow: "hidden", position: "relative", boxShadow: "0 0 0 1px var(--line)" }}>
      <div style={{ position: "absolute", inset: "6cqw 6cqw auto 6cqw", height: "56cqw", background: primary, borderRadius: r, padding: "6cqw", display: "flex", flexDirection: "column", justifyContent: "flex-end", color: onPrimary }}>
        <span style={{ fontFamily: `"${fontFor(swatch, "mono")}", monospace`, fontSize: "3.2cqw", letterSpacing: "0.14em", textTransform: "uppercase" }}>New this week</span>
        <span style={{ fontFamily: `"${fontFor(swatch, "display")}", sans-serif`, fontWeight: 800, fontSize: "11cqw", lineHeight: 0.95, letterSpacing: "-0.03em", marginTop: "2cqw" }}>Make it knitted.</span>
      </div>
      <p style={{ position: "absolute", left: "6cqw", right: "6cqw", top: "68cqw", margin: 0, fontFamily: `"${fontFor(swatch, "body")}", sans-serif`, fontSize: "4.2cqw", lineHeight: 1.4, color: text }}>
        {swatch.voice.examples[0] ?? "Set your brand once. Knit it forever."}
      </p>
      <div style={{ position: "absolute", left: "6cqw", bottom: "6cqw", display: "flex", alignItems: "center", gap: "4cqw" }}>
        <span style={{ background: accent, color: readableOn(accent, text), fontFamily: `"${fontFor(swatch, "body")}", sans-serif`, fontWeight: 700, fontSize: "3.6cqw", padding: "2cqw 4.5cqw", borderRadius: r }}>Shop now</span>
        {logo ? <img src={yarnFileUrl(logo)} alt="" style={{ height: "8cqw", maxWidth: "30cqw", objectFit: "contain" }} /> : <span style={{ fontFamily: `"${fontFor(swatch, "display")}", sans-serif`, fontWeight: 800, fontSize: "5cqw", color: text, letterSpacing: "-0.04em" }}>brand</span>}
      </div>
    </div>
  );
}
