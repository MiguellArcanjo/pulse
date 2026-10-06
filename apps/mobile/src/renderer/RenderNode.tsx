import type { ReactNode } from "react";
import type { Node, Screen } from "@morph/protocol";
import { useReady } from "../data/MorphProvider";
import { ChartNode, ListNode, RepeatNode } from "./components/data";
import {
  BadgeNode,
  ButtonNode,
  EmptyStateNode,
  HeaderNode,
  HeadingNode,
  HeroCardNode,
  ProgressNode,
  StatNode,
  TextNode,
} from "./components/display";
import { FieldInputNode, FormNode } from "./components/form";
import { CardNode, DividerNode, RowNode, SectionNode, StackNode } from "./components/layout";
import { RenderProvider } from "./render-context";
import { ScopeProvider } from "./scope";

/**
 * Um componente do catálogo para cada `type` do protocolo. A spec já foi validada pelo
 * engine no servidor; aqui não existe "componente desconhecido".
 */
export function renderNode(node: Node): ReactNode {
  const k = node.id;
  switch (node.type) {
    case "stack":
      return <StackNode key={k} node={node} />;
    case "row":
      return <RowNode key={k} node={node} />;
    case "section":
      return <SectionNode key={k} node={node} />;
    case "card":
      return <CardNode key={k} node={node} />;
    case "header":
      return <HeaderNode key={k} node={node} />;
    case "hero_card":
      return <HeroCardNode key={k} node={node} />;
    case "heading":
      return <HeadingNode key={k} node={node} />;
    case "text":
      return <TextNode key={k} node={node} />;
    case "stat":
      return <StatNode key={k} node={node} />;
    case "chart":
      return <ChartNode key={k} node={node} />;
    case "list":
      return <ListNode key={k} node={node} />;
    case "repeat":
      return <RepeatNode key={k} node={node} />;
    case "badge":
      return <BadgeNode key={k} node={node} />;
    case "progress":
      return <ProgressNode key={k} node={node} />;
    case "divider":
      return <DividerNode key={k} />;
    case "empty_state":
      return <EmptyStateNode key={k} node={node} />;
    case "button":
      return <ButtonNode key={k} node={node} />;
    case "form":
      return <FormNode key={k} node={node} />;
    case "field_input":
      return <FieldInputNode key={k} node={node} />;
  }
}

/** Renderiza uma tela da spec com seus parâmetros. */
export function ScreenRenderer({ screen, params }: { screen: Screen; params: Record<string, string> }) {
  return (
    <RenderProvider value={renderNode}>
      <ScreenScope screen={screen} params={params}>
        {screen.root.map(renderNode)}
      </ScreenScope>
    </RenderProvider>
  );
}

/** Se a tela mostra um registro (ex.: o treino aberto), ele vira o item do contexto. */
function ScreenScope({ screen, params, children }: { screen: Screen; params: Record<string, string>; children: ReactNode }) {
  const { index } = useReady();
  const id = screen.record ? params[screen.record.param] : undefined;
  const item = id ? index.get(id) : undefined;
  return <ScopeProvider value={{ screen, params, item }}>{children}</ScopeProvider>;
}
