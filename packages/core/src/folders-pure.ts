// Folders, the part that is only words: what a folder's path is, and how to read one.
// The studio's pages use these to show a section's folders; folders.ts keeps them.
//
// A folder is a path of names, "Royalty free music/Lo-fi", and "" is the top of a
// section. Each section has folders of its own: a Yarn folder holds Yarn, a Pattern
// folder holds patterns.

export type FolderSection = "patterns" | "yarn" | "parts" | "swatches" | "knits";
export const FOLDER_SECTIONS: FolderSection[] = ["patterns", "yarn", "parts", "swatches", "knits"];

/** How deep folders go, and how long one's name may be. */
export const FOLDER_DEPTH = 6;
export const FOLDER_NAME_MAX = 60;

/** The names in a path, each tidied: spaces trimmed and run together, control characters gone. */
export function folderNames(raw: string): string[] {
  return String(raw).split("/").map((n) => n.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** What is wrong with a path, in a line, or null when it can be one. */
export function folderProblem(raw: string): string | null {
  const names = folderNames(raw);
  if (names.length > FOLDER_DEPTH) return `Folders go ${FOLDER_DEPTH} deep at most. Put this one higher up.`;
  const long = names.find((n) => n.length > FOLDER_NAME_MAX);
  if (long) return `"${long.slice(0, 24)}..." is too long for a folder's name. Keep it under ${FOLDER_NAME_MAX} characters.`;
  if (names.some((n) => n === "." || n === "..")) return "A folder cannot be called . or ..";
  return null;
}

export const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const joinFolder = (parent: string, name: string) => (parent && name ? `${parent}/${name}` : parent || name);
/** Whether `path` is `folder` or somewhere inside it. Everything is inside the top. */
export const isInside = (path: string, folder: string) => !folder || path === folder || path.startsWith(`${folder}/`);
/** How many folders deep a path is. The top is 0. */
export const depthOf = (path: string) => (path ? path.split("/").length : 0);

/**
 * Where `path` is once the folder `from` has become `to`, or null when it was not in
 * it. A folder that is deleted becomes the one that held it, so `to` may be "".
 */
export function refiled(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? joinFolder(to, path.slice(from.length + 1)) : null;
}

/** Folders in the order people expect: name by name, ignoring case, "Week 2" before "Week 10". */
export function compareFolders(a: string, b: string): number {
  const x = a.split("/"), y = b.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i].localeCompare(y[i], undefined, { numeric: true, sensitivity: "base" }) || (x[i] < y[i] ? -1 : x[i] > y[i] ? 1 : 0);
    if (c) return c;
  }
  return x.length - y.length;
}

/** The folders directly inside `parent`, in order. */
export const foldersIn = (all: string[], parent: string) => all.filter((f) => f && parentOf(f) === parent).sort(compareFolders);
