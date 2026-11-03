import { manifest } from "@knitted/fonts";
import { ok, route } from "@/lib/server";

export const GET = route(() => ok(manifest));
