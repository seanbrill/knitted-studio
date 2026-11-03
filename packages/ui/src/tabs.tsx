"use client";

import * as React from "react";
import * as T from "@radix-ui/react-tabs";

export function Tabs({ value, onValueChange, tabs, children }: {
  value: string; onValueChange: (v: string) => void;
  tabs: { value: string; label: string; count?: number }[]; children?: React.ReactNode;
}) {
  return (
    <T.Root value={value} onValueChange={onValueChange}>
      <T.List className="tabs-list" aria-label="Sections">
        {tabs.map((t) => (
          <T.Trigger key={t.value} value={t.value} className="tab">
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}
export const TabPanel = T.Content;
