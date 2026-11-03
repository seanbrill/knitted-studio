"use client";

import * as React from "react";
import { Command } from "cmdk";
import * as D from "@radix-ui/react-dialog";

export interface CommandAction { id: string; label: string; group: string; icon?: React.ReactNode; keywords?: string; run: () => void; }

/** Cmd/Ctrl+K. Routes and actions are searchable; the list is supplied by the app. */
export function CommandPalette({ actions }: { actions: CommandAction[] }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="overlay" />
        <D.Content className="dialog cmdk" style={{ padding: 0, top: "22%", transform: "translate(-50%, 0)" }} aria-label="Command palette">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search for a page or an action</D.Description>
          <Command label="Command palette">
            <Command.Input className="cmdk-input" placeholder="Search pages and actions" autoFocus />
            <Command.List className="cmdk-list">
              <Command.Empty className="cmdk-empty">Nothing matches. Try another word.</Command.Empty>
              {groups.map((g) => (
                <Command.Group key={g} heading={<span className="eyebrow cmdk-group">{g}</span>}>
                  {actions.filter((a) => a.group === g).map((a) => (
                    <Command.Item key={a.id} value={`${a.label} ${a.keywords ?? ""}`} className="cmdk-item" onSelect={() => { setOpen(false); a.run(); }}>
                      {a.icon}{a.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
