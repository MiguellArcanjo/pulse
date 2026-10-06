import { childrenOf, type AppSpec, type Node, type Screen } from "@morph/protocol";

/**
 * O que mudou entre duas versões da spec, componente por componente. É a base do
 * Motion Engine: o app anima exatamente o que surgiu, sumiu, mudou ou se moveu, em vez de
 * trocar a tela inteira.
 */

export type ScreenDiff = {
  added: string[];
  removed: string[];
  /** Mesmo id, conteúdo diferente (sem contar os filhos). */
  updated: string[];
  /** Mesmo id, outro pai ou outra ordem entre os irmãos que continuaram. */
  moved: string[];
};

export type SpecDiff = {
  screens: Record<string, ScreenDiff>;
  tools: { added: string[]; removed: string[] };
};

type Placement = { parent: string | null; node: Node };

function index(screen: Screen | undefined): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const walk = (nodes: readonly Node[], parent: string | null) => {
    for (const n of nodes) {
      out.set(n.id, { parent, node: n });
      walk(childrenOf(n), n.id);
    }
  };
  if (screen) walk(screen.root, null);
  return out;
}

/** Conteúdo do nó sem os filhos (mudança num filho não conta como mudança no pai). */
function ownContent(n: Node): string {
  const { children: _children, ...rest } = n as Node & { children?: unknown };
  return JSON.stringify(rest);
}

function siblingsOf(screen: Screen | undefined, parent: string | null): string[] {
  if (!screen) return [];
  if (parent === null) return screen.root.map((n) => n.id);
  const p = index(screen).get(parent)?.node;
  return p ? childrenOf(p).map((c) => c.id) : [];
}

export function diffScreen(prev: Screen | undefined, next: Screen | undefined): ScreenDiff {
  const a = index(prev);
  const b = index(next);
  const diff: ScreenDiff = { added: [], removed: [], updated: [], moved: [] };

  for (const id of a.keys()) if (!b.has(id)) diff.removed.push(id);
  for (const [id, placed] of b) {
    const before = a.get(id);
    if (!before) {
      diff.added.push(id);
      continue;
    }
    if (ownContent(before.node) !== ownContent(placed.node)) diff.updated.push(id);
    if (before.parent !== placed.parent) {
      diff.moved.push(id);
      continue;
    }
    // Mesma posição relativa entre os irmãos que existiam antes e continuam?
    const keep = (ids: string[]) => ids.filter((x) => a.has(x) && b.has(x) && a.get(x)?.parent === b.get(x)?.parent);
    const was = keep(siblingsOf(prev, before.parent));
    const now = keep(siblingsOf(next, placed.parent));
    if (was.indexOf(id) !== now.indexOf(id)) diff.moved.push(id);
  }
  return diff;
}

function isEmpty(d: ScreenDiff): boolean {
  return d.added.length + d.removed.length + d.updated.length + d.moved.length === 0;
}

export function diffSpecs(prev: AppSpec, next: AppSpec): SpecDiff {
  const screens: Record<string, ScreenDiff> = {};
  const ids = new Set([...prev.screens.map((s) => s.id), ...next.screens.map((s) => s.id)]);
  for (const id of ids) {
    const d = diffScreen(
      prev.screens.find((s) => s.id === id),
      next.screens.find((s) => s.id === id),
    );
    if (!isEmpty(d)) screens[id] = d;
  }
  const active = (s: AppSpec) => new Set(s.tools.filter((t) => t.status === "active").map((t) => t.id));
  const before = active(prev);
  const after = active(next);
  return {
    screens,
    tools: { added: [...after].filter((t) => !before.has(t)), removed: [...before].filter((t) => !after.has(t)) },
  };
}
