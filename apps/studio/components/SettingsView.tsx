"use client";

import { useState } from "react";
import { SegmentedControl, Tabs, TabPanel, useTheme, type Theme } from "@knitted/ui";
import { PageHeader } from "./AppShell";
import { StorageSettings } from "./StorageSettings";
import { RendererCard } from "./RendererCard";
import { ModelSettings } from "./ModelSettings";
import { VoiceSettings } from "./VoiceSettings";

// Each later phase fills in its own tab: Storage (2), Model (11), Voice (10).
// The tab exists now so the shape of Settings does not change under anyone.
export function SettingsView() {
  const [tab, setTab] = useState("appearance");
  const { theme, setTheme } = useTheme();
  return (
    <div style={{ padding: "var(--space-8)", maxWidth: 860 }}>
      <PageHeader eyebrow="Settings" title="Make it yours" />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "appearance", label: "Appearance" },
          { value: "storage", label: "Storage" },
          { value: "model", label: "Model" },
          { value: "voice", label: "Voice" },
          { value: "about", label: "About" },
        ]}
      >
        <div style={{ paddingTop: "var(--space-6)" }}>
          <TabPanel value="appearance">
            <h2 className="h3" style={{ marginBottom: "var(--space-2)" }}>Theme</h2>
            <p className="body-sm" style={{ color: "var(--ink-muted)", marginBottom: "var(--space-4)" }}>
              Day is the default. Night is easier on the eyes in a dark room. The work you make is never affected.
            </p>
            <SegmentedControl<Theme>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]}
            />
          </TabPanel>
          <TabPanel value="storage"><StorageSettings /></TabPanel>
          <TabPanel value="model"><ModelSettings /></TabPanel>
          <TabPanel value="voice"><VoiceSettings /></TabPanel>
          <TabPanel value="about">
            <p className="body">knitted.studio is open source under the MIT licence.</p>
            <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: "var(--space-2)" }}>Version {process.env.KNITTED_VERSION}</p>
            <RendererCard />
          </TabPanel>
        </div>
      </Tabs>
    </div>
  );
}
