"use client";

// Beside every message to the model: which one answers. Auto, or one model for everything. The
// same choice as Settings, Model; one that is answering now takes a new pick at its next step.

import { Select, Tip, useToast } from "@knitted/ui";
import { shortName, useModelChoice } from "@/lib/model-choice";

export function ModelPicker() {
  const { choice, choices, choose } = useModelChoice();
  const toast = useToast();
  if (!choice || !choices.length) return null;
  return (
    <Tip text={choice === "auto" ? "Auto starts each task on the least model it needs, and steps up if the task turns out harder. You can pick one model instead." : "This model answers everything. Auto would pick one for each task, to cost less."}>
      <span className="model-picker">
        <Select aria-label="Model" value={choice} onValueChange={(v) => { void choose(v).catch((e) => toast.problem((e as Error).message)); }}
          options={choices.map((c) => ({ value: c.id, label: c.label }))} shown={shortName(choice, choices)} />
      </span>
    </Tip>
  );
}
