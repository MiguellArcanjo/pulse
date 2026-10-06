import * as z from "zod";

/**
 * Tradução entre o schema do protocolo (Zod) e o subconjunto de JSON Schema que o modo
 * estrito de saída estruturada aceita (Structured Outputs da OpenAI:
 * https://developers.openai.com/api/docs/guides/structured-outputs):
 * - todo campo é obrigatório: opcional vira "pode ser null";
 * - objetos fechados (`additionalProperties: false`);
 * - `anyOf` no lugar de `oneOf`; tuplas viram listas;
 * - mapas de chave livre (`record`) viram listas de pares {key, value};
 * - restrições numéricas, de tamanho e regex saem do schema da IA (o Zod do protocolo
 *   continua validando tudo depois, então nada passa sem checagem).
 *
 * `fromStrict` faz o caminho de volta, guiado pelo schema original.
 */

type Json = Record<string, unknown>;

const DROP = new Set([
  "$schema",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "format",
  "default",
  "propertyNames",
  "id",
]);

export type StrictSchema = { schema: Json; original: Json };

export function toStrictSchema(zodSchema: z.ZodType): StrictSchema {
  // reused: "ref" → partes repetidas viram $defs (schema bem menor para a IA).
  const original = z.toJSONSchema(zodSchema, { target: "draft-2020-12", io: "output", unrepresentable: "any", reused: "ref" }) as Json;
  const defs = (original["$defs"] ?? {}) as Record<string, Json>;
  const strictDefs: Record<string, Json> = {};
  for (const [k, v] of Object.entries(defs)) strictDefs[k] = convert(v);
  const { $defs: _ignored, ...root } = original;
  const schema = convert(root as Json);
  if (Object.keys(strictDefs).length > 0) schema["$defs"] = strictDefs;
  return { schema, original };
}

function isRecord(s: Json): boolean {
  return s["type"] === "object" && !s["properties"] && typeof s["additionalProperties"] === "object";
}

function convert(s: Json): Json {
  if (typeof s !== "object" || s === null) return s;
  if (s["$ref"]) return { $ref: s["$ref"] };

  const out: Json = {};
  for (const [k, v] of Object.entries(s)) if (!DROP.has(k)) out[k] = v;

  if (out["oneOf"]) {
    out["anyOf"] = out["oneOf"];
    delete out["oneOf"];
  }
  if (Array.isArray(out["anyOf"])) out["anyOf"] = (out["anyOf"] as Json[]).map(convert);

  if (isRecord(s)) {
    return {
      type: "array",
      description: "Pares chave/valor",
      items: {
        type: "object",
        properties: { key: { type: "string" }, value: convert(s["additionalProperties"] as Json) },
        required: ["key", "value"],
        additionalProperties: false,
      },
    };
  }

  if (out["type"] === "array") {
    if (Array.isArray(out["prefixItems"])) {
      const items = (out["prefixItems"] as Json[]).map(convert);
      const unique = [...new Map(items.map((i) => [JSON.stringify(i), i])).values()];
      out["items"] = unique.length === 1 ? unique[0] : { anyOf: unique };
      delete out["prefixItems"];
    } else if (out["items"]) {
      out["items"] = convert(out["items"] as Json);
    }
  }

  if (out["type"] === "object" && out["properties"]) {
    const props = out["properties"] as Record<string, Json>;
    const required = new Set((s["required"] as string[] | undefined) ?? []);
    const next: Record<string, Json> = {};
    for (const [k, v] of Object.entries(props)) {
      const c = convert(v);
      next[k] = required.has(k) ? c : { anyOf: [c, { type: "null" }] };
    }
    out["properties"] = next;
    out["required"] = Object.keys(props);
    out["additionalProperties"] = false;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volta: resposta no formato estrito → formato do protocolo

function resolve(s: Json, root: Json): Json {
  let cur = s;
  for (let i = 0; i < 20 && cur["$ref"]; i++) {
    const ref = String(cur["$ref"]);
    if (ref === "#") cur = root;
    else {
      const name = ref.replace(/^#\/\$defs\//, "");
      cur = ((root["$defs"] ?? {}) as Record<string, Json>)[name] ?? {};
    }
  }
  return cur;
}

function branches(s: Json): Json[] | null {
  const b = (s["anyOf"] ?? s["oneOf"]) as Json[] | undefined;
  return Array.isArray(b) ? b : null;
}

/** Escolhe o ramo de uma união que combina com o valor (discriminador `const` primeiro). */
function pick(options: Json[], value: unknown, root: Json): Json | undefined {
  const resolved = options.map((o) => resolve(o, root));
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Json;
    const byConst = resolved.find((o) => {
      const props = o["properties"] as Record<string, Json> | undefined;
      if (!props) return false;
      const consts = Object.entries(props).filter(([, p]) => "const" in p || (Array.isArray(p["enum"]) && o["type"] === "object"));
      if (consts.length === 0) return false;
      return consts.every(([k, p]) => ("const" in p ? v[k] === p["const"] : (p["enum"] as unknown[]).includes(v[k])));
    });
    if (byConst) return byConst;
    return resolved.find((o) => o["type"] === "object" || isRecord(o));
  }
  if (Array.isArray(value)) return resolved.find((o) => o["type"] === "array" || isRecord(o));
  if (value === null) return resolved.find((o) => o["type"] === "null");
  return resolved.find((o) => o["type"] === typeof value || (o["type"] === "integer" && typeof value === "number") || "const" in o || "enum" in o);
}

export function fromStrict(value: unknown, original: Json): unknown {
  return back(value, original, original);
}

function back(value: unknown, schema: Json, root: Json): unknown {
  const s = resolve(schema, root);
  const opts = branches(s);
  if (opts) {
    const chosen = pick(opts, value, root);
    return chosen ? back(value, chosen, root) : value;
  }
  if (isRecord(s) && Array.isArray(value)) {
    const out: Json = {};
    for (const pair of value as { key: string; value: unknown }[]) out[pair.key] = back(pair.value, s["additionalProperties"] as Json, root);
    return out;
  }
  if (Array.isArray(value)) {
    const prefix = s["prefixItems"] as Json[] | undefined;
    return value.map((v, i) => back(v, prefix?.[i] ?? (s["items"] as Json) ?? {}, root));
  }
  if (value !== null && typeof value === "object") {
    const props = (s["properties"] ?? {}) as Record<string, Json>;
    const required = new Set((s["required"] as string[] | undefined) ?? []);
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (v === null && !required.has(k)) continue; // opcional não informado
      out[k] = props[k] ? back(v, props[k], root) : v;
    }
    return out;
  }
  return value;
}
