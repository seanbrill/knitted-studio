"use client";

// The Library: what every project shares. Its Yarn is in every project's Yarn, in the editor
// and for a model, beside the project's own files. A file moves here from a project's Yarn,
// and back into one project when only that one uses it.

import { LIBRARY_ID } from "@knitted/core";
import { PageHeader } from "./AppShell";
import { YarnView } from "./YarnView";

export function LibraryView() {
  return (
    <div style={{ padding: "var(--space-8)", maxWidth: 1240 }}>
      <PageHeader eyebrow="Library" title="What every project shares" />
      <p className="body" style={{ margin: "0 0 var(--space-6)", color: "var(--ink-muted)", maxWidth: 720 }}>
        Files here are in every project&apos;s Yarn: a logo, a font, a photo you use for every brand. Add them here, or choose Move to the Library on a file in a project. Parts you keep in the library are in every project&apos;s Parts, marked Library.
      </p>
      <YarnView projectId={LIBRARY_ID} />
    </div>
  );
}
