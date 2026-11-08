import { z } from "zod";
import { setSocialConfig, socialView } from "@knitted/social";
import { body, ok, route, store } from "@/lib/server";
import { portOf } from "@/lib/social";

export const dynamic = "force-dynamic";

// Secrets go in and never come back out: the answer says only whether each is there.
export const GET = route(async (req: Request) => ok({ ...(await socialView(store())), port: portOf(req) }));

const app = z.object({ clientId: z.string().max(300).optional(), clientSecret: z.string().max(500).optional(), clearSecret: z.boolean().optional() }).strict();
const Put = z.object({
  apps: z.object({ instagram: app, tiktok: app, linkedin: app, threads: app, x: app, youtube: app }).partial().optional(),
  host: z.object({
    kind: z.enum(["none", "s3", "filefreak"]).optional(),
    s3: z.object({ endpoint: z.string().max(300), region: z.string().max(60), bucket: z.string().max(200), keyId: z.string().max(200), publicBase: z.string().max(300), prefix: z.string().max(200), secret: z.string().max(500) }).partial().optional(),
    filefreak: z.object({ folder: z.string().max(200), apiKey: z.string().max(500) }).partial().optional(),
  }).optional(),
  modelMaySchedule: z.boolean().optional(),
}).strict();

const isUrl = (v?: string) => !v || /^https?:\/\/[^\s]+$/.test(v);

export const PUT = route(async (req: Request) => {
  const b = await body(req, Put);
  if (!isUrl(b.host?.s3?.endpoint) || !isUrl(b.host?.s3?.publicBase)) return Response.json({ error: { kind: "validation", message: "The bucket's address and its public address have to start with https://." } }, { status: 400 });
  await setSocialConfig(store(), b);
  return ok({ ...(await socialView(store())), port: portOf(req) });
});
