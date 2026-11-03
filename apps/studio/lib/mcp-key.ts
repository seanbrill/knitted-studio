// The key in the MCP address (Settings, Model), which lets Claude Code and other MCP
// clients on this computer in without the window's launch token. It is kept in the
// library's settings, so the address still works after a restart, and replaced when
// the person asks for a new address.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { store } from "./server";

const read = () => store().getSetting<{ key?: string }>("mcp", {}).key;

/** A new key. The old address stops working at once. */
export function newMcpKey(): string {
  const key = randomBytes(24).toString("base64url");
  store().setSetting("mcp", { key });
  return key;
}

/** The key, made the first time anything asks. */
export const mcpKey = (): string => read() ?? newMcpKey();

export function isMcpKey(given: string): boolean {
  const key = read();
  if (!key || given.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(key));
}
