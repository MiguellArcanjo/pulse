import { AppSpec, Changeset, childrenOf, type Node, type Operation, type PermissionLevel, type Screen } from "@morph/protocol";
import { fromZod, issue, type Issue } from "./issues.ts";
import { changesetLevel } from "./permissions.ts";
import { validateSpec } from "./validate.ts";

export type ApplyStage = "schema" | "operations" | "semantic";

export type ApplyResult =
  | { ok: true; spec: AppSpec; changeset: Changeset; level: PermissionLevel }
  | { ok: false; stage: ApplyStage; issues: Issue[] };

export type RestoreResult = { ok: true; spec: AppSpec } | { ok: false; issues: Issue[] };

/**
 * Aplica um changeset sobre a spec atual. Tudo ou nada: trabalha numa cópia e só
 * devolve a spec nova se o schema, todas as operações e a validação semântica
 * passarem. A spec recebida nunca é alterada.
 *
 * `input` é `unknown` de propósito: pode ter vindo direto de uma IA.
 */
export function applyChangeset(current: AppSpec, input: unknown): ApplyResult {
  const parsed = Changeset.safeParse(input);
  if (!parsed.success) return { ok: false, stage: "schema", issues: fromZod(parsed.error) };
  const changeset = parsed.data;

  const draft = structuredClone(current);
  const opIssues: Issue[] = [];
  changeset.operations.forEach((op, i) => {
    for (const iss of applyOperation(draft, op)) opIssues.push({ ...iss, path: ["operations", i, ...iss.path] });
  });
  if (opIssues.length > 0) return { ok: false, stage: "operations", issues: opIssues };

  draft.version = current.version + 1;
  const shape = AppSpec.safeParse(draft);
  if (!shape.success) return { ok: false, stage: "schema", issues: fromZod(shape.error, ["spec"]) };

  const semantic = validateSpec(shape.data);
  if (semantic.length > 0) return { ok: false, stage: "semantic", issues: semantic.map((i) => ({ ...i, path: ["spec", ...i.path] })) };

  return { ok: true, spec: shape.data, changeset, level: changesetLevel(changeset) };
}

/**
 * Desfazer: gera uma versão nova com o conteúdo de uma versão anterior.
 * O histórico nunca é reescrito; desfazer também é uma mudança registrada.
 */
export function restoreVersion(current: AppSpec, previous: AppSpec): RestoreResult {
  const restored = { ...structuredClone(previous), version: current.version + 1 };
  const issues = validateSpec(restored);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec: restored };
}

// ---------------------------------------------------------------------------

function applyOperation(spec: AppSpec, op: Operation): Issue[] {
  switch (op.type) {
    case "CREATE_TOOL":
      return insertUnique(spec.tools, op.tool, "ferramenta", ["tool", "id"]);
    case "UPDATE_TOOL": {
      const tool = spec.tools.find((t) => t.id === op.tool);
      if (!tool) return [notFound("ferramenta", op.tool, ["tool"])];
      Object.assign(tool, defined(op.changes));
      return [];
    }
    case "ARCHIVE_TOOL": {
      const tool = spec.tools.find((t) => t.id === op.tool);
      if (!tool) return [notFound("ferramenta", op.tool, ["tool"])];
      tool.status = "archived";
      spec.navigation = spec.navigation.filter((id) => id !== op.tool);
      return [];
    }

    case "CREATE_ENTITY":
      return insertUnique(spec.entities, op.entity, "entidade", ["entity", "id"]);
    case "ADD_FIELD": {
      const entity = spec.entities.find((e) => e.id === op.entity);
      if (!entity) return [notFound("entidade", op.entity, ["entity"])];
      const existing = entity.fields.find((f) => f.id === op.field.id);
      if (existing)
        return [
          existing.status === "archived"
            ? issue("id_reused", `o id "${op.field.id}" pertenceu a um campo arquivado; use outro id`, ["field", "id"])
            : issue("duplicate_id", `campo "${op.field.id}" já existe`, ["field", "id"]),
        ];
      if (op.field.required)
        return [issue("invalid_structure", "campo novo não pode ser obrigatório: registros antigos não têm valor", ["field", "required"])];
      entity.fields.push(op.field);
      return [];
    }
    case "UPDATE_FIELD": {
      const entity = spec.entities.find((e) => e.id === op.entity);
      if (!entity) return [notFound("entidade", op.entity, ["entity"])];
      const field = entity.fields.find((f) => f.id === op.field);
      if (!field) return [notFound("campo", op.field, ["field"])];
      if (field.status === "archived") return [issue("archived", `campo "${op.field}" está arquivado`, ["field"])];
      const { addOptions, unit, required, ...rest } = op.changes;
      const out: Issue[] = [];
      if (required === true && !field.required)
        out.push(issue("invalid_structure", "tornar obrigatório quebraria registros antigos", ["changes", "required"]));
      if (unit !== undefined && !["number", "integer", "computed"].includes(field.type))
        out.push(issue("type_mismatch", `campo do tipo ${field.type} não tem unidade`, ["changes", "unit"]));
      if (addOptions && field.type !== "select")
        out.push(issue("type_mismatch", `campo do tipo ${field.type} não tem opções`, ["changes", "addOptions"]));
      if (out.length > 0) return out;
      Object.assign(field, defined(rest));
      if (required === false) field.required = false;
      if (unit !== undefined && (field.type === "number" || field.type === "integer" || field.type === "computed")) field.unit = unit;
      if (addOptions && field.type === "select") field.options.push(...addOptions);
      return [];
    }
    case "ARCHIVE_FIELD": {
      const entity = spec.entities.find((e) => e.id === op.entity);
      if (!entity) return [notFound("entidade", op.entity, ["entity"])];
      const field = entity.fields.find((f) => f.id === op.field);
      if (!field) return [notFound("campo", op.field, ["field"])];
      if (field.status === "archived") return [issue("archived", `campo "${op.field}" já está arquivado`, ["field"])];
      field.status = "archived";
      return [];
    }

    case "CREATE_SCREEN":
      return insertUnique(spec.screens, op.screen, "tela", ["screen", "id"]);
    case "UPDATE_SCREEN": {
      const screen = spec.screens.find((s) => s.id === op.screen);
      if (!screen) return [notFound("tela", op.screen, ["screen"])];
      Object.assign(screen, defined(op.changes));
      return [];
    }
    case "ADD_COMPONENT": {
      const screen = spec.screens.find((s) => s.id === op.screen);
      if (!screen) return [notFound("tela", op.screen, ["screen"])];
      const siblings = childList(screen, op.parent);
      if (!siblings) return [notFound("componente pai", op.parent ?? "", ["parent"])];
      return insertAt(siblings, op.node, op.index);
    }
    case "UPDATE_COMPONENT": {
      const screen = spec.screens.find((s) => s.id === op.screen);
      if (!screen) return [notFound("tela", op.screen, ["screen"])];
      const found = locate(screen.root, op.node.id);
      if (!found) return [notFound("componente", op.node.id, ["node", "id"])];
      found.siblings[found.index] = op.node;
      return [];
    }
    case "MOVE_COMPONENT": {
      const screen = spec.screens.find((s) => s.id === op.screen);
      if (!screen) return [notFound("tela", op.screen, ["screen"])];
      const found = locate(screen.root, op.node);
      if (!found) return [notFound("componente", op.node, ["node"])];
      const node = found.siblings[found.index] as Node;
      if (op.parent !== null && (op.parent === node.id || locate(childrenOf(node) as Node[], op.parent)))
        return [issue("invalid_structure", "não dá para mover um componente para dentro dele mesmo", ["parent"])];
      found.siblings.splice(found.index, 1);
      const target = childList(screen, op.parent);
      if (!target) return [notFound("componente pai", op.parent ?? "", ["parent"])];
      return insertAt(target, node, op.index);
    }
    case "REMOVE_COMPONENT": {
      const screen = spec.screens.find((s) => s.id === op.screen);
      if (!screen) return [notFound("tela", op.screen, ["screen"])];
      const found = locate(screen.root, op.node);
      if (!found) return [notFound("componente", op.node, ["node"])];
      found.siblings.splice(found.index, 1);
      return [];
    }

    case "CREATE_ACTION":
      return insertUnique(spec.actions, op.action, "ação", ["action", "id"]);

    case "ADD_NAV_ITEM": {
      if (!spec.tools.some((t) => t.id === op.tool)) return [notFound("ferramenta", op.tool, ["tool"])];
      if (spec.navigation.includes(op.tool)) return [issue("duplicate_id", `"${op.tool}" já está na navegação`, ["tool"])];
      const index = op.index ?? spec.navigation.length;
      if (index > spec.navigation.length) return [issue("invalid_structure", "posição fora da lista", ["index"])];
      spec.navigation.splice(index, 0, op.tool);
      return [];
    }
    case "REMOVE_NAV_ITEM": {
      if (!spec.navigation.includes(op.tool)) return [notFound("item de navegação", op.tool, ["tool"])];
      spec.navigation = spec.navigation.filter((id) => id !== op.tool);
      return [];
    }
  }
}

function notFound(what: string, id: string, path: (string | number)[]): Issue {
  return issue("not_found", `${what} "${id}" não existe`, path);
}

function insertUnique<T extends { id: string }>(list: T[], item: T, what: string, path: (string | number)[]): Issue[] {
  if (list.some((x) => x.id === item.id)) return [issue("duplicate_id", `${what} "${item.id}" já existe`, path)];
  list.push(item);
  return [];
}

function insertAt(list: Node[], node: Node, index: number | undefined): Issue[] {
  const at = index ?? list.length;
  if (at > list.length) return [issue("invalid_structure", `posição ${at} fora da lista (${list.length} itens)`, ["index"])];
  list.splice(at, 0, node);
  return [];
}

/** Lista de filhos onde inserir: a raiz da tela ou os filhos de um nó que aceita filhos. */
function childList(screen: Screen, parent: string | null): Node[] | undefined {
  if (parent === null) return screen.root;
  const found = locate(screen.root, parent);
  if (!found) return undefined;
  const node = found.siblings[found.index] as Node;
  return "children" in node ? node.children : undefined;
}

function locate(nodes: Node[], id: string): { siblings: Node[]; index: number } | undefined {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Node;
    if (n.id === id) return { siblings: nodes, index: i };
    if ("children" in n) {
      const inner = locate(n.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Remove chaves `undefined` para não apagar propriedades com Object.assign. */
function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
