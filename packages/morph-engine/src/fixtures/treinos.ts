/**
 * Changesets de referência para o fluxo do MVP ("Quero controlar meus treinos",
 * "Adicione RPE", "Mostre meu recorde", "Não quero mais RPE").
 *
 * São escritos à mão, no formato que a IA deve produzir, a partir dos mockups
 * (telas 3 e 6). Servem de dado de teste aqui e, no passo 6, de exemplo do resultado
 * esperado nos testes da IA. Não são usados pelo app.
 */
import type { Node } from "@morph/protocol";

const t = (text: string) => ({ kind: "text", text }) as const;

export const criarTreinos = {
  intent: "create_tool",
  target: "treinos",
  summary: "Ferramenta Treinos criada: treinos, exercícios e séries com carga e repetições.",
  operations: [
    {
      type: "CREATE_TOOL",
      tool: {
        id: "treinos",
        name: "Treinos",
        description: "Sua jornada, no seu ritmo.",
        icon: "dumbbell",
        accent: "violet",
        home: "treinos_home",
        status: "active",
      },
    },
    {
      type: "CREATE_ENTITY",
      entity: {
        id: "exercicio",
        toolId: "treinos",
        label: "Exercício",
        labelPlural: "Exercícios",
        titleField: "nome",
        fields: [
          { id: "nome", label: "Nome", type: "text", required: true, status: "active" },
          {
            id: "grupo",
            label: "Grupo muscular",
            type: "select",
            required: false,
            status: "active",
            options: [
              { value: "peito", label: "Peito" },
              { value: "costas", label: "Costas" },
              { value: "pernas", label: "Pernas" },
              { value: "ombros", label: "Ombros" },
              { value: "biceps", label: "Bíceps" },
              { value: "triceps", label: "Tríceps" },
              { value: "abdomen", label: "Abdômen" },
              { value: "cardio", label: "Cardio" },
            ],
          },
        ],
      },
    },
    {
      type: "CREATE_ENTITY",
      entity: {
        id: "treino",
        toolId: "treinos",
        label: "Treino",
        labelPlural: "Treinos",
        titleField: "nome",
        fields: [
          { id: "nome", label: "Nome", type: "text", required: true, status: "active" },
          { id: "data", label: "Data", type: "date", required: true, status: "active" },
          { id: "duracao", label: "Duração", type: "duration", required: false, status: "active" },
        ],
      },
    },
    {
      type: "CREATE_ENTITY",
      entity: {
        id: "serie",
        toolId: "treinos",
        label: "Série",
        labelPlural: "Séries",
        titleField: "exercicio",
        fields: [
          { id: "treino", label: "Treino", type: "reference", entity: "treino", required: true, status: "active" },
          { id: "exercicio", label: "Exercício", type: "reference", entity: "exercicio", required: true, status: "active" },
          { id: "carga", label: "Carga", type: "number", unit: "kg", min: 0, step: 0.5, required: false, status: "active" },
          { id: "repeticoes", label: "Repetições", type: "integer", min: 0, required: false, status: "active" },
          {
            id: "volume",
            label: "Volume",
            type: "computed",
            unit: "kg",
            required: false,
            status: "active",
            formula: { op: "mul", args: [{ op: "field", field: "carga" }, { op: "field", field: "repeticoes" }] },
          },
        ],
      },
    },

    { type: "CREATE_ACTION", action: { id: "novo_treino", toolId: "treinos", kind: "navigate", screen: "treino_novo" } },
    {
      type: "CREATE_ACTION",
      action: { id: "abrir_treino", toolId: "treinos", kind: "navigate", screen: "treino_sessao", params: { treino: { kind: "item_id" } } },
    },
    {
      type: "CREATE_ACTION",
      action: {
        id: "nova_serie",
        toolId: "treinos",
        kind: "navigate",
        screen: "serie_nova",
        params: { treino: { kind: "param", param: "treino" } },
      },
    },
    { type: "CREATE_ACTION", action: { id: "novo_exercicio", toolId: "treinos", kind: "navigate", screen: "exercicio_novo" } },
    { type: "CREATE_ACTION", action: { id: "voltar", toolId: "treinos", kind: "go_back" } },

    {
      type: "CREATE_SCREEN",
      screen: {
        id: "treinos_home",
        toolId: "treinos",
        title: "Treinos",
        root: [
          {
            id: "cabecalho",
            type: "header",
            title: t("Treinos"),
            subtitle: t("Sua jornada, no seu ritmo."),
            icon: "dumbbell",
            action: "novo_treino",
            actionIcon: "plus",
          },
          {
            id: "treino_hoje",
            type: "hero_card",
            priority: "high",
            query: { entity: "treino", where: [{ op: "within", field: "data", period: "today" }], sort: { field: "data", dir: "desc" }, limit: 1 },
            title: t("Treino de hoje"),
            subtitle: { kind: "field", path: ["nome"] },
            meta: {
              kind: "aggregate",
              fn: "count",
              noun: { one: "série", other: "séries" },
              query: { entity: "serie", where: [{ op: "eq", field: "treino", value: { kind: "item_id" } }] },
            },
            action: "abrir_treino",
            empty: { title: "Nenhum treino hoje", action: "novo_treino" },
          },
          {
            id: "semana",
            type: "section",
            title: "Semana",
            children: [
              {
                id: "semana_grafico",
                type: "chart",
                variant: "bar",
                query: { entity: "treino", where: [{ op: "within", field: "data", period: "this_week" }] },
                groupBy: { field: "data", bucket: "weekday" },
                measure: { fn: "count" },
              },
            ],
          },
          {
            id: "resumo",
            type: "row",
            children: [
              {
                id: "resumo_treinos",
                type: "stat",
                label: "treinos",
                value: {
                  kind: "aggregate",
                  fn: "count",
                  query: { entity: "treino", where: [{ op: "within", field: "data", period: "this_week" }] },
                },
              },
              {
                id: "resumo_volume",
                type: "stat",
                label: "volume",
                value: {
                  kind: "aggregate",
                  fn: "sum",
                  field: "volume",
                  format: "compact",
                  query: { entity: "serie", where: [{ op: "within", field: "created_at", period: "this_week" }] },
                },
              },
              {
                id: "resumo_progresso",
                type: "stat",
                label: "progresso",
                value: { kind: "trend", fn: "sum", field: "volume", dateField: "created_at", period: "week", query: { entity: "serie" } },
              },
            ],
          },
          {
            id: "ultimos",
            type: "section",
            title: "Últimos treinos",
            children: [
              {
                id: "ultimos_lista",
                type: "list",
                query: { entity: "treino", sort: { field: "data", dir: "desc" }, limit: 10 },
                item: {
                  title: { kind: "field", path: ["nome"] },
                  subtitle: { kind: "field", path: ["data"], format: "relative_date" },
                  icon: "dumbbell",
                },
                action: "abrir_treino",
                empty: "Nenhum treino registrado ainda.",
              },
            ],
          },
        ],
      },
    },
    {
      type: "CREATE_SCREEN",
      screen: {
        id: "treino_novo",
        toolId: "treinos",
        title: "Novo treino",
        root: [
          {
            id: "form_treino",
            type: "form",
            entity: "treino",
            mode: "create",
            defaults: [{ field: "data", value: { kind: "today" } }],
            submitLabel: "Começar treino",
            onSaved: "abrir_treino",
            children: [
              { id: "form_treino_nome", type: "field_input", field: "nome" },
              { id: "form_treino_data", type: "field_input", field: "data" },
            ],
          },
        ],
      },
    },
    {
      type: "CREATE_SCREEN",
      screen: {
        id: "treino_sessao",
        toolId: "treinos",
        title: "Treino",
        params: [{ id: "treino", entity: "treino" }],
        record: { entity: "treino", param: "treino" },
        root: [
          {
            id: "sessao_cabecalho",
            type: "header",
            title: { kind: "field", path: ["nome"] },
            subtitle: { kind: "field", path: ["data"], format: "date" },
          },
          {
            id: "series",
            type: "repeat",
            query: {
              entity: "serie",
              where: [{ op: "eq", field: "treino", value: { kind: "param", param: "treino" } }],
              sort: { field: "created_at", dir: "asc" },
            },
            inlineEdit: true,
            empty: "Nenhuma série ainda.",
            children: [
              {
                id: "serie_card",
                type: "card",
                children: [
                  { id: "serie_exercicio", type: "heading", text: { kind: "field", path: ["exercicio", "nome"] } },
                  { id: "serie_carga", type: "field_input", field: "carga", variant: "stepper" },
                  { id: "serie_reps", type: "field_input", field: "repeticoes", variant: "stepper" },
                ],
              },
            ],
          },
          { id: "nova_serie_btn", type: "button", label: "Adicionar série", action: "nova_serie", variant: "primary", icon: "plus" },
        ],
      },
    },
    {
      type: "CREATE_SCREEN",
      screen: {
        id: "serie_nova",
        toolId: "treinos",
        title: "Nova série",
        params: [{ id: "treino", entity: "treino" }],
        root: [
          {
            id: "form_serie",
            type: "form",
            entity: "serie",
            mode: "create",
            defaults: [{ field: "treino", value: { kind: "param", param: "treino" } }],
            submitLabel: "Salvar série",
            onSaved: "voltar",
            children: [
              { id: "form_serie_exercicio", type: "field_input", field: "exercicio" },
              { id: "form_serie_carga", type: "field_input", field: "carga", variant: "stepper" },
              { id: "form_serie_reps", type: "field_input", field: "repeticoes", variant: "stepper" },
            ],
          },
          { id: "novo_exercicio_btn", type: "button", label: "Novo exercício", action: "novo_exercicio", variant: "plain", icon: "plus" },
        ],
      },
    },
    {
      type: "CREATE_SCREEN",
      screen: {
        id: "exercicio_novo",
        toolId: "treinos",
        title: "Novo exercício",
        root: [
          {
            id: "form_exercicio",
            type: "form",
            entity: "exercicio",
            mode: "create",
            submitLabel: "Salvar exercício",
            onSaved: "voltar",
            children: [
              { id: "form_exercicio_nome", type: "field_input", field: "nome" },
              { id: "form_exercicio_grupo", type: "field_input", field: "grupo" },
            ],
          },
        ],
      },
    },
    { type: "ADD_NAV_ITEM", tool: "treinos" },
  ],
};

export const adicionarRpe = {
  intent: "modify_tool",
  target: "treinos",
  summary: "RPE adicionado às séries (esforço percebido, de 1 a 10).",
  operations: [
    {
      type: "ADD_FIELD",
      entity: "serie",
      field: { id: "rpe", label: "RPE", type: "number", min: 1, max: 10, step: 0.5, required: false, status: "active" },
    },
    {
      type: "ADD_COMPONENT",
      screen: "treino_sessao",
      parent: "serie_card",
      node: { id: "serie_rpe", type: "field_input", field: "rpe", variant: "stepper" },
    },
    {
      type: "ADD_COMPONENT",
      screen: "serie_nova",
      parent: "form_serie",
      node: { id: "form_serie_rpe", type: "field_input", field: "rpe", variant: "stepper" },
    },
  ],
};

/** Selo "Recorde 100 kg" no card de cada série (mockup 6). */
export const recordeNode: Node = {
  id: "serie_recorde",
  type: "badge",
  tone: "accent",
  text: {
    kind: "join",
    separator: " ",
    parts: [
      { kind: "text", text: "Recorde" },
      {
        kind: "aggregate",
        fn: "max",
        field: "carga",
        query: { entity: "serie", where: [{ op: "eq", field: "exercicio", value: { kind: "item_field", field: "exercicio" } }] },
      },
    ],
  },
};

export const mostrarRecorde = {
  intent: "modify_tool",
  target: "treinos",
  summary: "Recorde de carga exibido em cada exercício do treino.",
  operations: [{ type: "ADD_COMPONENT", screen: "treino_sessao", parent: "serie_card", index: 1, node: recordeNode }],
};

/** Remoção segura: arquiva o campo (os dados ficam) e tira os componentes que o usavam. */
export const removerRpe = {
  intent: "modify_tool",
  target: "treinos",
  summary: "RPE deixa de ser registrado. Os valores já gravados continuam guardados.",
  operations: [
    { type: "REMOVE_COMPONENT", screen: "treino_sessao", node: "serie_rpe" },
    { type: "REMOVE_COMPONENT", screen: "serie_nova", node: "form_serie_rpe" },
    { type: "ARCHIVE_FIELD", entity: "serie", field: "rpe" },
  ],
};
