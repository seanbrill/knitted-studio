"use client";

import { ThemeProvider, ToastProvider, TooltipProvider } from "@knitted/ui";
import { LoadBar } from "@/components/LoadBar";
import { ModelDone } from "@/components/ModelDone";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider><LoadBar />{children}<ModelDone /></ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
