// What the chat routes share with the editor's one-off requests: how the person set the
// model up, whether there is a key, and a chat as the studio shows it.

import { secretStatus, type ChatSummary, type Job, type Store } from "@knitted/core/node";
import { fail } from "./server";

/** The model and limits chosen in Settings, Model, for the next run. */
export function modelRun(s: Store) {
  const cfg = s.getSetting("model", { model: undefined as string | undefined, maxTurns: 25, maxKnits: 24 });
  return { model: cfg.model, maxTurns: cfg.maxTurns, maxKnits: cfg.maxKnits, baseUrl: process.env.KNITTED_ANTHROPIC_URL || undefined };
}

/** The answer to send when there is no key yet, or null when there is one. */
export async function needsKey(s: Store) {
  if ((await secretStatus("anthropic", s.paths.root)).present) return null;
  return fail(400, "no-key", "Add your Anthropic key in Settings, under Model, so your model can answer.");
}

const named = (get: () => { id: string; name: string }) => { try { const x = get(); return { id: x.id, name: x.name }; } catch { return null; } };
// With its project, as a chat about the whole studio can be on a pattern in any of them.
const patternNamed = (s: Store, id: string) => { try { const p = s.getPattern(id); return { id: p.id, name: p.name, projectId: p.projectId }; } catch { return null; } };

/** A chat as the studio lists it: where it works and the pattern it is on, by name, and whether it is answering now. */
export function chatView(s: Store, c: ChatSummary) {
  let last: Job | null = null;
  if (c.jobIds.length) { try { last = s.getJob(c.jobIds.at(-1)!); } catch { /* its run is gone */ } }
  // The pattern it is on: its newest message's, else the one it started on. A chat goes where the person
  // takes it in the editor, so a message from the Ask page is about the pattern they last had it on.
  const on = (last?.input as { patternId?: string } | null)?.patternId ?? c.patternId;
  return {
    id: c.id, title: c.title, projectId: c.projectId, patternId: c.patternId, createdAt: c.createdAt, updatedAt: c.updatedAt,
    running: !!last && ["queued", "running"].includes(last.status),
    project: c.projectId ? named(() => s.getProject(c.projectId!)) : null,
    pattern: on ? patternNamed(s, on) : null,
  };
}
