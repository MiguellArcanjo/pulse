import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { IconName } from "@morph/protocol";

type GlyphName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Nome semântico do protocolo → desenho da biblioteca de ícones. */
const GLYPHS: Record<IconName, GlyphName> = {
  dumbbell: "dumbbell",
  run: "run",
  heart: "heart-outline",
  flame: "fire",
  trophy: "trophy-outline",
  target: "target",
  timer: "timer-outline",
  clock: "clock-outline",
  calendar: "calendar-blank-outline",
  chart: "chart-bar",
  list: "format-list-bulleted",
  check: "check",
  plus: "plus",
  play: "play",
  star: "star-outline",
  flag: "flag-outline",
  tag: "tag-outline",
  note: "note-text-outline",
  book: "book-open-variant",
  folder: "folder-outline",
  code: "code-tags",
  briefcase: "briefcase-outline",
  home: "home-outline",
  plane: "airplane",
  map: "map-outline",
  cart: "cart-outline",
  wallet: "wallet-outline",
  food: "food-apple-outline",
  water: "water-outline",
  sleep: "power-sleep",
  music: "music-note",
  film: "filmstrip",
  tv: "television",
  person: "account-outline",
  people: "account-multiple-outline",
  bell: "bell-outline",
  sun: "white-balance-sunny",
  moon: "weather-night",
  cloud: "weather-cloudy",
  bolt: "lightning-bolt-outline",
  leaf: "leaf",
  paw: "paw",
  car: "car-outline",
  gift: "gift-outline",
  school: "school-outline",
};

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  return <MaterialCommunityIcons name={GLYPHS[name]} size={size} color={color} />;
}

/** Ícones da interface fixa do app (fora do protocolo). */
export function UiIcon({ name, size = 22, color }: { name: GlyphName; size?: number; color: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}
