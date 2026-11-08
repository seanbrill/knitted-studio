// Secrets live in the OS's own store, never in the database, a log, or a file we
// wrote. A key that reached our SQLite file would be copied by every backup and
// shown by every diagnostics bundle.
//
//   macOS    Keychain, through the `security` tool
//   Linux    libsecret, through `secret-tool`
//   Windows  DPAPI (encrypted for this user only), through PowerShell
//   anywhere an environment variable always wins, for development and CI
//
// If none is available we say so, plainly, rather than quietly writing it to disk.

import { execFile, spawn as spawnCp } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SERVICE = "knitted-studio";

export interface SecretStore {
  readonly name: string;
  available(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const envName = (key: string) => (key === "anthropic" ? "ANTHROPIC_API_KEY" : `KNITTED_SECRET_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`);

const keychain: SecretStore = {
  name: "macOS Keychain",
  available: async () => process.platform === "darwin",
  async get(key) { try { return (await run("security", ["find-generic-password", "-s", SERVICE, "-a", key, "-w"])).stdout.replace(/\n$/, ""); } catch { return null; } },
  async set(key, value) { await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", key, "-w", value]); },
  async remove(key) { try { await run("security", ["delete-generic-password", "-s", SERVICE, "-a", key]); } catch { /* already gone */ } },
};

const libsecret: SecretStore = {
  name: "your desktop's keyring",
  async available() { if (process.platform !== "linux") return false; try { await run("secret-tool", ["--version"]); return true; } catch { return false; } },
  async get(key) { try { return (await run("secret-tool", ["lookup", "service", SERVICE, "account", key])).stdout || null; } catch { return null; } },
  async set(key, value) {
    await new Promise<void>((resolve, reject) => {
      const p = spawnCp("secret-tool", ["store", "--label", `${SERVICE} ${key}`, "service", SERVICE, "account", key]);
      p.on("error", reject); p.on("close", (c: number) => (c === 0 ? resolve() : reject(new Error("secret-tool failed"))));
      p.stdin.end(value);
    });
  },
  async remove(key) { try { await run("secret-tool", ["clear", "service", SERVICE, "account", key]); } catch { /* gone */ } },
};

function dpapi(dir: string): SecretStore {
  const file = (k: string) => join(dir, `${k.replace(/[^a-z0-9_-]/gi, "_")}.dpapi`);
  const ps = (script: string, input?: string) => new Promise<string>((resolve, reject) => {
    const p = spawnCp("powershell", ["-NoProfile", "-Command", script]);
    let out = ""; p.stdout.on("data", (d: Buffer) => (out += d)); p.on("error", reject); p.on("close", () => resolve(out.trim()));
    p.stdin.end(input ?? "");
  });
  return {
    name: "Windows (encrypted for your account)",
    available: async () => process.platform === "win32",
    async get(key) { try { const enc = (await readFile(file(key), "utf8")).trim(); const v = await ps(`$s = ConvertTo-SecureString '${enc}'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`); return v || null; } catch { return null; } },
    async set(key, value) { await mkdir(dir, { recursive: true }); const enc = await ps("$v = [Console]::In.ReadToEnd(); ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)", value); await writeFile(file(key), enc, { mode: 0o600 }); },
    async remove(key) { await rm(file(key), { force: true }); },
  };
}

// For tests: KNITTED_SECRETS_DIR keeps each secret as a file in that folder, so a test run
// of the whole studio never writes to the Keychain of the person running it.
function folder(dir: string): SecretStore {
  const file = (k: string) => join(dir, `${k.replace(/[^a-z0-9_-]/gi, "_")}.secret`);
  return {
    name: "a folder for tests",
    available: async () => true,
    async get(key) { try { return (await readFile(file(key), "utf8")) || null; } catch { return null; } },
    async set(key, value) { await mkdir(dir, { recursive: true }); await writeFile(file(key), value, { mode: 0o600 }); },
    async remove(key) { await rm(file(key), { force: true }); },
  };
}

/** The backend for this machine, or null. `override` is for tests. */
export async function secretBackend(dir: string, override?: SecretStore): Promise<SecretStore | null> {
  if (override) return override;
  if (process.env.KNITTED_SECRETS_DIR) return folder(process.env.KNITTED_SECRETS_DIR);
  for (const b of [keychain, libsecret, dpapi(dir)]) if (await b.available()) return b;
  return null;
}

export interface SecretStatus { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean; }

export async function secretStatus(key: string, dir: string, override?: SecretStore): Promise<SecretStatus> {
  const b = await secretBackend(dir, override);
  if (process.env[envName(key)]) return { present: true, source: "environment", backend: b?.name ?? null, canStore: !!b };
  const v = b ? await b.get(key) : null;
  return { present: !!v, source: v ? "keychain" : "none", backend: b?.name ?? null, canStore: !!b };
}

export async function getSecret(key: string, dir: string, override?: SecretStore): Promise<string | null> {
  const env = process.env[envName(key)];
  if (env) return env;
  const b = await secretBackend(dir, override);
  return b ? b.get(key) : null;
}

export async function setSecret(key: string, value: string, dir: string, override?: SecretStore): Promise<void> {
  const b = await secretBackend(dir, override);
  if (!b) throw new Error(`This computer has no secure place for a key. Set the ${envName(key)} environment variable instead.`);
  if (!value.trim()) throw new Error("That key is empty.");
  await b.set(key, value.trim());
}

export async function deleteSecret(key: string, dir: string, override?: SecretStore): Promise<void> {
  const b = await secretBackend(dir, override);
  if (b) await b.remove(key);
}
