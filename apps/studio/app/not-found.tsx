import Link from "next/link";
import { EmptyState } from "@knitted/ui";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <EmptyState
        title="That page is not here"
        body="It may have moved, or the link was typed wrong. Head back to your projects."
        action={<Link href="/projects" className="btn btn-primary">Open projects</Link>}
      />
    </div>
  );
}
