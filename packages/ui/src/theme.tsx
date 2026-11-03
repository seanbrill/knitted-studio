"use client";

import * as React from "react";

export type Theme = "day" | "night";
const KEY = "knitted.theme";

/**
 * Runs before first paint so the page never flashes the wrong theme. Day is the
 * default; Night is something the user chose, so only an explicit stored value
 * (never the OS) switches it.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="night"||t==="day")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const Ctx = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "day", setTheme: () => {} });
export const useTheme = () => React.useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("day");
  React.useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setThemeState(current === "night" ? "night" : "day");
  }, []);
  const setTheme = React.useCallback((t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch {}
    setThemeState(t);
  }, []);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
