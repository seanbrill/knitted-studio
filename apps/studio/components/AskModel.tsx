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
export interface About { projectId: string; patternId?: string; name: string; what: string; context: string; ideas: string[]; /** Something new to make, not a thing to change. */ make?: keyof typeof MAKE }

/** The words for asking a model to make something new, rather than to change what is there. */
const MAKE = {
  draw: { button: "Draw with your model", tip: "Say what to draw: icons, a mascot in new poses, a badge. Your model draws it as SVG, here in Yarn", title: "Ask your model to draw", description: "It is drawn as SVG and kept in Yarn", field: "What should it draw?", empty: "Say what to draw." },
  design: { button: "Design with your model", tip: "Say what to design: a page, a section, the phone version. Your model designs it on the sheet, in your brand", title: "Ask your model to design", description: "It is designed on the sheet, in your brand", field: "What should it design?", empty: "Say what to design." },
};

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
    : `Look at it first with view_yarn. You can rename it, tag it, move it to a folder, or cut a picture out of it with crop_to_yarn.${y.kind === "image" ? " To draw new pictures from it, like a mascot in new poses or icons in its style, read get_guide drawing and use draw_svg with from: its id." : ""}`;
  return {
    projectId: y.projectId, name: y.name, what: y.kind === "copy" ? "this saved text" : "this file",
    context: `This is about the Yarn "${y.name}" (${y.id}), ${y.kind === "copy" ? "saved text" : `a ${y.kind}`}. ${how}`,
    ideas: y.kind === "copy" ? ["Make it shorter", "Write three more like it", "Say it in our voice"]
      : y.kind === "image" ? ["Give it a better name and tags", "Cut out the product", "Draw it as SVG in three new poses"]
      : ["Give it a better name and tags", "Put it in the right folder"],
  };
}

/** Something new to draw for a project, as SVG: icons, a mascot's poses, a badge. */
export function aboutDrawing(projectId: string, folder?: string): About {
  return {
    projectId, name: "A drawing", what: "a drawing", make: "draw",
    context: `The person wants something drawn for this project, as SVG. Read get_guide drawing first. Look at what it should match (view_yarn on any reference they name, get_brand_guidelines for the colours), then draw it with draw_svg, and look at what comes back. For a set, keep one system, put it in one folder${folder ? ` (they are in the folder "${folder}")` : ""}, and check it with view_sheet. Say what you drew and where it is.`,
    ideas: ["Icons for our website: menu, search, cart, account, phone, map pin", "Our mascot waving, pointing and giving a thumbs up", "A divider and a corner flourish in our colours"],
  };
}

/** A design sheet, or one frame on it; with no sheet, a new one to start. */
export function aboutDesign(projectId: string, design?: { id: string; name: string }, frame?: { id: string; name: string }): About {
  const start = "Read get_guide designing first. Look at the brand with get_brand_guidelines and the business with get_brief, and write in its own words, not placeholders.";
  if (!design) return {
    projectId, name: "A design", what: "a design", make: "design",
    context: `The person wants a site designed for this project, on a design sheet. ${start} Start a sheet with create_design from the brand, design each screen with set_design_frame, look at what comes back, and fix what is off. Make a phone version of every page. Say what you designed, and in which sections.`,
    ideas: ["Our whole site: home, about, pricing and contact, on a computer and a phone", "A landing page for our newest product", "A home page and a menu page for our cafe"],
  };
  if (frame) return {
    projectId, name: `${frame.name} in ${design.name}`, what: "this frame",
    context: `This is about the frame "${frame.name}" (${frame.id}) on the design sheet "${design.name}" (${design.id}). ${start} Look at it with get_design and view_design, change it with set_design_frame, and look at what comes back. Say what you changed.`,
    ideas: ["Write it in our own words, from the brief", "Use our photos from Yarn", "Make the phone version of this", "More room between things"],
  };
  return {
    projectId, name: design.name, what: "this design", make: "design",
    context: `This is about the design sheet "${design.name}" (${design.id}). ${start} Look at it with get_design and view_design. Design with set_design_frame, arrange it with arrange_design, and look at what comes back. Say what you designed, and in which sections.`,
    ideas: ["Write the home page in our own words, from the brief", "Add a pricing page, on a computer and a phone", "Add an about page", "A components section: cards, a testimonial, a form"],
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
  const make = about.make && MAKE[about.make];
  return <>
    <Button size={size} variant={variant} tip={make ? make.tip : `Say what should change, and your model changes ${about.what}`} onClick={() => setOpen(true)}><Sparkles size={14} aria-hidden /> {make ? make.button : "Ask your model"}</Button>
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
  const make = about?.make && MAKE[about.make];
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setText(""); setErr(undefined); setBusy(false); }
  }, [open]);
  const send = async () => {
    if (!about) return;
    const want = text.trim();
    if (!want) { setErr(make ? make.empty : "Say what should change."); return; }
    setBusy(true);
    try {
      const { chat } = await api.chats.start({ projectId: about.projectId, patternId: about.patternId, prompt: `${about.context}\n\nWhat I want: ${want}` });
      onOpenChange(false);
      toast(`Your model is on it: ${about.name}`, { label: "Open the chat", onClick: () => router.push(`/ask?chat=${chat.id}`) }, 10_000);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={make ? make.title : `Ask your model to change ${about?.what ?? "it"}`} description={about ? `${make ? make.description : about.name}. Say what you want; your model does it in a chat of its own, and you can keep working.` : undefined}
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={send}><Sparkles size={14} aria-hidden /> {busy ? "Starting..." : "Ask"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: "grid", gap: "var(--space-3)" }}>
        <Field label={make ? make.field : "What should change?"} htmlFor="ask-change" error={err}>
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

