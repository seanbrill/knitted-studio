"use client";

// Ask your model to change one thing: a knit, a pattern, a file in Yarn or a part. The person says
// what should change; the model is told what the thing is and how it is changed, and gets to work
// in a chat of its own while the person stays where they are. The chat is a click away.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, knitFileUrl, yarnPictureUrl, type KnitRecord } from "@knitted/core/client";
import { sizeNamed, type Part, type Pattern, type Yarn } from "@knitted/core";
import { Button, Dialog, Field, Textarea, icons, useToast } from "@knitted/ui";
import { keyText } from "./Shortcuts";
import { currentChoice } from "@/lib/model-choice";
import { ModelPicker } from "./ModelPicker";

const { Sparkles, RotateCw } = icons;

/**
 * What is being changed, as the model is told it, and a few things a person often asks for.
 * The person sees its picture and a line or two about it, and `back`: what comes back.
 */
export interface About {
  projectId: string; patternId?: string; name: string; what: string; context: string; ideas: string[];
  /** Something new to make, not a thing to change. */ make?: keyof typeof MAKE;
  pic?: { src: string; video?: boolean; w: number; h: number }; facts?: string[]; back?: string;
}

/** The words for asking a model to make something new, rather than to change what is there. */
const MAKE = {
  draw: { button: "Draw with your model", tip: "Say what to draw: icons, a mascot in new poses, a badge. Your model draws it as SVG, here in Yarn", title: "Ask your model to draw", field: "What should it draw?", empty: "Say what to draw." },
  design: { button: "Design with your model", tip: "Say what to design: a page, a section, the phone version. Your model designs it on the sheet, in your brand", title: "Ask your model to design", field: "What should it design?", empty: "Say what to design." },
};

export function aboutKnit(k: KnitRecord): About {
  const size = `${k.format.toUpperCase()} at ${k.width}x${k.height}${k.durationMs ? `, ${(k.durationMs / 1000).toFixed(1)} seconds long` : ""}`;
  return {
    projectId: k.projectId, patternId: k.patternId ?? undefined, name: k.label, what: "this knit",
    context: k.patternId
      ? `This is about the knit "${k.label}" (${k.id}), a ${size}, knitted from the pattern "${k.patternName}" (${k.patternId}). A knit is a finished file: to change it, change its pattern. Look at the pattern with get_pattern and preview_pattern, make the change, check it with check_pattern, then knit it again with knit_pattern at the same size and format. That makes the next version of this knit, shown in its place, and the old one stays under its Versions. Say what you changed.`
      : `This is about the knit "${k.label}" (${k.id}), a ${size}. The pattern it was knitted from, "${k.patternName}", is gone, so it cannot be knitted again as it was. Find the closest pattern in the project with list_patterns, or make one, and knit a new version from that.`,
    ideas: k.kind === "video"
      ? ["Make the text come in more smoothly", "Shorter, punchier words", "Slow it down a little", "Try different music"]
      : ["Make the headline bigger", "Shorter, punchier words", "Try a different photo", "Make a square version too"],
    pic: { src: knitFileUrl(k), video: k.kind === "video", w: k.width, h: k.height },
    facts: [`${sizeNamed(k.width / (k.scale || 1), k.height / (k.scale || 1)) ?? "Custom"} · ${k.format.toUpperCase()} ${k.width} × ${k.height}`, k.patternId ? `From the pattern ${k.patternName}` : `Its pattern, ${k.patternName}, is gone`],
    back: k.patternId
      ? `Your model changes the pattern ${k.patternName} and knits it again. The new one becomes this knit, as version ${(k.versions ?? 1) + 1}; this one stays under Versions.`
      : "Its pattern is gone, so your model knits a new version from the closest pattern there is, or one it makes. This one stays under Versions.",
  };
}

export function aboutPattern(p: Pattern): About {
  return {
    projectId: p.projectId, patternId: p.id, name: p.name, what: "this pattern",
    context: `This is about the pattern "${p.name}" (${p.id}), ${p.size.name} at ${p.size.w}x${p.size.h}. Look at it with preview_pattern before you change it, keep to what the brand locked, and check it with check_pattern when you are done.`,
    ideas: ["Tighten the layout", "Write new words in our voice", "Make it play as a video", "Make room for a bigger photo"],
    facts: [`${p.size.name} · ${p.size.w} × ${p.size.h}`, `${p.stitches.length} ${p.stitches.length === 1 ? "stitch" : "stitches"}${p.durationMs ? `, ${(p.durationMs / 1000).toFixed(1)} seconds` : ""}`],
    back: `Your model changes ${p.name} where it is, and keeps to what the brand locked. Each change goes into its History, so any of them can be taken back.`,
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
    ...(y.kind === "image" ? { pic: { src: yarnPictureUrl(y), w: y.width || 1, h: y.height || 1 } } : {}),
    facts: [y.kind === "copy" ? "Saved text" : `${y.kind[0]!.toUpperCase()}${y.kind.slice(1)}${y.width && y.height ? ` · ${y.width} × ${y.height}` : ""}`, ...(y.folder ? [`In ${y.folder.split("/").join(" / ")}`] : [])],
    back: y.kind === "copy"
      ? "Your model writes the new words into this saved text, or saves new ones beside it."
      : `Your model works on it in Yarn: a better name, tags or a folder${y.kind === "image" ? ", or new pictures cut out or drawn from it, kept beside it. The file itself stays as it is" : ""}.`,
  };
}

/** Something new to draw for a project, as SVG: icons, a mascot's poses, a badge. */
export function aboutDrawing(projectId: string, folder?: string): About {
  return {
    projectId, name: "A drawing", what: "a drawing", make: "draw",
    context: `The person wants something drawn for this project, as SVG. Read get_guide drawing first. Look at what it should match (view_yarn on any reference they name, get_brand_guidelines for the colours), then draw it with draw_svg, and look at what comes back. For a set, keep one system, put it in one folder${folder ? ` (they are in the folder "${folder}")` : ""}, and check it with view_sheet. Say what you drew and where it is.`,
    ideas: ["Icons for our website: menu, search, cart, account, phone, map pin", "Our mascot waving, pointing and giving a thumbs up", "A divider and a corner flourish in our colours"],
    back: `Your model draws it as SVG, in your colours, and keeps it in Yarn${folder ? `, in ${folder.split("/").join(" / ")}` : ""}. You can open the chat to see it work.`,
  };
}

/** A design sheet, or one frame on it; with no sheet, a new one to start. */
export function aboutDesign(projectId: string, design?: { id: string; name: string }, frame?: { id: string; name: string }): About {
  const start = "Read get_guide designing first. Look at the brand with get_brand_guidelines and the business with get_brief, and write in its own words, not placeholders.";
  if (!design) return {
    projectId, name: "A design", what: "a design", make: "design",
    context: `The person wants a site designed for this project, on a design sheet. ${start} Start a sheet with create_design from the brand, design each screen with set_design_frame, look at what comes back, and fix what is off. Make a phone version of every page. Say what you designed, and in which sections.`,
    ideas: ["Our whole site: home, about, pricing and contact, on a computer and a phone", "A landing page for our newest product", "A home page and a menu page for our cafe"],
    back: "Your model starts a design sheet in your brand and designs each screen on it, with a phone version of each page.",
  };
  if (frame) return {
    projectId, name: `${frame.name} in ${design.name}`, what: "this frame",
    context: `This is about the frame "${frame.name}" (${frame.id}) on the design sheet "${design.name}" (${design.id}). ${start} Look at it with get_design and view_design, change it with set_design_frame, and look at what comes back. Say what you changed.`,
    ideas: ["Write it in our own words, from the brief", "Use our photos from Yarn", "Make the phone version of this", "More room between things"],
    facts: [`On ${design.name}`], back: "Your model changes this frame on the sheet, looks at it as it goes, and says what it changed.",
  };
  return {
    projectId, name: design.name, what: "this design", make: "design",
    context: `This is about the design sheet "${design.name}" (${design.id}). ${start} Look at it with get_design and view_design. Design with set_design_frame, arrange it with arrange_design, and look at what comes back. Say what you designed, and in which sections.`,
    ideas: ["Write the home page in our own words, from the brief", "Add a pricing page, on a computer and a phone", "Add an about page", "A components section: cards, a testimonial, a form"],
    back: "Your model designs on this sheet, in your brand, and says what it designed and where.",
  };
}

export function aboutPart(p: Part, projectId: string): About {
  return {
    projectId, name: p.name, what: "this part",
    context: `This is about the part "${p.name}" (${p.id}). Look at it with list_parts first. Say what you changed, and which patterns it changes.`,
    ideas: ["Make it fit more words", "Use the brand's fonts", "Give it a softer entrance"],
    facts: [`${p.slots.length} ${p.slots.length === 1 ? "slot" : "slots"}, version ${p.version}`],
    back: "Your model changes the part itself. Each pattern that uses it is offered the update, and keeps what was filled in.",
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
      const { chat } = await api.chats.start({ projectId: about.projectId, patternId: about.patternId, prompt: `${about.context}\n\nWhat I want: ${want}`, model: currentChoice() });
      onOpenChange(false);
      toast(`Your model is on it: ${about.name}`, { label: "Open the chat", onClick: () => router.push(`/ask?chat=${chat.id}`) }, 10_000);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const pic = about?.pic;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size={pic ? "lg" : "md"} title={make ? make.title : `Ask your model to change ${about?.what ?? "it"}`}
      description={about ? "It works in a chat of its own, and you keep working" : undefined}
      actions={<><ModelPicker /><span style={{ flex: 1 }} /><span className="dialog-actions-note ask-keys" aria-hidden><kbd className="kbd">{keyText(["mod", "Enter"])}</kbd> asks</span><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={send}><Sparkles size={14} aria-hidden /> {busy ? "Starting..." : make ? make.button : "Ask your model"}</Button></>}>
      <form className={pic ? "ask-model ask-model-pic" : "ask-model"} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {about && pic && (
          <figure className="ask-about">
            {pic.video ? <video src={pic.src} muted preload="metadata" style={{ aspectRatio: `${pic.w} / ${pic.h}` }} /> : <img src={pic.src} alt="" style={{ aspectRatio: `${pic.w} / ${pic.h}` }} />}
            <figcaption><b>{about.name}</b>{about.facts?.map((f) => <small key={f}>{f}</small>)}</figcaption>
          </figure>
        )}
        <div style={{ display: "grid", gap: "var(--space-3)", alignContent: "start" }}>
          {about && !pic && !make && <p className="ask-about-line"><b>{about.name}</b>{about.facts?.length ? <span>{about.facts.join(" · ")}</span> : null}</p>}
          <Field label={make ? make.field : "What should change?"} htmlFor="ask-change" error={err}>
            <Textarea id="ask-change" autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
          </Field>
          {about && <div className="ask-ideas" role="group" aria-label="Ideas">
            {about.ideas.map((i) => <button key={i} type="button" className="chip chip-button" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${i}` : i))}>{i}</button>)}
          </div>}
          {about?.back && (
            <section className="ask-back" aria-label="What comes back">
              <span className="ask-back-icon" aria-hidden><RotateCw size={14} /></span>
              <div><b>What comes back</b><p>{about.back}</p></div>
            </section>
          )}
        </div>
      </form>
    </Dialog>
  );
}

