"use client";

import * as React from "react";
import * as T from "@radix-ui/react-tabs";

export function Tabs({ value, onValueChange, tabs, children, end }: {
  value: string; onValueChange: (v: string) => void;
  tabs: { value: string; label: string; count?: number }[]; children?: React.ReactNode;
  /** Beside the tabs, at the end of their bar: a close button, say. */
  end?: React.ReactNode;
}) {
  const list = (
    <T.List className="tabs-list" aria-label="Sections">
      {tabs.map((t) => (
        <T.Trigger key={t.value} value={t.value} className="tab">
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </T.Trigger>
      ))}
    </T.List>
  );
  return (
    <T.Root value={value} onValueChange={onValueChange}>
      {end ? <div className="tabs-bar">{list}{end}</div> : list}
      {children}
    </T.Root>
  );
}
export const TabPanel = T.Content;
