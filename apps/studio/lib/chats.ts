// What the chat routes share with the editor's one-off requests: how the person set the
// model up, whether there is a key, and a chat as the studio shows it.

import { secretStatus, type ChatSummary, type Store } from "@knitted/core/node";
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

/** A chat as the studio lists it: where it works, by name, and whether it is answering now. */
export function chatView(s: Store, c: ChatSummary) {
  const last = c.jobIds.at(-1);
  let running = false;
  if (last) { try { running = ["queued", "running"].includes(s.getJob(last).status); } catch { /* its run is gone */ } }
  return {
    id: c.id, title: c.title, projectId: c.projectId, patternId: c.patternId, createdAt: c.createdAt, updatedAt: c.updatedAt, running,
    project: c.projectId ? named(() => s.getProject(c.projectId!)) : null,
    pattern: c.patternId ? named(() => s.getPattern(c.patternId!)) : null,
  };
}
