// `next build` always in production mode, whatever the shell says.
//
// A machine with NODE_ENV=development exported (EZPIPELINE's host is one) makes Next fail
// while prerendering its error pages, with "<Html> should not be imported outside of
// pages/_document". Setting it here, in a program, works on every OS.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const r = spawnSync(process.execPath, [next, "build", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
process.exit(r.status ?? 1);
