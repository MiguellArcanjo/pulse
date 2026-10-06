import type { Accent } from "@morph/protocol";

/**
 * Design System do Morph. A IA nunca escolhe cor nem tamanho: escolhe um nome de
 * destaque (`Accent`) e uma variante; os valores concretos vivem só aqui.
 * Referência visual: mockups do produto (escuro, superfícies translúcidas, roxo/azul).
 */

export type Palette = {
  background: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  danger: string;
  positive: string;
  overlay: string;
};

export const palettes: Record<"dark" | "light", Palette> = {
  dark: {
    background: "#07070A",
    surface: "rgba(255,255,255,0.055)",
    surfaceStrong: "rgba(255,255,255,0.09)",
    border: "rgba(255,255,255,0.08)",
    text: "#F5F5F7",
    textSecondary: "rgba(235,235,245,0.62)",
    textTertiary: "rgba(235,235,245,0.36)",
    danger: "#FF6B6B",
    positive: "#34D399",
    overlay: "rgba(0,0,0,0.5)",
  },
  light: {
    background: "#F4F4F7",
    surface: "rgba(255,255,255,0.85)",
    surfaceStrong: "#FFFFFF",
    border: "rgba(0,0,0,0.06)",
    text: "#0B0B0F",
    textSecondary: "rgba(60,60,67,0.7)",
    textTertiary: "rgba(60,60,67,0.4)",
    danger: "#E5484D",
    positive: "#0E9F6E",
    overlay: "rgba(0,0,0,0.25)",
  },
};

/** Cor principal de cada destaque e um tom suave para fundos. */
export const accents: Record<Accent, { main: string; soft: string; dark: string }> = {
  violet: { main: "#8B5CF6", soft: "rgba(139,92,246,0.18)", dark: "#4C1D95" },
  blue: { main: "#5B8DEF", soft: "rgba(91,141,239,0.18)", dark: "#1E3A8A" },
  teal: { main: "#2DD4BF", soft: "rgba(45,212,191,0.16)", dark: "#134E4A" },
  green: { main: "#34D399", soft: "rgba(52,211,153,0.16)", dark: "#14532D" },
  orange: { main: "#FB923C", soft: "rgba(251,146,60,0.16)", dark: "#7C2D12" },
  red: { main: "#F87171", soft: "rgba(248,113,113,0.16)", dark: "#7F1D1D" },
  pink: { main: "#F472B6", soft: "rgba(244,114,182,0.16)", dark: "#831843" },
  yellow: { main: "#FACC15", soft: "rgba(250,204,21,0.16)", dark: "#713F12" },
  gray: { main: "#A1A1AA", soft: "rgba(161,161,170,0.16)", dark: "#27272A" },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const type = {
  largeTitle: { fontSize: 32, fontWeight: "700", letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: "400" },
  callout: { fontSize: 15, fontWeight: "500" },
  footnote: { fontSize: 13, fontWeight: "400" },
  caption: { fontSize: 11, fontWeight: "500", letterSpacing: 0.2 },
  stat: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
} as const;

/** Margem lateral das telas. */
export const GUTTER = 20;
