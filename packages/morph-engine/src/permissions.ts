import type { Action, Changeset, OperationType, PermissionLevel } from "@morph/protocol";

/**
 * Nível de permissão de cada operação estrutural. Decidido aqui, nunca pela IA.
 * Tudo que tira algo da frente do usuário pede confirmação; nada apaga dados.
 */
export const OPERATION_LEVEL: Record<OperationType, PermissionLevel> = {
  CREATE_TOOL: "SAFE_ACTION",
  UPDATE_TOOL: "SAFE_ACTION",
  ARCHIVE_TOOL: "CONFIRM",
  CREATE_ENTITY: "SAFE_ACTION",
  ADD_FIELD: "SAFE_ACTION",
  UPDATE_FIELD: "SAFE_ACTION",
  ARCHIVE_FIELD: "CONFIRM",
  CREATE_SCREEN: "SAFE_ACTION",
  UPDATE_SCREEN: "SAFE_ACTION",
  ADD_COMPONENT: "SAFE_ACTION",
  UPDATE_COMPONENT: "SAFE_ACTION",
  MOVE_COMPONENT: "SAFE_ACTION",
  REMOVE_COMPONENT: "CONFIRM",
  CREATE_ACTION: "SAFE_ACTION",
  ADD_NAV_ITEM: "SAFE_ACTION",
  REMOVE_NAV_ITEM: "CONFIRM",
};

const ORDER: PermissionLevel[] = ["READ", "SAFE_ACTION", "CONFIRM", "CRITICAL"];

export function maxLevel(levels: Iterable<PermissionLevel>): PermissionLevel {
  let best: PermissionLevel = "READ";
  for (const l of levels) if (ORDER.indexOf(l) > ORDER.indexOf(best)) best = l;
  return best;
}

/** O nível de um changeset é o da operação mais sensível dele. */
export function changesetLevel(cs: Changeset): PermissionLevel {
  return maxLevel(cs.operations.map((op) => OPERATION_LEVEL[op.type]));
}

/** Nível das ações que o usuário dispara na interface gerada. */
export function actionLevel(action: Action): PermissionLevel {
  switch (action.kind) {
    case "navigate":
    case "go_back":
      return "READ";
    case "delete_record":
      return "CONFIRM";
  }
}

/** Criar ou editar um registro da própria ferramenta é de baixo risco. */
export const RECORD_WRITE_LEVEL: PermissionLevel = "SAFE_ACTION";
