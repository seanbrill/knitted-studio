import { z } from "zod";
import { addStock } from "@knitted/core/node";
import { body, ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

// By its id only: the file is whatever its source says that id is, never an address from here.
const Add = z.object({ id: z.string().max(80), kind: z.enum(["image", "video", "audio"]), to: z.string().max(80), folder: z.string().max(400).optional(), name: z.string().max(100).optional() });
export const POST = route(async (req: Request) => ok(await addStock(store(), await body(req, Add)), 201));
