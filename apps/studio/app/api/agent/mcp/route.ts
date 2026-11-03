import { mcpKey, newMcpKey } from "@/lib/mcp-key";
import { ok, route } from "@/lib/server";

export const dynamic = "force-dynamic";

// The MCP address Settings shows, as a path: the page adds its own origin, which is
// the address this server answers on.
const address = (key: string) => ({ path: `/api/mcp/${key}` });

export const GET = route(() => ok(address(mcpKey())));
/** A new address. Whatever was given the old one has to be given this one. */
export const POST = route(() => ok(address(newMcpKey())));
