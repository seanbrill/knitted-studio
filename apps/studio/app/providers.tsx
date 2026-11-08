"use client";

import { ThemeProvider, ToastProvider, TooltipProvider } from "@knitted/ui";
import { ModelDone } from "@/components/ModelDone";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>{children}<ModelDone /></ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
