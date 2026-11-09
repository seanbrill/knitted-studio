"use client";

// What the person's Anthropic key has spent through knitted, and the limits that stop the model
// before it spends more. Each answer is priced as it comes in, at Anthropic's prices.

import { useEffect, useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Input, Tip, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { SetRow, settingsChanged } from "./SettingsParts";

const { AlertTriangle } = icons;

const money = (n: number) => (n > 0 && n < 0.01 ? "under 1 cent" : `$${n.toFixed(2)}`);
const KIND: Record<string, string> = { chat: "Ask and the editor", post: "Captions and hashtags", profile: "Brief profiles", claims: "Claims checks", generate: "Photos and video", other: "Other" };
const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function SpendSettings() {
  const toast = useToast();
  const { data, refresh } = useLive(() => api.agent.usage(), []);
  const [monthly, setMonthly] = useState("");
  const [perRun, setPerRun] = useState("");
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonthly(data.limits.monthly == null ? "" : String(data.limits.monthly));
    setPerRun(data.limits.perRun == null ? "" : String(data.limits.perRun));
  }, [data?.limits.monthly, data?.limits.perRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const read = (s: string) => (s.trim() === "" ? null : Number(s.replace(/^\$/, "")));
    const m = read(monthly), r = read(perRun);
    if ((m !== null && !(m >= 0)) || (r !== null && !(r >= 0))) { setErr("Give a limit in dollars, like 20, or leave it empty for none."); return; }
    try { await api.agent.setLimits({ monthly: m, perRun: r }); setErr(undefined); await refresh(); settingsChanged(); toast("Limits saved."); } catch (e) { setErr((e as Error).message); }
  };

  const limit = data?.limits.monthly ?? null;
  const share = data && limit ? Math.min(1, data.month / limit) : null;
  const near = data && limit != null && data.month >= limit * data.limits.warnAt;
  const over = data && limit != null && data.month >= limit;
  const top = Math.max(0.01, ...(data?.days ?? []).map((d) => d.cost));

  return (
    <>
      {data && <section className="set-card set-card-pad" aria-label="This month" style={{ display: "grid", gap: "var(--space-5)" }}>
        <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>This month</p>
            <p style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 36, lineHeight: 1 }}>{money(data.month)}</p>
            <p className="body-sm" style={{ margin: "4px 0 0", color: "var(--ink-muted)" }}>{limit != null ? `of your $${limit.toFixed(2)} limit` : "No monthly limit"} · today {money(data.today)}</p>
          </div>
          {share !== null && (
            <div style={{ flex: "1 1 220px", maxWidth: 360 }}>
              <div className="knit-bar" role="meter" aria-label="Spent of this month's limit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-valuetext={`${Math.round(share * 100)}% of the limit`}>
                <span style={{ width: `${share * 100}%`, background: over ? "var(--danger)" : undefined }} />
              </div>
              <p className="body-sm" style={{ margin: "4px 0 0", color: "var(--ink-muted)" }}>{Math.round(share * 100)}% of the limit</p>
            </div>
          )}
        </div>
        {near && (
          <p role="status" className="body-sm" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", color: over ? "var(--danger)" : "var(--ink)" }}>
            <AlertTriangle size={14} aria-hidden />
            {over ? "The limit is reached: your model will not start another answer this month unless you raise it." : `You have used ${Math.round(share! * 100)}% of this month's limit.`}
          </p>
        )}

        <figure style={{ margin: 0 }}>
          <figcaption className="eyebrow" style={{ marginBottom: 8 }}>The last 30 days</figcaption>
          <div className="spend-chart" role="img" aria-label={`What was spent each day for the last 30 days, at most ${money(top)} in a day. The table below has every day.`}>
            {data.days.map((d) => (
              <Tip key={d.day} text={`${dayName(d.day)}: ${money(d.cost)}`}>
                <span className="spend-day"><span className="spend-bar" style={{ height: d.cost > 0 ? `max(2px, ${(d.cost / top) * 100}%)` : 0 }} /></span>
              </Tip>
            ))}
          </div>
          <div className="spend-axis body-sm" aria-hidden><span>{dayName(data.days[0].day)}</span><span>Today</span></div>
          <details style={{ marginTop: 8 }}>
            <summary className="link body-sm">As a table</summary>
            <table className="body-sm spend-table">
              <thead><tr><th scope="col">Day</th><th scope="col">Spent</th></tr></thead>
              <tbody>{data.days.filter((d) => d.cost > 0).map((d) => <tr key={d.day}><td>{dayName(d.day)}</td><td>{money(d.cost)}</td></tr>)}</tbody>
            </table>
            {data.days.every((d) => d.cost === 0) && <p className="body-sm" style={{ color: "var(--ink-muted)" }}>Nothing spent in the last 30 days.</p>}
          </details>
        </figure>

        {data.models.length > 0 && (
          <table className="body-sm spend-table">
            <caption className="eyebrow" style={{ textAlign: "left", marginBottom: 6 }}>This month, by model</caption>
            <thead><tr><th scope="col">Model</th><th scope="col">Answers</th><th scope="col">Tokens in</th><th scope="col">Tokens out</th><th scope="col">Spent</th></tr></thead>
            <tbody>{data.models.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.answers}</td><td>{m.input.toLocaleString()}</td><td>{m.output.toLocaleString()}</td><td>{money(m.cost)}</td></tr>)}</tbody>
          </table>
        )}
        {data.kinds.length > 1 && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{data.kinds.map((k) => `${KIND[k.kind] ?? k.kind}: ${money(k.cost)}`).join(" · ")}</p>}
      </section>}

      <form className="set-card" aria-label="Limits" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="set-card-head"><h3 className="set-card-title">Limits</h3><div className="set-card-actions"><Button type="submit" size="sm" variant="primary">Save limits</Button></div></div>
        <SetRow label="Monthly limit, in dollars" htmlFor="spend-month" hint="Empty for none. At the limit, your model waits until next month.">
          <Input id="spend-month" className="set-narrow" inputMode="decimal" placeholder="No limit" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </SetRow>
        <SetRow label="Limit for one answer, in dollars" htmlFor="spend-run" hint="One message's whole answer, with every step it takes. Empty for none.">
          <Input id="spend-run" className="set-narrow" inputMode="decimal" placeholder="No limit" value={perRun} onChange={(e) => setPerRun(e.target.value)} />
        </SetRow>
        {err && <p className="field-error set-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
      </form>
    </>
  );
}
