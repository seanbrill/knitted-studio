// Shared plumbing for route handlers.
//
// One error shape for the whole API, in the product's voice: what happened and
// the fix, in a line. Handlers throw core errors; this maps them to statuses.

import { dailyBackup, getStore, type Store } from "@knitted/core/node";
import { explain } from "@knitted/core";
import { ZodError, type ZodType } from "zod";

const g = globalThis as unknown as { __knittedBooted?: boolean };

/** The store, with first-run chores done once per process. */
export function store(): Store {
  const s = getStore();
  if (!g.__knittedBooted) {
    g.__knittedBooted = true;
    s.ensureExample();
    s.purgeDeleted();
    try { dailyBackup(s.db, s.paths.root); } catch { /* a failed backup must never stop the app opening */ }
  }
  return s;
}

export function fail(status: number, kind: string, message: string, extra?: object) {
  return Response.json({ error: { kind, message, ...extra } }, { status });
}

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

class BadRequest extends Error { readonly kind = "validation"; }

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new BadRequest("That request was not valid JSON."); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new BadRequest(explain(r.error));
  return r.data;
}

/**
 * Errors are told apart by their `kind` tag, not by `instanceof`. A bundler can
 * load the same module twice (the route and the store ended up as two copies in
 * Next), and then `instanceof` is false for an error that IS a ValidationError,
 * and every refusal turns into a 500.
 */
function kindOf(e: unknown): { kind?: string; currentVersion?: number; message: string } {
  const o = e as { kind?: string; currentVersion?: number; message?: string; name?: string };
  return { kind: o?.kind ?? (o?.name === "ZodError" ? "zod" : undefined), currentVersion: o?.currentVersion, message: o?.message ?? "" };
}

/** Wrap a handler so thrown core errors become the right response. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      const k = kindOf(e);
      if (k.kind === "validation") return fail(400, "validation", k.message);
      if (k.kind === "zod") return fail(400, "validation", explain(e as ZodError));
      if (k.kind === "not_found") return fail(404, "not_found", k.message);
      if (k.kind === "conflict") return fail(409, "conflict", k.message, { currentVersion: k.currentVersion });
      // A voice that could not be made says why, in the voice server's own words.
      if ((e as Error)?.name === "VoiceError") return fail(502, "voice", k.message);
      // A platform's refusal, or a setup still to finish, in words: the platform's own problem when it answered.
      if ((e as Error)?.name === "SocialError") return fail((e as { status?: number }).status ? 502 : 400, "social", k.message, { reconnect: !!(e as { reconnect?: boolean }).reconnect });
      console.error(e);
      return fail(500, "internal", "Something broke on our side. Your work is saved; try again.");
    }
  };
}
