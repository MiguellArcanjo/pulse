import {
  DATE_FIELD_TYPES,
  NUMERIC_FIELD_TYPES,
  SYSTEM_FIELDS,
  childrenOf,
  type Action,
  type AggregateFn,
  type AppSpec,
  type Entity,
  type Field,
  type FieldType,
  type Formula,
  type Node,
  type Operand,
  type Query,
  type Screen,
  type Value,
} from "@morph/protocol";
import { issue, type Issue } from "./issues.ts";

/**
 * Validação semântica: tudo que o schema (Zod) não consegue ver sozinho.
 * Ids que existem, tipos que combinam, campos arquivados que ainda estão em uso,
 * componentes fora do lugar. Uma spec só é salva se esta lista vier vazia.
 */
export function validateSpec(spec: AppSpec): Issue[] {
  return new Validator(spec).run();
}

const MAX_DEPTH = 12;
const MAX_FORMULA_DEPTH = 4;

/** Tipo efetivo de um campo de sistema. */
const SYSTEM_FIELD_TYPES: Record<string, FieldType> = { id: "reference", created_at: "datetime", updated_at: "datetime" };

type Path = (string | number)[];

/** O que está disponível onde um nó é renderizado. */
type Scope = {
  screen: Screen;
  /** Entidade do "item" do contexto (linha da lista, registro da tela...). */
  item?: string | undefined;
  /** Entidade do formulário em volta, se houver. */
  form?: string | undefined;
  /** Entidade editável direto na tela (repeat com edição inline). */
  inlineEdit?: string | undefined;
  depth: number;
};

class Validator {
  private readonly issues: Issue[] = [];
  private readonly tools = new Map<string, AppSpec["tools"][number]>();
  private readonly entities = new Map<string, Entity>();
  private readonly screens = new Map<string, Screen>();
  private readonly actions = new Map<string, Action>();

  private readonly spec: AppSpec;

  constructor(spec: AppSpec) {
    this.spec = spec;
  }

  run(): Issue[] {
    const s = this.spec;
    this.index(s.tools, this.tools, "tools");
    this.index(s.entities, this.entities, "entities");
    this.index(s.screens, this.screens, "screens");
    this.index(s.actions, this.actions, "actions");

    s.tools.forEach((t, i) => this.checkTool(t, ["tools", i]));
    s.entities.forEach((e, i) => this.checkEntity(e, ["entities", i]));
    s.actions.forEach((a, i) => this.checkAction(a, ["actions", i]));
    s.screens.forEach((sc, i) => this.checkScreen(sc, ["screens", i]));
    this.checkNavigation();
    return this.issues;
  }

  private add(code: Issue["code"], message: string, path: Path) {
    this.issues.push(issue(code, message, path));
  }

  private index<T extends { id: string }>(items: T[], map: Map<string, T>, key: string) {
    items.forEach((item, i) => {
      if (map.has(item.id)) this.add("duplicate_id", `id "${item.id}" repetido em ${key}`, [key, i, "id"]);
      else map.set(item.id, item);
    });
  }

  // ---------- ferramentas, navegação ----------

  private checkTool(tool: AppSpec["tools"][number], path: Path) {
    const home = this.screens.get(tool.home);
    if (!home) this.add("not_found", `tela inicial "${tool.home}" não existe`, [...path, "home"]);
    else if (home.toolId !== tool.id)
      this.add("invalid_structure", `tela inicial "${tool.home}" pertence a outra ferramenta`, [...path, "home"]);
  }

  private checkNavigation() {
    const seen = new Set<string>();
    this.spec.navigation.forEach((id, i) => {
      const path = ["navigation", i];
      const tool = this.tools.get(id);
      if (!tool) this.add("not_found", `ferramenta "${id}" não existe`, path);
      else if (tool.status === "archived") this.add("archived", `ferramenta "${id}" está arquivada`, path);
      if (seen.has(id)) this.add("duplicate_id", `ferramenta "${id}" aparece duas vezes na navegação`, path);
      seen.add(id);
    });
  }

  // ---------- entidades e campos ----------

  private checkEntity(entity: Entity, path: Path) {
    if (!this.tools.has(entity.toolId)) this.add("not_found", `ferramenta "${entity.toolId}" não existe`, [...path, "toolId"]);

    const ids = new Set<string>();
    entity.fields.forEach((f, i) => {
      const fp = [...path, "fields", i];
      if ((SYSTEM_FIELDS as readonly string[]).includes(f.id))
        this.add("reserved_id", `"${f.id}" é um campo do sistema`, [...fp, "id"]);
      if (ids.has(f.id)) this.add("duplicate_id", `campo "${f.id}" repetido`, [...fp, "id"]);
      ids.add(f.id);
      this.checkField(entity, f, fp);
    });

    const title = entity.fields.find((f) => f.id === entity.titleField);
    if (!title) this.add("not_found", `campo de título "${entity.titleField}" não existe`, [...path, "titleField"]);
    else if (title.status === "archived")
      this.add("archived", `campo de título "${entity.titleField}" está arquivado`, [...path, "titleField"]);
    else if (title.type === "computed" || title.type === "long_text")
      this.add("type_mismatch", `campo de título não pode ser do tipo ${title.type}`, [...path, "titleField"]);
  }

  private checkField(entity: Entity, field: Field, path: Path) {
    switch (field.type) {
      case "number":
      case "integer":
        if (field.min !== undefined && field.max !== undefined && field.min > field.max)
          this.add("invalid_structure", "mínimo maior que o máximo", path);
        break;
      case "select": {
        const values = new Set<string>();
        field.options.forEach((o, i) => {
          if (values.has(o.value)) this.add("duplicate_id", `opção "${o.value}" repetida`, [...path, "options", i]);
          values.add(o.value);
        });
        break;
      }
      case "reference":
        if (!this.entities.has(field.entity))
          this.add("not_found", `entidade "${field.entity}" não existe`, [...path, "entity"]);
        break;
      case "computed":
        if (field.status === "active") this.checkFormula(entity, field.formula, [...path, "formula"], 1);
        break;
      default:
        break;
    }
  }

  private checkFormula(entity: Entity, f: Formula, path: Path, depth: number) {
    if (depth > MAX_FORMULA_DEPTH) {
      this.add("limit", `fórmula com mais de ${MAX_FORMULA_DEPTH} níveis`, path);
      return;
    }
    if (f.op === "const") return;
    if (f.op === "field") {
      const target = entity.fields.find((x) => x.id === f.field);
      if (!target) this.add("not_found", `campo "${f.field}" não existe`, [...path, "field"]);
      else if (target.status === "archived") this.add("archived", `campo "${f.field}" está arquivado`, [...path, "field"]);
      else if (!["number", "integer", "duration"].includes(target.type))
        this.add("type_mismatch", `fórmula só usa campos numéricos digitados ("${f.field}" é ${target.type})`, [...path, "field"]);
      return;
    }
    f.args.forEach((a, i) => this.checkFormula(entity, a, [...path, "args", i], depth + 1));
  }

  /** Tipo de um campo ativo (ou de sistema); registra problema e devolve undefined se não der. */
  private fieldType(entityId: string, fieldId: string, path: Path): FieldType | undefined {
    const system = SYSTEM_FIELD_TYPES[fieldId];
    if (system) return system;
    const entity = this.entities.get(entityId);
    if (!entity) return undefined; // a entidade inexistente já foi reportada
    const field = entity.fields.find((f) => f.id === fieldId);
    if (!field) {
      this.add("not_found", `campo "${fieldId}" não existe em "${entityId}"`, path);
      return undefined;
    }
    if (field.status === "archived") {
      this.add("archived", `campo "${fieldId}" de "${entityId}" está arquivado`, path);
      return undefined;
    }
    return field.type;
  }

  private writableField(entityId: string, fieldId: string, path: Path): Field | undefined {
    const entity = this.entities.get(entityId);
    const field = entity?.fields.find((f) => f.id === fieldId);
    if (!field) {
      this.add("not_found", `campo "${fieldId}" não existe em "${entityId}"`, path);
      return undefined;
    }
    if (field.status === "archived") {
      this.add("archived", `campo "${fieldId}" de "${entityId}" está arquivado`, path);
      return undefined;
    }
    if (field.type === "computed") {
      this.add("type_mismatch", `campo "${fieldId}" é calculado e não pode ser editado`, path);
      return undefined;
    }
    return field;
  }

  // ---------- ações ----------

  private checkAction(action: Action, path: Path) {
    if (!this.tools.has(action.toolId)) this.add("not_found", `ferramenta "${action.toolId}" não existe`, [...path, "toolId"]);
    switch (action.kind) {
      case "navigate": {
        const target = this.screens.get(action.screen);
        if (!target) {
          this.add("not_found", `tela "${action.screen}" não existe`, [...path, "screen"]);
          break;
        }
        const expected = new Set((target.params ?? []).map((p) => p.id));
        const given = Object.keys(action.params ?? {});
        for (const p of given)
          if (!expected.has(p)) this.add("not_found", `tela "${action.screen}" não tem o parâmetro "${p}"`, [...path, "params", p]);
        for (const p of expected)
          if (!given.includes(p)) this.add("invalid_structure", `falta o parâmetro "${p}" da tela "${action.screen}"`, [...path, "params"]);
        break;
      }
      case "delete_record":
        if (!this.entities.has(action.entity)) this.add("not_found", `entidade "${action.entity}" não existe`, [...path, "entity"]);
        break;
      case "go_back":
        break;
    }
  }

  /** Confere se a ação pode ser disparada neste lugar (operandos que dependem do contexto). */
  private checkActionUse(id: string, scope: Scope, path: Path) {
    const action = this.actions.get(id);
    if (!action) {
      this.add("not_found", `ação "${id}" não existe`, path);
      return;
    }
    if (action.kind === "navigate") {
      const target = this.screens.get(action.screen);
      for (const [param, operand] of Object.entries(action.params ?? {})) {
        this.checkOperand(operand, scope, path);
        const expected = target?.params?.find((p) => p.id === param)?.entity;
        const actual = this.operandEntity(operand, scope);
        if (expected && actual && expected !== actual)
          this.add("type_mismatch", `ação "${id}": parâmetro "${param}" espera "${expected}", recebe "${actual}"`, path);
      }
    } else if (action.kind === "delete_record") {
      this.checkOperand(action.record, scope, path);
      const actual = this.operandEntity(action.record, scope);
      if (actual && actual !== action.entity)
        this.add("type_mismatch", `ação "${id}" apaga "${action.entity}", mas recebe "${actual}"`, path);
    }
  }

  /** Entidade do registro que um operando identifica, quando dá para saber. */
  private operandEntity(op: Operand, scope: Scope): string | undefined {
    if (op.kind === "item_id") return scope.item;
    if (op.kind === "param") return scope.screen.params?.find((p) => p.id === op.param)?.entity;
    if (op.kind === "item_field" && scope.item) {
      const f = this.entities.get(scope.item)?.fields.find((x) => x.id === op.field);
      return f?.type === "reference" ? f.entity : undefined;
    }
    return undefined;
  }

  // ---------- telas e componentes ----------

  private checkScreen(screen: Screen, path: Path) {
    if (!this.tools.has(screen.toolId)) this.add("not_found", `ferramenta "${screen.toolId}" não existe`, [...path, "toolId"]);

    const params = new Set<string>();
    (screen.params ?? []).forEach((p, i) => {
      if (params.has(p.id)) this.add("duplicate_id", `parâmetro "${p.id}" repetido`, [...path, "params", i]);
      params.add(p.id);
      if (!this.entities.has(p.entity)) this.add("not_found", `entidade "${p.entity}" não existe`, [...path, "params", i, "entity"]);
    });
    if (screen.record) {
      const p = screen.params?.find((x) => x.id === screen.record?.param);
      if (!p) this.add("not_found", `parâmetro "${screen.record.param}" não existe`, [...path, "record", "param"]);
      else if (p.entity !== screen.record.entity)
        this.add("type_mismatch", `parâmetro "${p.id}" é de "${p.entity}", não de "${screen.record.entity}"`, [...path, "record"]);
    }

    const nodeIds = new Set<string>();
    const scope: Scope = { screen, item: screen.record?.entity, depth: 1 };
    screen.root.forEach((n, i) => this.checkNode(n, scope, [...path, "root", i], nodeIds));
  }

  private checkNode(node: Node, scope: Scope, path: Path, ids: Set<string>) {
    if (ids.has(node.id)) this.add("duplicate_id", `componente "${node.id}" repetido na tela`, [...path, "id"]);
    ids.add(node.id);
    if (scope.depth > MAX_DEPTH) {
      this.add("limit", `componentes com mais de ${MAX_DEPTH} níveis`, path);
      return;
    }
    const inner: Scope = { ...scope, depth: scope.depth + 1 };
    const kids = (s: Scope) => childrenOf(node).forEach((c, i) => this.checkNode(c, s, [...path, "children", i], ids));

    switch (node.type) {
      case "stack":
      case "row":
        kids(inner);
        break;
      case "section":
      case "card":
        if (node.action) this.checkActionUse(node.action, scope, [...path, "action"]);
        kids(inner);
        break;
      case "header":
        this.checkValue(node.title, scope, [...path, "title"]);
        if (node.subtitle) this.checkValue(node.subtitle, scope, [...path, "subtitle"]);
        if (node.action) this.checkActionUse(node.action, scope, [...path, "action"]);
        break;
      case "hero_card": {
        const own = node.query ? this.checkQuery(node.query, scope, [...path, "query"]) : undefined;
        const s: Scope = node.query ? { ...scope, item: own } : scope;
        this.checkValue(node.title, s, [...path, "title"]);
        if (node.subtitle) this.checkValue(node.subtitle, s, [...path, "subtitle"]);
        if (node.meta) this.checkValue(node.meta, s, [...path, "meta"]);
        if (node.action) this.checkActionUse(node.action, s, [...path, "action"]);
        if (node.empty?.action) this.checkActionUse(node.empty.action, scope, [...path, "empty", "action"]);
        break;
      }
      case "heading":
      case "text":
        this.checkValue(node.text, scope, [...path, "text"]);
        break;
      case "stat":
        this.checkValue(node.value, scope, [...path, "value"]);
        break;
      case "badge":
        this.checkValue(node.text, scope, [...path, "text"]);
        break;
      case "progress":
        this.checkValue(node.value, scope, [...path, "value"]);
        this.checkValue(node.max, scope, [...path, "max"]);
        break;
      case "chart": {
        const entity = this.checkQuery(node.query, scope, [...path, "query"]);
        if (entity) {
          const t = this.fieldType(entity, node.groupBy.field, [...path, "groupBy", "field"]);
          if (t && !DATE_FIELD_TYPES.includes(t))
            this.add("type_mismatch", `gráfico agrupa por data; "${node.groupBy.field}" é ${t}`, [...path, "groupBy", "field"]);
          this.checkAggregate(entity, node.measure.fn, node.measure.field, [...path, "measure"]);
        }
        break;
      }
      case "list": {
        const entity = this.checkQuery(node.query, scope, [...path, "query"]);
        const s: Scope = { ...inner, item: entity };
        this.checkValue(node.item.title, s, [...path, "item", "title"]);
        if (node.item.subtitle) this.checkValue(node.item.subtitle, s, [...path, "item", "subtitle"]);
        if (node.item.trailing) this.checkValue(node.item.trailing, s, [...path, "item", "trailing"]);
        if (node.action) this.checkActionUse(node.action, s, [...path, "action"]);
        break;
      }
      case "repeat": {
        const entity = this.checkQuery(node.query, scope, [...path, "query"]);
        kids({ ...inner, item: entity, form: undefined, inlineEdit: node.inlineEdit ? entity : undefined });
        break;
      }
      case "empty_state":
        if (node.action) this.checkActionUse(node.action, scope, [...path, "action"]);
        break;
      case "button":
        this.checkActionUse(node.action, scope, [...path, "action"]);
        break;
      case "divider":
        break;
      case "form":
        this.checkForm(node, scope, inner, path, ids);
        break;
      case "field_input": {
        const target = scope.form ?? scope.inlineEdit;
        if (!target) {
          this.add("out_of_scope", "campo de entrada fora de um formulário ou de uma lista editável", path);
          break;
        }
        this.writableField(target, node.field, [...path, "field"]);
        break;
      }
    }
  }

  private checkForm(node: Extract<Node, { type: "form" }>, scope: Scope, inner: Scope, path: Path, ids: Set<string>) {
    if (scope.form) this.add("invalid_structure", "formulário dentro de formulário", path);
    const entity = this.entities.get(node.entity);
    if (!entity) {
      this.add("not_found", `entidade "${node.entity}" não existe`, [...path, "entity"]);
      return;
    }
    if (node.mode === "edit") {
      if (!node.record) this.add("invalid_structure", "formulário de edição precisa de `record`", path);
      else {
        this.checkOperand(node.record, scope, [...path, "record"]);
        const e = this.operandEntity(node.record, scope);
        if (e && e !== node.entity) this.add("type_mismatch", `formulário edita "${node.entity}", recebe "${e}"`, [...path, "record"]);
      }
    } else if (node.record) this.add("invalid_structure", "formulário de criação não recebe `record`", [...path, "record"]);

    const defaults = new Set<string>();
    (node.defaults ?? []).forEach((d, i) => {
      this.writableField(node.entity, d.field, [...path, "defaults", i, "field"]);
      this.checkOperand(d.value, scope, [...path, "defaults", i, "value"]);
      defaults.add(d.field);
    });
    if (node.onSaved) this.checkActionUse(node.onSaved, { ...scope, item: node.entity }, [...path, "onSaved"]);

    const formScope: Scope = { ...inner, form: node.entity, inlineEdit: undefined };
    node.children.forEach((c, i) => this.checkNode(c, formScope, [...path, "children", i], ids));

    if (node.mode === "create") {
      const inputs = new Set<string>();
      collectInputs(node.children, inputs);
      for (const f of entity.fields) {
        if (f.status === "active" && f.required && f.type !== "computed" && !inputs.has(f.id) && !defaults.has(f.id))
          this.add("incomplete_form", `campo obrigatório "${f.id}" não tem entrada nem valor inicial`, path);
      }
    }
  }

  // ---------- dados ----------

  /** Valida a consulta; devolve a entidade consultada (se existir). */
  private checkQuery(q: Query, scope: Scope, path: Path): string | undefined {
    if (!this.entities.has(q.entity)) {
      this.add("not_found", `entidade "${q.entity}" não existe`, [...path, "entity"]);
      return undefined;
    }
    (q.where ?? []).forEach((c, i) => {
      const cp = [...path, "where", i];
      const t = this.fieldType(q.entity, c.field, [...cp, "field"]);
      if (c.op === "within") {
        if (t && !DATE_FIELD_TYPES.includes(t))
          this.add("type_mismatch", `"within" só vale para datas; "${c.field}" é ${t}`, [...cp, "field"]);
      } else if ("value" in c) {
        if (["gt", "gte", "lt", "lte"].includes(c.op) && t && !NUMERIC_FIELD_TYPES.includes(t) && !DATE_FIELD_TYPES.includes(t))
          this.add("type_mismatch", `comparação "${c.op}" não vale para ${t}`, [...cp, "op"]);
        this.checkOperand(c.value, scope, [...cp, "value"]);
      }
    });
    if (q.sort) this.fieldType(q.entity, q.sort.field, [...path, "sort", "field"]);
    return q.entity;
  }

  private checkOperand(op: Operand, scope: Scope, path: Path) {
    switch (op.kind) {
      case "param":
        if (!scope.screen.params?.some((p) => p.id === op.param))
          this.add("not_found", `a tela "${scope.screen.id}" não tem o parâmetro "${op.param}"`, path);
        break;
      case "item_id":
        if (!scope.item) this.add("out_of_scope", "não há item neste lugar (item_id)", path);
        break;
      case "item_field":
        if (!scope.item) this.add("out_of_scope", "não há item neste lugar (item_field)", path);
        else this.fieldType(scope.item, op.field, path);
        break;
      case "literal":
      case "today":
        break;
    }
  }

  private checkAggregate(entity: string, fn: AggregateFn, field: string | undefined, path: Path) {
    if (fn === "count") {
      if (field) this.add("invalid_structure", "contagem não usa campo", [...path, "field"]);
      return;
    }
    if (!field) {
      this.add("invalid_structure", `"${fn}" precisa de um campo`, path);
      return;
    }
    const t = this.fieldType(entity, field, [...path, "field"]);
    if (!t) return;
    const ok = fn === "sum" || fn === "avg" ? NUMERIC_FIELD_TYPES.includes(t) : NUMERIC_FIELD_TYPES.includes(t) || DATE_FIELD_TYPES.includes(t);
    if (!ok) this.add("type_mismatch", `"${fn}" não vale para o campo "${field}" (${t})`, [...path, "field"]);
  }

  private checkValue(v: Value, scope: Scope, path: Path) {
    switch (v.kind) {
      case "text":
        break;
      case "param":
        if (!scope.screen.params?.some((p) => p.id === v.param))
          this.add("not_found", `a tela "${scope.screen.id}" não tem o parâmetro "${v.param}"`, path);
        break;
      case "field": {
        if (!scope.item) {
          this.add("out_of_scope", "não há item neste lugar para ler campos", path);
          break;
        }
        const [first, second] = v.path;
        const t = this.fieldType(scope.item, first, [...path, "path", 0]);
        if (second === undefined || !t) break;
        const ref = this.entities.get(scope.item)?.fields.find((f) => f.id === first);
        if (ref?.type !== "reference") {
          this.add("type_mismatch", `"${first}" não é referência para seguir até "${second}"`, [...path, "path"]);
          break;
        }
        this.fieldType(ref.entity, second, [...path, "path", 1]);
        break;
      }
      case "aggregate": {
        const e = this.checkQuery(v.query, scope, [...path, "query"]);
        if (e) this.checkAggregate(e, v.fn, v.field, path);
        break;
      }
      case "trend": {
        const e = this.checkQuery(v.query, scope, [...path, "query"]);
        if (!e) break;
        this.checkAggregate(e, v.fn, v.field, path);
        const t = this.fieldType(e, v.dateField, [...path, "dateField"]);
        if (t && !DATE_FIELD_TYPES.includes(t)) this.add("type_mismatch", `"${v.dateField}" não é data`, [...path, "dateField"]);
        break;
      }
      case "join":
        v.parts.forEach((p, i) => this.checkValue(p, scope, [...path, "parts", i]));
        break;
    }
  }
}

function collectInputs(nodes: readonly Node[], out: Set<string>) {
  for (const n of nodes) {
    if (n.type === "field_input") out.add(n.field);
    collectInputs(childrenOf(n), out);
  }
}
