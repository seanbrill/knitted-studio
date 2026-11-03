// `npm run dev`: the studio and the marketing site side by side.
//
//   studio  http://localhost:4100
//   site    http://localhost:4101
//
// Override with STUDIO_PORT and SITE_PORT if either is taken.
//
// Each runs `next dev` directly (no shell, so it behaves the same on Windows),
// output is prefixed so you can tell them apart, and if either dies the other
// is stopped too: a half-running dev environment is worse than a stopped one.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const next = join(root, "node_modules/next/dist/bin/next");

const apps = [
  { name: "studio", dir: "apps/studio", port: Number(process.env.STUDIO_PORT) || 4100, env: "STUDIO_PORT", color: "\x1b[38;5;208m" },
  { name: "site  ", dir: "apps/site", port: Number(process.env.SITE_PORT) || 4101, env: "SITE_PORT", color: "\x1b[36m" },
];
const reset = "\x1b[0m";

// Check first. Next's own failure is a stack trace about EADDRINUSE; this says
// which port, and how to choose another.
function isFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}
const taken = [];
for (const app of apps) if (!(await isFree(app.port))) taken.push(app);
if (taken.length) {
  for (const app of taken) {
    console.error(`Port ${app.port} (${app.name.trim()}) is already in use. Free it, or run with ${app.env}=<port>.`);
  }
  process.exit(1);
}

const children = apps.map((app) => {
  const child = spawn(process.execPath, [next, "dev", "-p", String(app.port)], {
    cwd: join(root, app.dir),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `${app.color}[${app.name}]${reset} `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) if (l.trim()) out.write(tag + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.app = app;
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}

for (const c of children) {
  c.on("exit", (code) => {
    if (stopping) return;
    console.error(`${c.app.name.trim()} exited (${code}); stopping the other.`);
    stop(code || 1);
  });
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop(0));

for (const a of apps) console.log(`${a.name.trim().padEnd(7)} http://localhost:${a.port}`);
console.log("");
