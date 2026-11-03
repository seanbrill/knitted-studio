import type { Status } from "../lib/features";

/** Status is never colour alone: a word and a mark come with it. */
export function Badge({ status }: { status: Status }) {
  return status === "shipped" ? (
    <span className="badge badge-shipped">
      <span aria-hidden="true">&#10003;</span> Available now
    </span>
  ) : (
    <span className="badge badge-soon">
      <span aria-hidden="true">&#9719;</span> Coming soon
    </span>
  );
}
