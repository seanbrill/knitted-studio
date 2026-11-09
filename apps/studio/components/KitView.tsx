"use client";

import { useState } from "react";
import {
  Button, Chip, ConfirmDialog, ContextMenu, Dialog, DropZone, EmptyState, Field, IconButton, Input, Kbd, Menu,
  Popover, Select, SegmentedControl, Skeleton, Slider, StitchDivider, StitchProgress, Switch, SwatchChip, Textarea,
  ToggleChip, ColorField, icons, useToast,
} from "@knitted/ui";

const { Plus, Trash2, MoreHorizontal, Pencil, Copy } = icons;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "var(--space-10)" }}>
      <p className="eyebrow" style={{ marginBottom: "var(--space-3)" }}>{title}</p>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>{children}</div>
    </section>
  );
}

export function KitView() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sw, setSw] = useState(true);
  const [sl, setSl] = useState(40);
  const [seg, setSeg] = useState("a");
  const [sel, setSel] = useState("story");
  const [hex, setHex] = useState("#DF5A0F");
  const [pressed, setPressed] = useState(false);
  return (
    <div className="page" style={{ maxWidth: 1040 }}>
      <h1 className="h1" style={{ marginBottom: "var(--space-8)" }}>Kit</h1>

      <Section title="Buttons">
        <Button variant="primary">Knit</Button>
        <Button>Secondary</Button>
        <Button variant="dark">Dark</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger"><Trash2 size={14} /> Delete</Button>
        <Button variant="primary" disabled>Disabled</Button>
        <Button size="sm">Small</Button>
        <IconButton label="Add" shortcut="N"><Plus size={16} /></IconButton>
        <IconButton label="Toggle" pressed={pressed} onClick={() => setPressed(!pressed)}><Pencil size={16} /></IconButton>
      </Section>

      <Section title="Fields">
        <div style={{ width: 260 }}><Field label="Name" hint="What you will call it"><Input placeholder="Launch week" /></Field></div>
        <div style={{ width: 260 }}><Field label="Headline" error="That is too long for a story. Keep it under 40 characters."><Input aria-label="Headline" aria-invalid defaultValue="A very long headline" /></Field></div>
        <div style={{ width: 260 }}><Field label="Notes"><Textarea placeholder="Anything to remember" /></Field></div>
        <div style={{ width: 200 }}>
          <Field label="Size">
            <Select aria-label="Size" value={sel} onValueChange={setSel} options={[{ value: "story", label: "Story" }, { value: "post", label: "Post" }, { value: "square", label: "Square" }]} />
          </Field>
        </div>
        <ColorField label="Brand" value={hex} onChange={setHex} />
      </Section>

      <Section title="Controls">
        <Switch label="Lock to pattern" checked={sw} onCheckedChange={setSw} />
        <div style={{ width: 260 }}><Slider label="Opacity" value={sl} onChange={setSl} /></div>
        <SegmentedControl label="View" value={seg} onChange={setSeg} options={[{ value: "a", label: "Grid" }, { value: "b", label: "List" }]} />
        <ToggleChip pressed={pressed} onClick={() => setPressed(!pressed)}>Filter</ToggleChip>
      </Section>

      <Section title="Display">
        <Chip>Plain</Chip><Chip tone="ember">Locked</Chip><Kbd>Cmd</Kbd><Kbd>K</Kbd>
        <SwatchChip name="knitted" colors={["#DF5A0F", "#D92414", "#5C1410", "#FFB347", "#17110B"]} />
        <div style={{ width: 200 }}><Skeleton height={20} /></div>
        <StitchProgress total={12} done={7} />
      </Section>

      <Section title="Overlays">
        <Button onClick={() => setOpen(true)}>Dialog</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>Confirm delete</Button>
        <Menu trigger={<IconButton label="More"><MoreHorizontal size={16} /></IconButton>} items={[
          { label: "Rename", icon: <Pencil size={14} />, onSelect: () => toast("Rename chosen") },
          { label: "Duplicate", icon: <Copy size={14} />, shortcut: "D", onSelect: () => toast("Duplicated") },
          "separator",
          { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => toast("Deleted", { label: "Undo", onClick: () => toast("Restored") }) },
        ]} />
        <ContextMenu items={[{ label: "Right-click action", onSelect: () => toast("Context action") }]}>
          <div className="card" style={{ padding: "var(--space-4)" }}>Right-click me</div>
        </ContextMenu>
        <Popover trigger={<Button>Popover</Button>}><p className="body-sm" style={{ margin: 0 }}>Floating things get the lift shadow.</p></Popover>
        <Button onClick={() => toast("Saved", { label: "Undo", onClick: () => {} })}>Toast</Button>
      </Section>

      <Section title="Drop zone">
        <div style={{ width: 360 }}><DropZone onFiles={(f) => toast(`${f.length} file(s) dropped`)} /></div>
      </Section>

      <StitchDivider />
      <EmptyState title="Nothing here yet" body="Empty states say what goes here and how to start." action={<Button variant="primary">Start</Button>} />

      <Dialog open={open} onOpenChange={setOpen} title="A dialog" description="Dialogs trap focus and close with Esc." actions={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}>
        <Field label="Name"><Input autoFocus /></Field>
      </Dialog>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this project?" description="This removes its Yarn and Patterns." confirmLabel="Delete project" requireText="Launch week" onConfirm={() => toast("Deleted")} />
    </div>
  );
}
