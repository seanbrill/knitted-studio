"use client";

import { Button, EmptyState } from "@knitted/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <EmptyState
        title="Something broke on our side"
        body={`${error.message || "An unexpected error."} Try again, and if it keeps happening, your work is saved and safe.`}
        action={<Button variant="primary" onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
