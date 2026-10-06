import { createContext, useContext, type ReactNode } from "react";
import type { Node } from "@morph/protocol";

/**
 * Os componentes com filhos renderizam os filhos por aqui (evita importação circular
 * entre os componentes e o RenderNode).
 */
export type RenderFn = (node: Node) => ReactNode;

const RenderContext = createContext<RenderFn | null>(null);

export const RenderProvider = RenderContext.Provider;

export function useRender(): RenderFn {
  const r = useContext(RenderContext);
  if (!r) throw new Error("RenderProvider ausente");
  return r;
}

export function Children({ nodes }: { nodes: readonly Node[] }) {
  const render = useRender();
  return <>{nodes.map(render)}</>;
}
