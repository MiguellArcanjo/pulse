import type { AppSpec } from "@morph/protocol";

/**
 * Context Builder: o que a IA pode ver para fazer a mudança. Nunca o banco inteiro e
 * nunca os registros do usuário (treinos, valores): só a estrutura necessária.
 * `categories` registra que tipo de informação foi enviada ("Por que a IA sabe disso?").
 */
export type BuiltContext = { text: string; categories: string[] };

export function buildContext(spec: AppSpec, intent: string, target: string | null): BuiltContext {
  const tools = spec.tools.map((t) => ({ id: t.id, name: t.name, status: t.status }));
  const usedIds = {
    tools: spec.tools.map((t) => t.id),
    entities: spec.entities.map((e) => e.id),
    screens: spec.screens.map((s) => s.id),
    actions: spec.actions.map((a) => a.id),
  };

  if (intent === "create_tool" || !target) {
    return {
      text: JSON.stringify({ tools, navigation: spec.navigation, usedIds }),
      categories: ["nomes das ferramentas", "ids já usados"],
    };
  }

  // Mudança numa ferramenta: ela inteira (entidades, telas, ações) e só o nome das outras.
  const tool = spec.tools.find((t) => t.id === target);
  const entities = spec.entities.filter((e) => e.toolId === target);
  const entityIds = new Set(entities.map((e) => e.id));
  // Entidades de outras ferramentas referenciadas pela ferramenta alvo (para não quebrar referências).
  const referenced = spec.entities.filter(
    (e) => !entityIds.has(e.id) && entities.some((x) => x.fields.some((f) => f.type === "reference" && f.entity === e.id)),
  );
  return {
    text: JSON.stringify({
      tool,
      entities,
      referencedEntities: referenced,
      screens: spec.screens.filter((s) => s.toolId === target),
      actions: spec.actions.filter((a) => a.toolId === target),
      otherTools: tools.filter((t) => t.id !== target),
      navigation: spec.navigation,
      usedIds,
    }),
    categories: [`estrutura da ferramenta ${tool?.name ?? target}`, "nomes das outras ferramentas"],
  };
}
