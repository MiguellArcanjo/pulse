import { createContext, useContext, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import type { Accent } from "@morph/protocol";
import { accents, palettes, type Palette } from "./tokens";

export type Theme = {
  scheme: "dark" | "light";
  colors: Palette;
  accent: (typeof accents)[Accent];
};

const ThemeContext = createContext<Theme | null>(null);

/** Tema do sistema (claro/escuro) + destaque da ferramenta atual. */
export function ThemeProvider({ accent = "violet", children }: { accent?: Accent; children: ReactNode }) {
  const parent = useContext(ThemeContext);
  const system = useColorScheme() === "light" ? "light" : "dark";
  const scheme = parent?.scheme ?? system;
  const value: Theme = { scheme, colors: palettes[scheme], accent: accents[accent] };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("ThemeProvider ausente");
  return t;
}
