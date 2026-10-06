/**
 * Versão do Morph Protocol. Sobe quando o formato da AppSpec muda de um jeito que
 * exige migração das specs já salvas.
 */
export const PROTOCOL_VERSION = 1;

export * from "./common.ts";
export * from "./entity.ts";
export * from "./data.ts";
export * from "./components.ts";
export * from "./spec.ts";
export * from "./operations.ts";
