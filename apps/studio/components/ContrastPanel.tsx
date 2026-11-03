import { COLOR_ROLES, colorFor, grade, ratio, suggestPassing, type ColorRole, type Swatch } from "@knitted/core";
import { Button, icons } from "@knitted/ui";

const { Check, AlertTriangle } = icons;

/**
 * Every text-on-ground pair, with its ratio and a verdict in WORDS plus an icon
 * (status is never colour alone). This is the theme's "never white on ember" rule,
 * measured for anyone's brand, with a one-click fix when it fails.
 */
export function ContrastPanel({ swatch, onFix }: { swatch: Swatch; onFix: (role: ColorRole, hex: string) => void }) {
  const have = new Set(swatch.colors.map((c) => c.role));
  const grounds = COLOR_ROLES.filter((r) => have.has(r) && r !== "text");
  const pairs = grounds.flatMap((g) => (["text", ...(g === "background" ? [] : ["background"])] as ColorRole[]).map((f) => ({ fg: f, bg: g })));
  const rows = pairs.filter((p) => p.fg !== p.bg);
  return (
    <section aria-label="Contrast" style={{ display: "grid", gap: "var(--space-2)" }}>
      <h3 className="h3">Contrast</h3>
      <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Text needs 4.5:1 to be easy to read. Large headlines can get by on 3:1.</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {rows.map(({ fg, bg }) => {
          const f = colorFor(swatch, fg), b = colorFor(swatch, bg);
          const r = ratio(f, b), g = grade(r);
          const fix = g === "fail" || g === "AA large" ? suggestPassing(f, b) : null;
          const safe = fix && (fg !== "text" || ratio(fix, colorFor(swatch, "background")) >= 4.5);
          return (
            <li key={`${fg}-${bg}`} className="body-sm" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* The sample shows the user's own pair, which may be exactly the failing one, so it is drawn as CSS content rather than page text. */}
              <span aria-hidden className="contrast-sample" data-sample="Aa" style={{ background: b, color: f }} />
              <span style={{ flex: 1, minWidth: 140 }}>{fg} on {bg}</span>
              <span className="code">{r.toFixed(2)}:1</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: g === "fail" ? "var(--danger)" : g === "AA large" ? "var(--ink-muted)" : "var(--success)", fontWeight: 600 }}>
                {g === "fail" ? <AlertTriangle size={13} aria-hidden /> : <Check size={13} aria-hidden />}
                {g === "fail" ? "Fails" : g === "AA large" ? "Large text only" : g}
              </span>
              {safe && fix !== f && <Button size="sm" onClick={() => onFix(fg, fix!)}>Use {fix}</Button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
