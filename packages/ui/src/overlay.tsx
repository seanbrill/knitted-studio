"use client";

import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import * as M from "@radix-ui/react-dropdown-menu";
import * as C from "@radix-ui/react-context-menu";
import * as T from "@radix-ui/react-tooltip";
import * as P from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";

// ── Tooltip ────────────────────────────────────────────────────────────────
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <T.Provider delayDuration={350}>{children}</T.Provider>;
}
/**
 * A name, and `hint`: one line on what it is for, for a person who has not met it yet. A
 * tooltip is never the only place something is said: whatever it names has a name of its own.
 */
export function Tooltip({ label, hint, shortcut, children, side = "bottom" }: {
  label: string; hint?: string; shortcut?: string; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className={cx("tooltip", hint && "tooltip-hint")} side={side} sideOffset={6} collisionPadding={8}>
          <span className="tooltip-label">{label}</span>
          {shortcut && <span className="tooltip-kbd">{shortcut}</span>}
          {hint && <span className="tooltip-more">{hint}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/** A tooltip that only says what something is for, around something that names itself (a button with words). */
export function Tip({ text, children, side }: { text?: string; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  if (!text) return children;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className="tooltip tooltip-hint" side={side ?? "bottom"} sideOffset={6} collisionPadding={8}>
          <span className="tooltip-more" style={{ marginTop: 0 }}>{text}</span>
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// ── Dialog ─────────────────────────────────────────────────────────────────
/**
 * One shape for every dialog: a header with the title (the action, like "Move 3 knits") and
 * a line under it on where it lands or what it is about; a body that scrolls on its own; and
 * a footer that stays put, with `note` on its left and the buttons on its right. Three
 * widths: sm to confirm, md to make or change one thing, lg to pick from many.
 */
export function Dialog({ open, onOpenChange, title, description, children, wide, size, actions, note }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode;
  children?: React.ReactNode; wide?: boolean; size?: "sm" | "md" | "lg"; actions?: React.ReactNode; note?: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="overlay" />
        <D.Content className={cx("dialog", `dialog-${size ?? (wide ? "lg" : "md")}`)}>
          <header className="dialog-head">
            <D.Title className="dialog-title">{title}</D.Title>
            {description ? <D.Description className="dialog-desc">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </header>
          {children != null && children !== false && <div className="dialog-body">{children}</div>}
          {(actions || note) && <footer className="dialog-actions">{note && <span className="dialog-actions-note">{note}</span>}{actions}</footer>}
          <D.Close asChild>
            <button className="icon-btn dialog-close" aria-label="Close"><X size={16} /></button>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * A big window for looking at one thing and working on it: its own header (`lead` before the
 * title, `trail` after it), a body that keeps its parts in view as they scroll on their own,
 * and a footer that stays put, so its buttons are never scrolled away or under a toast.
 */
export function Viewer({ open, onOpenChange, title, sub, lead, trail, footer, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; sub?: React.ReactNode;
  lead?: React.ReactNode; trail?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="overlay" />
        {/* It takes the focus itself, not its first button: a button focused shows its tooltip, and Esc would close that, not the window. */}
        <D.Content className="viewer" aria-describedby={undefined} onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus(); }}>
          <header className="viewer-head">
            {lead}
            <div className="viewer-name">
              <D.Title className="viewer-title">{title}</D.Title>
              {sub && <p className="viewer-sub">{sub}</p>}
            </div>
            {trail}
            <D.Close asChild><button className="icon-btn" aria-label="Close"><X size={16} /></button></D.Close>
          </header>
          <div className="viewer-body">{children}</div>
          {footer && <footer className="viewer-foot">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * A destructive confirmation. `requireText` makes the user type a name before
 * the button works, for things that cannot be undone (a project with files).
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, requireText, onConfirm, children, sub, lead }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel: string;
  requireText?: string; onConfirm: () => void | Promise<void>; children?: React.ReactNode;
  /** A line under the title on what it is about; then `description`, in the body, says what goes. */
  sub?: React.ReactNode;
  /** Shown first in the body, before `description`: what it holds, say. */
  lead?: React.ReactNode;
}) {
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!open) { setTyped(""); setBusy(false); } }, [open]);
  const ok = !requireText || typed === requireText;
  const go = async () => { if (!ok || busy) return; setBusy(true); try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); } };
  const body = sub && description ? <p className="confirm-what">{description}</p> : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={title}
      description={sub ?? description}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" disabled={!ok || busy} onClick={() => void go()}>{confirmLabel}</Button>
        </>
      }
    >
      {lead || body || children || requireText ? <>
        {lead}
        {body}
        {children}
        {requireText && (
          <label className="field" style={{ marginTop: "var(--space-3)" }}>
            <span className="field-label">Type <code className="confirm-name">{requireText}</code> to delete it</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void go(); } }} autoFocus />
          </label>
        )}
      </> : null}
    </Dialog>
  );
}

// ── Drawer: a Dialog that slides in from the right, for detail panels ──────
export function Drawer({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="overlay" style={{ background: "rgba(23,17,11,0.25)" }} />
        <D.Content className="drawer" aria-describedby={undefined}>
          <D.Title className="sr-only">{title}</D.Title>
          {children}
          <D.Close asChild>
            <button className="icon-btn" aria-label="Close" style={{ position: "absolute", top: 12, right: 12 }}><X size={16} /></button>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ── Menus ──────────────────────────────────────────────────────────────────
export interface MenuEntry {
  label: string; onSelect: () => void; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; shortcut?: string;
  /** A quiet line under the label: what it does to what is inside, or why it cannot be done now. */
  hint?: string;
}
export type MenuItems = (MenuEntry | "separator")[];

function renderItems(items: MenuItems, Item: typeof M.Item, Sep: typeof M.Separator) {
  return items.map((it, i) =>
    it === "separator" ? (
      <Sep key={`s${i}`} className="menu-sep" />
    ) : (
      <Item key={it.label} className={cx("menu-item", it.danger && "danger", it.hint && "menu-item-hinted")} disabled={it.disabled} onSelect={it.onSelect}>
        {it.icon}
        <span className="menu-text">{it.label}{it.hint && <span className="menu-hint">{it.hint}</span>}</span>
        {it.shortcut && <span className="menu-kbd">{it.shortcut}</span>}
      </Item>
    ),
  );
}

export function Menu({ trigger, items, align = "end" }: { trigger: React.ReactElement; items: MenuItems; align?: "start" | "end" | "center" }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content className="menu" align={align} sideOffset={6}>{renderItems(items, M.Item, M.Separator)}</M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function ContextMenu({ items, children }: { items: MenuItems; children: React.ReactElement }) {
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className="menu">
          {renderItems(items, C.Item as unknown as typeof M.Item, C.Separator as unknown as typeof M.Separator)}
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}

// ── Popover ────────────────────────────────────────────────────────────────
export function Popover({ trigger, children, align = "start" }: { trigger: React.ReactElement; children: React.ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content className="popover" align={align} sideOffset={8}>{children}</P.Content>
      </P.Portal>
    </P.Root>
  );
}
