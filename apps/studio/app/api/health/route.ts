// Proves the whole server path works: this route runs inside the Next server,
// which in the desktop app runs inside Electron's Node. It opens SQLite through
// the built-in `node:sqlite`, so there is no native module to rebuild per
// platform or per Electron ABI (decision recorded in Phase 0).

import { DatabaseSync } from "node:sqlite";

export const dynamic = "force-dynamic";

export function GET() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("pragma journal_mode = wal; create table t(x); insert into t values (42)");
    const row = db.prepare("select x from t").get() as { x: number };
    const v = db.prepare("select sqlite_version() as v").get() as { v: string };
    return Response.json({
      ok: row.x === 42,
      sqlite: v.v,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      home: process.env.KNITTED_HOME ?? null,
    });
  } finally {
    db.close();
  }
}
