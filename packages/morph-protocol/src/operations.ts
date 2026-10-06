import * as z from "zod";
import { Accent, Description, IconName, Id, Label } from "./common.ts";
import { Node } from "./components.ts";
import { Entity, Field, SelectOption } from "./entity.ts";
import { Action, Screen, Tool } from "./spec.ts";

/**
 * Operações: a única forma de mudar a AppSpec. É isto que a IA devolve (dentro de um
 * Changeset). Cada operação é validada; se uma falhar, nenhuma é aplicada.
 *
 * Não existe operação que apague dados do usuário: remover um campo é arquivá-lo.
 */
export const Operation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_TOOL"), tool: Tool }).strict(),
  z
    .object({
      type: z.literal("UPDATE_TOOL"),
      tool: Id,
      changes: z
        .object({
          name: Label.optional(),
          description: Description.optional(),
          icon: IconName.optional(),
          accent: Accent.optional(),
          home: Id.optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("ARCHIVE_TOOL"), tool: Id }).strict(),

  z.object({ type: z.literal("CREATE_ENTITY"), entity: Entity }).strict(),
  z.object({ type: z.literal("ADD_FIELD"), entity: Id, field: Field }).strict(),
  z
    .object({
      type: z.literal("UPDATE_FIELD"),
      entity: Id,
      field: Id,
      /** Só o que não muda o significado dos dados já gravados. Trocar o tipo não é permitido. */
      changes: z
        .object({
          label: Label.optional(),
          description: Description.optional(),
          required: z.boolean().optional(),
          unit: z.string().trim().min(1).max(12).optional(),
          /** Opções novas de um campo `select` (as existentes não podem sumir). */
          addOptions: z.array(SelectOption).min(1).max(20).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("ARCHIVE_FIELD"), entity: Id, field: Id }).strict(),

  z.object({ type: z.literal("CREATE_SCREEN"), screen: Screen }).strict(),
  z
    .object({
      type: z.literal("UPDATE_SCREEN"),
      screen: Id,
      changes: z.object({ title: Label.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ADD_COMPONENT"),
      screen: Id,
      /** Nó pai (`null` = raiz da tela). */
      parent: Id.nullable(),
      /** Posição entre os irmãos (omitido = no fim). */
      index: z.number().int().min(0).optional(),
      node: Node,
    })
    .strict(),
  /** Substitui um nó inteiro, mantendo o mesmo id (o Motion trata como "o mesmo" componente). */
  z.object({ type: z.literal("UPDATE_COMPONENT"), screen: Id, node: Node }).strict(),
  z
    .object({
      type: z.literal("MOVE_COMPONENT"),
      screen: Id,
      node: Id,
      parent: Id.nullable(),
      index: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ type: z.literal("REMOVE_COMPONENT"), screen: Id, node: Id }).strict(),

  z.object({ type: z.literal("CREATE_ACTION"), action: Action }).strict(),

  z
    .object({ type: z.literal("ADD_NAV_ITEM"), tool: Id, index: z.number().int().min(0).optional() })
    .strict(),
  z.object({ type: z.literal("REMOVE_NAV_ITEM"), tool: Id }).strict(),
]);
export type Operation = z.infer<typeof Operation>;
export type OperationType = Operation["type"];

export const ChangesetIntent = z.enum(["create_tool", "modify_tool", "reorganize", "archive"]);

/** Um pacote de operações que vale como uma única mudança (uma versão nova, um evento no Evolution). */
export const Changeset = z
  .object({
    intent: ChangesetIntent,
    /** Ferramenta principal afetada (`null` quando a mudança é do app todo). */
    target: Id.nullable(),
    /** Frase curta para o usuário: o que muda e por quê. */
    summary: Description,
    operations: z.array(Operation).min(1).max(100),
  })
  .strict();
export type Changeset = z.infer<typeof Changeset>;
