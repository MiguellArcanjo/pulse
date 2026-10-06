import type * as z from "zod";

/**
 * Um problema encontrado ao validar ou aplicar uma mudança. A mensagem é curta e
 * objetiva porque também volta para a IA, para ela corrigir a proposta.
 */
export type Issue = {
  code: IssueCode;
  message: string;
  path: (string | number)[];
};

export type IssueCode =
  | "schema"
  | "duplicate_id"
  | "not_found"
  | "archived"
  | "reserved_id"
  | "id_reused"
  | "type_mismatch"
  | "out_of_scope"
  | "invalid_structure"
  | "incomplete_form"
  | "limit";

export function issue(code: IssueCode, message: string, path: (string | number)[]): Issue {
  return { code, message, path };
}

export function fromZod(error: z.ZodError, prefix: (string | number)[] = []): Issue[] {
  return error.issues.map((i) => ({
    code: "schema" as const,
    message: i.message,
    path: [...prefix, ...i.path.map((p) => (typeof p === "symbol" ? String(p) : p))],
  }));
}
