// A public address for a file, for the platforms that fetch what they post (Instagram and
// Threads) instead of being sent it. The person's own storage, either a bucket that speaks
// S3 (Amazon S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO) or FileFreak. The
// file is put there just before posting and removed straight after, posted or not.

import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { FileFreak } from "@filefreak.io/sdk";
import { SocialError } from "./http.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
/** RFC 3986, as SigV4 wants a path: each part encoded, the slashes kept. */
const encodePath = (p) => p.split("/").map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

/**
 * AWS Signature Version 4 for one request: the headers to send. Every S3-speaking store
 * takes it. `now` is for tests, which check it against AWS's published example.
 */
export function signV4({ method, url, headers = {}, payloadHash, region, service = "s3", keyId, secret, now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).sort();
  const query = [...u.searchParams].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [method, encodePath(decodeURIComponent(u.pathname)), query, names.map((n) => `${n}:${all[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

/** Where an object goes: Amazon's own buckets by name in the host, everyone else's in the path. */
export function objectUrl({ endpoint, bucket, region }, key) {
  const e = (endpoint || "").replace(/\/$/, "");
  if (!e || /amazonaws\.com$/.test(new URL(e.startsWith("http") ? e : `https://${e}`).host)) return `https://${bucket}.s3.${region || "us-east-1"}.amazonaws.com/${encodePath(key)}`;
  return `${e}/${bucket}/${encodePath(key)}`;
}

/** A bucket that speaks S3. `cfg`: endpoint, region, bucket, keyId, publicBase, prefix. */
export function s3Host(cfg, secret, { fetch: f = globalThis.fetch } = {}) {
  const region = cfg.region || "auto";
  const send = async (method, key, body, type) => {
    const url = objectUrl({ ...cfg, region }, key);
    const headers = signV4({ method, url, headers: type ? { "content-type": type } : {}, payloadHash: sha256(body ?? ""), region, keyId: cfg.keyId, secret });
    let res;
    try { res = await f(url, { method, headers, body }); }
    catch (e) { throw new SocialError(`Could not reach your media host: ${e?.cause?.code ?? e.message}.`, { retry: true }); }
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      const text = await res.text().catch(() => "");
      const said = text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? text.match(/<Code>([^<]*)<\/Code>/)?.[1];
      throw new SocialError(`Your media host refused it (${res.status}${said ? `: ${said}` : ""}). Check the bucket, its address and the key in Settings, Social.`, { retry: res.status >= 500 });
    }
  };
  return {
    name: "your bucket",
    async put(path, mime) {
      const key = `${(cfg.prefix ?? "knitted/").replace(/^\//, "")}${randomUUID()}${extname(path).toLowerCase()}`;
      await send("PUT", key, await readFile(path), mime);
      return { url: `${cfg.publicBase.replace(/\/$/, "")}/${encodePath(key)}`, remove: () => send("DELETE", key) };
    },
  };
}

/** A FileFreak folder: each file made public for as long as the platform needs it. */
export function fileFreakHost(cfg, apiKey, { fetch: f } = {}) {
  const ff = new FileFreak({ apiKey, ...(f ? { fetch: f } : {}), ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}) });
  let folderId = null;
  return {
    name: "FileFreak",
    async put(path, mime) {
      try {
        folderId ??= (await ff.folders.create({ name: cfg.folder || "knitted posts", ifExists: "use" })).item.id;
        const blob = new Blob([await readFile(path)], { type: mime });
        const file = await ff.upload(blob, { name: `${randomUUID()}${extname(path).toLowerCase()}`, parentId: folderId, contentType: mime });
        const { item } = await ff.files.update(file.id, { visibility: "public" });
        if (!item.publicUrl) {
          await ff.files.delete(file.id, { permanent: true }).catch(() => {});
          throw new SocialError("FileFreak would not give the file a public address. Turn on your public page in FileFreak's settings, then try again.");
        }
        return { url: item.publicUrl, remove: () => ff.files.delete(file.id, { permanent: true }).then(() => {}) };
      } catch (e) {
        if (e instanceof SocialError) throw e;
        throw new SocialError(`FileFreak refused it: ${e?.message ?? e}. Check the key in Settings, Social.`, { retry: (e?.status ?? 0) >= 500 });
      }
    },
  };
}

/**
 * Put a small file there, fetch it back from its public address, and take it away: whether
 * Instagram and Threads will be able to fetch what knitted puts there.
 */
export async function testHost(host, path, mime, { fetch: f = globalThis.fetch } = {}) {
  const put = await host.put(path, mime);
  try {
    let res;
    try { res = await f(put.url, { redirect: "follow" }); } catch (e) { throw new SocialError(`The file went in, but its public address did not answer: ${e?.cause?.code ?? e.message}. Check the public address in Settings, Social.`); }
    if (!res.ok) throw new SocialError(`The file went in, but its public address answered ${res.status}. The bucket has to let anyone read it: check its public access, and the public address.`);
    const got = Buffer.from(await res.arrayBuffer());
    if (!got.equals(await readFile(path))) throw new SocialError("The public address answered with something other than the file. Check the public address points at this bucket.");
    return { url: put.url };
  } finally { await put.remove().catch(() => {}); }
}
