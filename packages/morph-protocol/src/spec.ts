import * as z from "zod";
import { Accent, Description, IconName, Id, Label } from "./common.ts";
import { Node } from "./components.ts";
import { Entity } from "./entity.ts";
import { Operand } from "./data.ts";

/**
 * Ações que os componentes podem disparar. O nível de permissão de cada tipo é fixo
 * e decidido pelo engine (`actionLevel`), não pela IA.
 */
export const Action = z.discriminatedUnion("kind", [
  z
    .object({
      id: Id,
      toolId: Id,
      kind: z.literal("navigate"),
      screen: Id,
      /** Valor de cada parâmetro da tela de destino, avaliado onde a ação é disparada. */
      params: z.record(Id, Operand).optional(),
    })
    .strict(),
  z.object({ id: Id, toolId: Id, kind: z.literal("go_back") }).strict(),
  z
    .object({
      id: Id,
      toolId: Id,
      kind: z.literal("delete_record"),
      entity: Id,
      record: Operand,
    })
    .strict(),
]);
export type Action = z.infer<typeof Action>;
export type ActionKind = Action["kind"];

export const ScreenParam = z.object({ id: Id, entity: Id }).strict();

export const Screen = z
  .object({
    id: Id,
    toolId: Id,
    title: Label,
    /** Parâmetros que a tela recebe ao ser aberta (sempre ids de registros). */
    params: z.array(ScreenParam).max(4).optional(),
    /** Se a tela mostra um registro, qual: o item do contexto da tela inteira. */
    record: z.object({ entity: Id, param: Id }).strict().optional(),
    root: z.array(Node).min(1).max(40),
  })
  .strict();
export type Screen = z.infer<typeof Screen>;

export const ToolStatus = z.enum(["active", "archived"]);

export const Tool = z
  .object({
    id: Id,
    name: Label,
    description: Description.optional(),
    icon: IconName,
    accent: Accent,
    /** Tela inicial da ferramenta. */
    home: Id,
    status: ToolStatus,
  })
  .strict();
export type Tool = z.infer<typeof Tool>;

/** O app inteiro de um usuário. Cada mudança aplicada gera uma nova `version`. */
export const AppSpec = z
  .object({
    protocol: z.literal(1),
    version: z.number().int().min(0),
    tools: z.array(Tool).max(100),
    entities: z.array(Entity).max(300),
    screens: z.array(Screen).max(500),
    actions: z.array(Action).max(1000),
    /** Ferramentas na navegação principal, em ordem. */
    navigation: z.array(Id).max(20),
    /** Reservados para fases futuras: por enquanto precisam estar vazios. */
    automations: z.array(z.never()).max(0),
    skills: z.array(z.never()).max(0),
  })
  .strict();
export type AppSpec = z.infer<typeof AppSpec>;

/** O app de quem acabou de instalar: vazio. */
export function emptySpec(): AppSpec {
  return {
    protocol: 1,
    version: 0,
    tools: [],
    entities: [],
    screens: [],
    actions: [],
    navigation: [],
    automations: [],
    skills: [],
  };
}
