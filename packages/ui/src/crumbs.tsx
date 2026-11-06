"use client";

import * as React from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { ChevronRight, MoreHorizontal } from "lucide-react";

/**
 * One step of a trail. `href` makes it a link (`linkAs` says which kind), `onClick` a button;
 * the last step is where the person is, and is neither. `props` go on the step itself: a
 * folder's step takes things dropped on it.
 */
export interface Crumb {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  /** Said in full when the label is cut short, or what this step is, when that helps. */
  title?: string;
  props?: React.HTMLAttributes<HTMLElement>;
  /** In place of the label, for the last step: a name the person can edit where it is, say. */
  render?: React.ReactNode;
}

type LinkLike = React.ComponentType<{ href: string; className?: string; title?: string; children: React.ReactNode; scroll?: boolean } & React.HTMLAttributes<HTMLElement>>;

/**
 * Where the person is, from the top: Projects, the project, the section, the folder. Every
 * step but the last goes back there. A long trail keeps its first step and its last ones,
 * and the steps between are in a menu, so it stays on one line.
 */
export function Breadcrumbs({ items, label = "Breadcrumbs", linkAs: LinkAs, navigate, current = "page", keep = 4, className, style }: {
  items: Crumb[]; label?: string; linkAs?: LinkLike;
  /** How a step in the folded menu goes to its href: the app's router, so the page is not loaded again. */
  navigate?: (href: string) => void;
  current?: "page" | "location";
  /** The most steps shown before the middle ones fold into a menu. */
  keep?: number; className?: string; style?: React.CSSProperties;
}) {
  if (!items.length) return null;
  const tail = Math.max(1, keep - 1);
  const fold = items.length > keep;
  const at = items.map((c, i) => ({ c, i }));
  const shown = fold ? [at[0], ...at.slice(items.length - tail)] : at;
  const folded = fold ? items.slice(1, items.length - tail) : [];
  const last = items.length - 1;

  const step = (c: Crumb, isLast: boolean) => {
    const text = <span className="crumb-text">{c.label}</span>;
    if (isLast) return c.render ?? <span className="crumb-here" aria-current={current} title={c.title ?? c.label}>{c.icon}{text}</span>;
    if (c.href && LinkAs) return <LinkAs href={c.href} className="crumb-step" title={c.title ?? c.label} scroll={false} {...c.props}>{c.icon}{text}</LinkAs>;
    if (c.href) return <a href={c.href} className="crumb-step" title={c.title ?? c.label} {...c.props}>{c.icon}{text}</a>;
    return <button type="button" className="crumb-step" title={c.title ?? c.label} onClick={c.onClick} {...c.props}>{c.icon}{text}</button>;
  };
  const go = (f: Crumb) => { if (f.onClick) f.onClick(); else if (f.href) (navigate ?? ((h: string) => window.location.assign(h)))(f.href); };

  return (
    <nav aria-label={label} className={className} style={style}>
      <ol className="crumbs crumbs-trail">
        {shown.map(({ c, i }, n) => (
          <React.Fragment key={`${i}-${c.label}`}>
            {fold && n === 1 && (
              <li>
                <ChevronRight size={13} aria-hidden className="crumb-sep" />
                <M.Root>
                  <M.Trigger asChild>
                    <button type="button" className="crumb-step" aria-label={`${folded.length} more: ${folded.map((f) => f.label).join(", ")}`} title={folded.map((f) => f.label).join(" / ")}><MoreHorizontal size={14} aria-hidden /></button>
                  </M.Trigger>
                  <M.Portal>
                    <M.Content className="menu" align="start" sideOffset={6}>
                      {folded.map((f, k) => <M.Item key={`${k}-${f.label}`} className="menu-item" onSelect={() => go(f)}>{f.icon}{f.label}</M.Item>)}
                    </M.Content>
                  </M.Portal>
                </M.Root>
              </li>
            )}
            <li>
              {i > 0 && <ChevronRight size={13} aria-hidden className="crumb-sep" />}
              {step(c, i === last)}
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}
