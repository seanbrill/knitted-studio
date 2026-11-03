"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadYarn, type UploadHandle } from "@knitted/core/client";

export type UploadStatus = "queued" | "uploading" | "done" | "existing" | "error" | "cancelled";
export interface UploadItem { id: number; name: string; size: number; progress: number; status: UploadStatus; error?: string; yarnId?: string; }

const CONCURRENCY = 2;

/**
 * An upload queue: a few at a time, each with its own progress and cancel, and
 * an honest end state for every file (added, already there, or why it failed).
 */
export function useUploads(projectId: string, onSettled: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<{ id: number; file: File }[]>([]);
  const handles = useRef(new Map<number, UploadHandle>());
  const running = useRef(0);
  const next = useRef(1);

  const patch = useCallback((id: number, p: Partial<UploadItem>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i))), []);

  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const { id, file } = queue.current.shift()!;
      running.current++;
      patch(id, { status: "uploading" });
      const h = uploadYarn(projectId, file, (f) => patch(id, { progress: f }));
      handles.current.set(id, h);
      h.promise
        .then((r) => patch(id, { status: r.existing ? "existing" : "done", progress: 1, yarnId: r.yarn.id }))
        .catch((e: Error & { kind?: string }) => patch(id, e.kind === "cancelled" ? { status: "cancelled" } : { status: "error", error: e.message }))
        .finally(() => { handles.current.delete(id); running.current--; onSettled(); pumpRef.current(); });
    }
  }, [projectId, patch, onSettled]);
  useEffect(() => { pumpRef.current = pump; });

  const add = useCallback((files: File[]) => {
    const fresh = files.map((file) => ({ id: next.current++, file }));
    setItems((all) => [...all, ...fresh.map(({ id, file }) => ({ id, name: file.name, size: file.size, progress: 0, status: "queued" as const }))]);
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
