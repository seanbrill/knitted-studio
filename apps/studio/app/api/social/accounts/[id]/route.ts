import { removeAccount } from "@knitted/core/node";
import { forgetTokens } from "@knitted/social";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Forget an account here: its sign-in is removed from this computer. The platform keeps the app's access until the person removes it there. */
export const DELETE = route(async (_: Request, { params }: Ctx) => {
  const id = (await params).id;
  removeAccount(store(), id);
  await forgetTokens(store(), id);
  return ok({ ok: true });
});
