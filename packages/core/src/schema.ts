// Validation at the boundary. Everything that arrives over HTTP is parsed here
// first, and a failure says what is wrong and how to fix it in one line, in the
// product's voice, rather than dumping a validator's internals.

import { z } from "zod";

const frac = z.number().finite().min(-2).max(3);

export const SizeSchema = z.object({
  name: z.string().min(1).max(40),
  w: z.number().int().min(16).max(8000),
  h: z.number().int().min(16).max(8000),
});

export const StitchSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["text", "image", "shape", "video", "audio", "part"]),
  x: frac, y: frac, w: frac, h: frac,
  locked: z.boolean(),
  content: z.string().max(5000).optional(),
  yarnId: z.string().max(64).optional(),
  style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  slot: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "Slot names are lowercase letters, numbers and underscores, like headline or product_shot.").optional(),
  partId: z.string().max(64).optional(),
  partVersion: z.number().int().optional(),
  overrides: z.record(z.string(), z.string().max(5000)).optional(),
  partSlots: z.array(z.object({ name: z.string().max(41), kind: z.enum(["text", "image"]), default: z.string().max(2000).optional(), locked: z.boolean() })).max(24).optional(),
}).strict();

const StitchPatch = StitchSchema.omit({ id: true }).partial().strict();

const EASES = ["linear", "ease-out", "ease-in", "ease-in-out", "back-out", "spring-soft"] as const;
const PRESETS = ["fade-in", "fade-out", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "scale-in", "stitch-in", "type-on", "wipe", "ken-burns", "pulse"] as const;
export const ClipSchema = z.object({ id: z.string().max(40), startMs: z.number().min(0).max(600_000), endMs: z.number().min(0).max(600_000), preset: z.enum(PRESETS), ease: z.enum(EASES).optional(), params: z.record(z.string(), z.number()).optional() });
export const AudioClipSchema = z.object({ id: z.string().max(40), yarnId: z.string().max(64), startMs: z.number().min(0).max(600_000), kind: z.enum(["voice", "music"]), gain: z.number().min(0).max(2).optional(), fadeInMs: z.number().min(0).optional(), fadeOutMs: z.number().min(0).optional(), loop: z.boolean().optional(), label: z.string().max(200).optional() });

export type CommandInput =
  | { type: "addStitch"; stitch: z.infer<typeof StitchSchema>; index?: number }
  | { type: "updateStitch"; id: string; patch: z.infer<typeof StitchPatch> }
  | { type: "removeStitch"; id: string }
  | { type: "reorder"; id: string; toIndex: number }
  | { type: "setSize"; size: z.infer<typeof SizeSchema> }
  | { type: "fillSlot"; slot: string; content: string }
  | { type: "setLocked"; id: string; locked: boolean }
  | { type: "setMeta"; name?: string; durationMs?: number }
  | { type: "setMotion"; stitchId: string; clips: z.infer<typeof ClipSchema>[] }
  | { type: "setAudio"; audio: z.infer<typeof AudioClipSchema>[] }
  | { type: "batch"; commands: CommandInput[]; atomic?: boolean };

export const CommandSchema: z.ZodType<CommandInput> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("addStitch"), stitch: StitchSchema, index: z.number().int().min(0).optional() }),
    z.object({ type: z.literal("updateStitch"), id: z.string(), patch: StitchPatch }),
    z.object({ type: z.literal("removeStitch"), id: z.string() }),
    z.object({ type: z.literal("reorder"), id: z.string(), toIndex: z.number().int() }),
    z.object({ type: z.literal("setSize"), size: SizeSchema }),
    z.object({ type: z.literal("fillSlot"), slot: z.string(), content: z.string().max(5000) }),
    z.object({ type: z.literal("setLocked"), id: z.string(), locked: z.boolean() }),
    z.object({ type: z.literal("setMeta"), name: z.string().max(120).optional(), durationMs: z.number().min(0).max(600_000).optional() }),
    z.object({ type: z.literal("setMotion"), stitchId: z.string(), clips: z.array(ClipSchema).max(60) }),
    z.object({ type: z.literal("setAudio"), audio: z.array(AudioClipSchema).max(40) }),
    z.object({ type: z.literal("batch"), commands: z.array(CommandSchema).max(200), atomic: z.boolean().optional() }),
  ]),
) as z.ZodType<CommandInput>;

/** One readable line from a zod failure. */
export function explain(e: z.ZodError): string {
  const i = e.issues[0];
  const path = i.path.length ? `${i.path.join(".")}: ` : "";
  return `${path}${i.message}`;
}

const Hex = z.string();
const FontRefSchema = z.object({ family: z.string().min(1).max(80), yarnId: z.string().max(64).optional() });
export const SwatchPatchSchema = z.object({
  name: z.string().max(120).optional(),
  colors: z.array(z.object({ role: z.string(), name: z.string().max(60), hex: Hex })).max(12).optional(),
  fonts: z.object({ display: FontRefSchema.optional(), body: FontRefSchema.optional(), mono: FontRefSchema.optional() }).optional(),
  logos: z.array(z.object({ yarnId: z.string().max(64), use: z.enum(["full", "mark", "mono-light", "mono-dark"]) })).max(12).optional(),
  voice: z.object({ summary: z.string().max(1000), do: z.array(z.string()).max(24), dont: z.array(z.string()).max(24), examples: z.array(z.string()).max(12) }).optional(),
  rules: z.object({ cornerRadius: z.number().min(0).max(0.2), heatGrade: z.object({ hue: z.enum(["ember", "red"]), strength: z.number().min(0).max(1) }).optional() }).optional(),
}).strict();
