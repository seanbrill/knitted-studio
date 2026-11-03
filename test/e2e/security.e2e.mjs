// File-serving and import routes must not be steerable out of the library.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { startStudio } from "./harness.mjs";

let studio, projectId;
const raw = (path, init) => fetch(studio.url + path, init);
before(async () => {
  studio = await startStudio();
  projectId = (await (await raw("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sec" }) })).json()).id;
});
after(async () => { await studio?.stop(); });

const EVIL = ["..%2F..%2F..%2Fetc%2Fpasswd", "%2e%2e%2f%2e%2e%2fpackage.json", "..%5C..%5Cwindows%5Cwin.ini", "%2Fetc%2Fpasswd", "CON", "aux.txt", "a%00b", "x".repeat(400)];

for (const where of ["/api/yarn/ID/file", "/api/yarn/ID/thumb", "/api/knits/ID/file", "/api/fonts/ID", "/api/patterns/ID", "/api/projects/ID"]) {
  test(`${where}: path tricks return not-found or bad-request and never file contents`, async () => {
    for (const evil of EVIL) {
      const res = await raw(where.replace("ID", evil));
      assert.ok([400, 404, 414].includes(res.status), `${evil.slice(0, 40)} gave ${res.status}`);
      const body = await res.text();
      assert.ok(!/root:|\[extensions\]|"name":\s*"knitted/.test(body), "no file contents leaked");
    }
  });
}

test("importing a URL that points inside the machine is refused", async () => {
  for (const url of ["http://127.0.0.1:4100/api/projects", "http://localhost/x.png", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "http://[::1]/x.png"]) {
    const res = await raw(`/api/projects/${projectId}/yarn/url`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    assert.ok(res.status >= 400 && res.status < 500, `${url} gave ${res.status}`);
  }
});

test("a Part file with path tricks or the wrong shape is rejected by the real import route", async () => {
  for (const file of [{ format: "knitted-part", name: "x", files: { "../../escape.html": "<p>hi</p>" } }, "../../etc/passwd", { nope: true }, null]) {
    const res = await raw(`/api/projects/${projectId}/parts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "import", file, scope: "project" }) });
    assert.equal(res.status, 400, JSON.stringify(file));
  }
});
