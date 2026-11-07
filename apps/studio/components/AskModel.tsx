"use client";

// Ask your model to change one thing: a knit, a pattern, a file in Yarn or a part. The person says
// what should change; the model is told what the thing is and how it is changed, and gets to work
// in a chat of its own while the person stays where they are. The chat is a click away.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type KnitRecord } from "@knitted/core/client";
import type { Part, Pattern, Yarn } from "@knitted/core";
import { Button, Dialog, Field, Textarea, icons, useToast } from "@knitted/ui";

const { Sparkles } = icons;

/** What is being changed, as the model is told it, and a few things a person often asks for. */
export interface About { projectId: string; patternId?: string; name: string; what: string; context: string; ideas: string[] }

export function aboutKnit(k: KnitRecord): About {
  const size = `${k.format.toUpperCase()} at ${k.width}x${k.height}${k.durationMs ? `, ${(k.durationMs / 1000).toFixed(1)} seconds long` : ""}`;
  return {
    projectId: k.projectId, patternId: k.patternId ?? undefined, name: k.label, what: "this knit",
    context: k.patternId
      ? `This is about the knit "${k.label}" (${k.id}), a ${size}, knitted from the pattern "${k.patternName}" (${k.patternId}). A knit is a finished file: to change it, change its pattern. Look at the pattern with get_pattern and preview_pattern, make the change, check it with check_pattern, then knit it again with knit_pattern at the same size and format. Leave the old knit where it is. Say what you changed.`
      : `This is about the knit "${k.label}" (${k.id}), a ${size}. The pattern it was knitted from, "${k.patternName}", is gone, so it cannot be knitted again as it was. Find the closest pattern in the project with list_patterns, or make one, and knit a new version from that.`,
    ideas: k.kind === "video"
      ? ["Make the text come in more smoothly", "Shorter, punchier words", "Slow it down a little", "Try different music"]
      : ["Make the headline bigger", "Shorter, punchier words", "Try a different photo", "Make a square version too"],
  };
}

export function aboutPattern(p: Pattern): About {
  return {
    projectId: p.projectId, patternId: p.id, name: p.name, what: "this pattern",
    context: `This is about the pattern "${p.name}" (${p.id}), ${p.size.name} at ${p.size.w}x${p.size.h}. Look at it with preview_pattern before you change it, keep to what the brand locked, and check it with check_pattern when you are done.`,
    ideas: ["Tighten the layout", "Write new words in our voice", "Make it play as a video", "Make room for a bigger photo"],
  };
}

export function aboutYarn(y: Yarn): About {
  const how = y.kind === "copy"
    ? "To change its words, give import_yarn its yarnId and the new text."
    : "Look at it first with view_yarn. You can rename it, tag it, move it to a folder, or cut a picture out of it with crop_to_yarn.";
  return {
    projectId: y.projectId, name: y.name, what: y.kind === "copy" ? "this saved text" : "this file",
    context: `This is about the Yarn "${y.name}" (${y.id}), ${y.kind === "copy" ? "saved text" : `a ${y.kind}`}. ${how}`,
    ideas: y.kind === "copy" ? ["Make it shorter", "Write three more like it", "Say it in our voice"] : ["Give it a better name and tags", "Cut out the product", "Put it in the right folder"],
  };
}

export function aboutPart(p: Part, projectId: string): About {
  return {
    projectId, name: p.name, what: "this part",
    context: `This is about the part "${p.name}" (${p.id}). Look at it with list_parts first. Say what you changed, and which patterns it changes.`,
    ideas: ["Make it fit more words", "Use the brand's fonts", "Give it a softer entrance"],
  };
}

/** The button that opens it. */
export function AskModelButton({ about, size, variant = "secondary" }: { about: About; size?: "sm" | "md"; variant?: "secondary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size={size} variant={variant} tip={`Say what should change, and your model changes ${about.what}`} onClick={() => setOpen(true)}><Sparkles size={14} aria-hidden /> Ask your model</Button>
    <AskModelDialog about={open ? about : null} onOpenChange={setOpen} />
  </>;
}

export function AskModelDialog({ about, onOpenChange }: { about: About | null; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // Fresh each time it opens. Not on each new `about`: a caller makes one each time it draws.
  const open = !!about;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setText(""); setErr(undefined); setBusy(false); }
  }, [open]);
  const send = async () => {
    if (!about) return;
    const want = text.trim();
    if (!want) { setErr("Say what should change."); return; }
    setBusy(true);
    try {
      const { chat } = await api.chats.start({ projectId: about.projectId, patternId: about.patternId, prompt: `${about.context}\n\nWhat I want: ${want}` });
      onOpenChange(false);
      toast(`Your model is on it: ${about.name}`, { label: "Open the chat", onClick: () => router.push(`/ask?chat=${chat.id}`) }, 10_000);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Ask your model to change ${about?.what ?? "it"}`} description={about ? `${about.name}. Say what you want; your model does it in a chat of its own, and you can keep working.` : undefined}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={send}><Sparkles size={14} aria-hidden /> {busy ? "Starting..." : "Ask"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: "grid", gap: "var(--space-3)" }}>
        <Field label="What should change?" htmlFor="ask-change" error={err}>
          <Textarea id="ask-change" autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
        </Field>
        {about && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {about.ideas.map((i) => <button key={i} type="button" className="chip chip-button" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${i}` : i))}>{i}</button>)}
        </div>}
      </form>
    </Dialog>
  );
}

