"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadYarn, type UploadHandle } from "@knitted/core/client";

export type UploadStatus = "queued" | "uploading" | "done" | "existing" | "error" | "cancelled";
/** `into`: the Yarn folder it was added in. `folder`, once it is up: the one it is in, which for a file already there is where it was. */
export interface UploadItem { id: number; name: string; size: number; progress: number; status: UploadStatus; error?: string; yarnId?: string; into: string; folder?: string; }

const CONCURRENCY = 2;

/**
 * An upload queue: a few at a time, each with its own progress and cancel, and
 * an honest end state for every file (added, already there, or why it failed).
 * Each file goes into the Yarn folder it was added in, wherever the person is by
 * the time it uploads.
 */
export function useUploads(projectId: string, onSettled: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<{ id: number; file: File; folder: string }[]>([]);
  const handles = useRef(new Map<number, UploadHandle>());
  const running = useRef(0);
  const next = useRef(1);

  const patch = useCallback((id: number, p: Partial<UploadItem>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i))), []);

  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const { id, file, folder } = queue.current.shift()!;
      running.current++;
      patch(id, { status: "uploading" });
      const h = uploadYarn(projectId, file, (f) => patch(id, { progress: f }), { folder });
      handles.current.set(id, h);
      h.promise
        .then((r) => patch(id, { status: r.existing ? "existing" : "done", progress: 1, yarnId: r.yarn.id, folder: r.yarn.folder }))
        .catch((e: Error & { kind?: string }) => patch(id, e.kind === "cancelled" ? { status: "cancelled" } : { status: "error", error: e.message }))
        .finally(() => { handles.current.delete(id); running.current--; onSettled(); pumpRef.current(); });
    }
  }, [projectId, patch, onSettled]);
  useEffect(() => { pumpRef.current = pump; });

  const add = useCallback((files: File[], folder = "") => {
    const fresh = files.map((file) => ({ id: next.current++, file, folder }));
    setItems((all) => [...all, ...fresh.map(({ id, file }) => ({ id, name: file.name, size: file.size, progress: 0, status: "queued" as const, into: folder }))]);
    queue.current.push(...fresh);
    pump();
  }, [pump]);

  const cancel = useCallback((id: number) => {
    const h = handles.current.get(id);
    if (h) h.cancel();
    else { queue.current = queue.current.filter((q) => q.id !== id); patch(id, { status: "cancelled" }); }
  }, [patch]);

  const clearFinished = useCallback(() => setItems((all) => all.filter((i) => i.status === "queued" || i.status === "uploading")), []);

  return { items, add, cancel, clearFinished };
}
