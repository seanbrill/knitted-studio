// What the person's key spends: every answer kept in the ledger at its price, and the limits
// that stop the model before it spends more. A fake of the Anthropic API: no key, no cost.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, recordUsage, setSpendLimits, spendCheck, usageSummary } from "@knitted/core/node";
import { runAgent } from "../src/index.mjs";

const fresh = () => openStore(join(mkdtempSync(join(tmpdir(), "knitted-spend-")), "k.db"));
function fake(script) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    seen.push(JSON.parse(b));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(script[Math.min(seen.length - 1, script.length - 1)]));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ baseUrl: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}
const look = (n) => ({ model: "claude-opus-5-5", content: [{ type: "tool_use", id: `t${n}`, name: "list_projects", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 200_000, output_tokens: 10_000, cache_read_input_tokens: 100_000 } });

test("every answer is kept with its tokens and its price, for the model that really answered", async () => {
  const store = fresh();
  const p = store.createProject({ name: "Spend", starter: "blank" });
  const f = await fake([look(1), { model: "claude-opus-5-5", content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } }]);
  const r = await runAgent({ store, projectId: p.id, prompt: "Look around", apiKey: "sk-test", baseUrl: f.baseUrl, model: "claude-opus-5-5" });
  f.close();
  // Opus 5.5: $4 in, $20 out, $0.20 a cached read.
  const first = (200_000 * 4 + 10_000 * 20 + 100_000 * 0.2) / 1e6, second = (1000 * 4 + 100 * 20) / 1e6;
  assert.equal(r.usage.cost.toFixed(6), (first + second).toFixed(6));
  const s = usageSummary(store);
  assert.equal(s.month.toFixed(6), (first + second).toFixed(6));
  assert.deepEqual(s.models.map((m) => [m.model, m.answers]), [["claude-opus-5-5", 2]]);
  assert.equal(s.days.length, 30);
  assert.equal(s.days.at(-1).cost.toFixed(6), (first + second).toFixed(6), "today is the last day");
  assert.deepEqual(s.kinds.map((k) => k.kind), ["chat"]);
});

test("a limit for one answer stops the run between steps, and what it did is kept", async () => {
  const store = fresh();
  const p = store.createProject({ name: "Spend", starter: "blank" });
  setSpendLimits(store, { perRun: 1 });
  // Each look costs $1.02: the second step is never asked for.
  const f = await fake([look(1), look(2), look(3)]);
  const events = [];
  const r = await runAgent({ store, projectId: p.id, prompt: "Look around a lot", apiKey: "sk-test", baseUrl: f.baseUrl, model: "claude-opus-5-5", onEvent: (e) => events.push(e) });
  f.close();
  assert.equal(f.seen.length, 1, "it asked once, then stopped");
  assert.equal(r.stopped, "limit");
  assert.match(events.find((e) => e.type === "stopped").why, /limit of \$1\.00/);
});

test("over the monthly limit, nothing is sent at all, and the person is told how to go on", async () => {
  const store = fresh();
  const p = store.createProject({ name: "Spend", starter: "blank" });
  recordUsage(store, { kind: "chat", model: "claude-opus-5-5", projectId: p.id, chatId: null, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 5 });
  setSpendLimits(store, { monthly: 5 });
  assert.equal(spendCheck(store).ok, false);
  const f = await fake([look(1)]);
  await assert.rejects(runAgent({ store, projectId: p.id, prompt: "Anything", apiKey: "sk-test", baseUrl: f.baseUrl }), (e) => e.kind === "limit" && /spent \$5\.00 this month, and your limit is \$5\.00/.test(e.message));
  f.close();
  assert.equal(f.seen.length, 0);
  setSpendLimits(store, { monthly: null });
  assert.equal(spendCheck(store).ok, true, "no limit, no stop");
});

test("spending from before this month does not count toward this month's limit", () => {
  const store = fresh();
  const old = new Date(); old.setMonth(old.getMonth() - 1, 15);
  recordUsage(store, { kind: "chat", model: "x", projectId: null, chatId: null, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 50, at: old.toISOString() });
  setSpendLimits(store, { monthly: 10 });
  assert.equal(usageSummary(store).month, 0);
  assert.equal(spendCheck(store).ok, true);
});
