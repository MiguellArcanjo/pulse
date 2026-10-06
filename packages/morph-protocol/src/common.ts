import * as z from "zod";

/**
 * Identificador estável de qualquer peça da spec (ferramenta, entidade, campo, tela, nó,
 * ação). É escolhido por quem cria a peça (a IA) e nunca muda depois: os dados do usuário
 * são gravados pelo id do campo, e o Motion Engine reconhece um componente pelo id.
 */
export const Id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, "use só letras minúsculas, números e _ (começando por letra)");
export type Id = z.infer<typeof Id>;

/** Texto exibido ao usuário (título, rótulo). */
export const Label = z.string().trim().min(1).max(80);

/** Texto mais longo (subtítulo, descrição, resumo de mudança). */
export const Description = z.string().trim().min(1).max(280);

/**
 * Níveis de permissão. Quem decide o nível de uma operação é o sistema
 * (morph-engine), nunca a IA.
 */
export const PermissionLevel = z.enum(["READ", "SAFE_ACTION", "CONFIRM", "CRITICAL"]);
export type PermissionLevel = z.infer<typeof PermissionLevel>;

/**
 * Cores de destaque disponíveis. A IA escolhe um nome; o Design System decide o tom
 * exato no tema claro e no escuro.
 */
export const Accent = z.enum([
  "blue",
  "violet",
  "teal",
  "green",
  "orange",
  "red",
  "pink",
  "yellow",
  "gray",
]);
export type Accent = z.infer<typeof Accent>;

/**
 * Ícones disponíveis. Nomes semânticos (não de uma biblioteca): o app traduz cada um
 * para o desenho que usa. Sem marcas.
 */
export const IconName = z.enum([
  "dumbbell",
  "run",
  "heart",
  "flame",
  "trophy",
  "target",
  "timer",
  "clock",
  "calendar",
  "chart",
  "list",
  "check",
  "plus",
  "play",
  "star",
  "flag",
  "tag",
  "note",
  "book",
  "folder",
  "code",
  "briefcase",
  "home",
  "plane",
  "map",
  "cart",
  "wallet",
  "food",
  "water",
  "sleep",
  "music",
  "film",
  "tv",
  "person",
  "people",
  "bell",
  "sun",
  "moon",
  "cloud",
  "bolt",
  "leaf",
  "paw",
  "car",
  "gift",
  "school",
]);
export type IconName = z.infer<typeof IconName>;
