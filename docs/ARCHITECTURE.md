# Morph: arquitetura

> "O software se constrói e evolui ao redor do usuário."
> Revisão 1: 2026-10-06. Substitui por completo o antigo Pulse (apagado nesta data).

## 0. Resumo

Morph é um app mobile (iOS) em que a IA **modifica o próprio produto** por meio de um
**runtime declarativo**: a IA descreve *o que* deve existir (ferramentas, entidades, telas,
ações) em um formato validável, o **Morph Protocol**, e o app decide *como* renderizar.
A IA nunca gera nem executa código.

A LLM nunca é a autoridade final:

| Peça | Papel |
|---|---|
| LLM | planeja e propõe |
| Morph Protocol | linguagem permitida |
| Validator (morph-engine) | regras |
| Permission Engine | autoridade |
| Design System | aparência |
| Action Engine | execução |
| Banco (Postgres) | estado real |
| Motion Engine | mostra a transformação |

## 1. Visão geral

```
iPhone (Expo)                               Servidor (Node + TS, Heroku)
┌───────────────────────────┐               ┌──────────────────────────────────┐
│ Renderer (Spec → RN)      │    HTTPS      │ API                              │
│ Design System (tokens)    │◄─────────────►│ AI Orchestrator (passo 6)        │
│ Motion Engine (diff por id│               │   Model Router · Context Builder │
│   + Reanimated)           │               │   AIProvider                     │
│ Cache da Spec (abre sem   │               │ Morph Engine (validar/aplicar)   │
│   servidor e sem IA)      │               │ Postgres: spec versionada,       │
│ SecureStore (só o token)  │               │   registros, evolution, ai_calls │
└───────────────────────────┘               └──────────────────────────────────┘
          ▲                                              ▲
          └──────── packages/morph-protocol (Zod) ───────┘   ← mesmo schema nos dois lados
```

### Monorepo

| Pasta | Papel | Estado |
|---|---|---|
| `packages/morph-protocol` | Schemas Zod: AppSpec, Entity, Screen, Node, Action, Operation, Changeset | v1 |
| `packages/morph-engine` | Funções puras: aplicar operações, validação semântica, rollback, registros | v1 (diff no passo 4) |
| `packages/ai` | AIProvider, Model Router, prompts versionados | passo 6 |
| `packages/client` | Cliente da API + sincronização (sem React Native) | v1 |
| `apps/server` | Node + TS (Fastify 5): API, versões, registros, Evolution, pareamento | v1 (IA no passo 6) |
| `apps/mobile` | Renderer, Design System, telas fixas (pareamento, início); Motion no passo 4 | v1 |

Regras de dependência: `protocol` não depende de nada do projeto; `engine` só de `protocol`;
`ai` não conhece banco nem UI; `mobile` nunca importa `ai` nem fala com fornecedor de IA.

## 2. Morph Protocol (v1, implementado no passo 1)

Código: `packages/morph-protocol/src` (schemas Zod) e `packages/morph-engine/src`.

| Peça | Arquivo | Resumo |
|---|---|---|
| Básicos | `common.ts` | `Id` (minúsculas, números e `_`), níveis de permissão, cores de destaque e ícones **por nome** (a IA nunca escolhe cor/estilo) |
| Entidades | `entity.ts` | `Entity` + `Field` (text, long_text, number, integer, boolean, date, datetime, duration, select, reference, computed). Campo calculado usa `Formula` (só + − × ÷ sobre campos numéricos). Campos de sistema: `id`, `created_at`, `updated_at` |
| Dados | `data.ts` | `Query` (entidade + filtros + ordem + limite), `Condition`, `Operand` (literal, parâmetro da tela, item do contexto, hoje), `Value` (texto, campo, agregado, tendência, junção) |
| Componentes | `components.ts` | 19 tipos: stack, row, section, card, header, hero_card, heading, text, stat, chart, list, repeat, badge, progress, divider, empty_state, button, form, field_input |
| App | `spec.ts` | `AppSpec` (tools, entities, screens, actions, navigation; automations/skills reservados e vazios), `Screen` (params + registro da tela), `Action` (navigate, go_back, delete_record) |
| Mudanças | `operations.ts` | `Changeset` com 16 operações (CREATE/UPDATE/ARCHIVE_TOOL, CREATE_ENTITY, ADD/UPDATE/ARCHIVE_FIELD, CREATE/UPDATE_SCREEN, ADD/UPDATE/MOVE/REMOVE_COMPONENT, CREATE_ACTION, ADD/REMOVE_NAV_ITEM) |

Engine (`morph-engine`):
- `applyChangeset(spec, input)`: schema → operações numa cópia → limites → validação
  semântica. Tudo ou nada; a spec recebida nunca é alterada. Devolve o nível de permissão.
- `validateSpec`: ids repetidos, referências, tipos (somar texto, `within` em não-data…),
  campos arquivados em uso, `field_input` fora de formulário/lista editável, item fora de
  contexto, parâmetros de navegação, formulário sem campo obrigatório, profundidade.
- `restoreVersion`: desfazer = versão nova com o conteúdo antigo (histórico nunca reescrito).
- `recordSchema(entity)` / `computeFields`: validação dos registros e campos calculados.
- Níveis (`permissions.ts`): criar/alterar = SAFE_ACTION; arquivar, remover componente,
  tirar da navegação = CONFIRM; apagar registro = CONFIRM. Nenhuma operação apaga dados.

Outras regras do protocolo:
- Agregado com `noun` ({one, other}) escreve singular/plural: "1 série", "3 séries".
- Parâmetros de tela não podem se chamar `screen`, `params` ou `screenid`: são reservados pela
  navegação do app (React Navigation descarta `screen`). A rota do app é `s/[screenId]`.

Regras de segurança dos dados:
- Campo novo não pode ser obrigatório; campo existente não pode virar obrigatório; tipo de
  campo não muda; id de campo arquivado nunca é reaproveitado (os dados antigos usam o id).
- Remover um campo = arquivar + tirar os componentes que o usam (senão a validação recusa).

Casos de referência (`morph-engine/src/fixtures/treinos.ts`), feitos a partir dos mockups:
criar Treinos (5 telas), adicionar RPE, mostrar recorde, remover RPE.

## 3. Pipeline de mudança (tudo ou nada)

```
Pedido → Router (modelo FAST classifica) → Context Builder (só o relevante)
→ modelo MAIN/REASONING gera Changeset (Structured Output)
→ ① schema (Zod) → ② semântica (ids existem? componente no catálogo? tipos batem?)
→ ③ permissão (nível de cada operação) → ④ prévia/confirmação quando exigida
→ aplicar em transação → nova versão → evento no Evolution
```

Falhou qualquer etapa: **nada é aplicado**. O erro volta ao modelo uma vez; falhou de novo,
aborta. Referências a componentes, Skills ou capacidades inexistentes são rejeitadas.

Níveis de permissão: `READ` · `SAFE_ACTION` · `CONFIRM` · `CRITICAL`.

## 4. IA (passo 6: fornecedor ainda não escolhido)

- `AIProvider { generate, generateStructured, toolCall, stream, analyzeImage? }`.
  Nenhuma chamada a fornecedor fora de `packages/ai`.
- Configuração centralizada: `AI_PROVIDER`, `AI_MODEL_FAST`, `AI_MODEL_MAIN`,
  `AI_MODEL_REASONING`. Nomes de modelos nunca espalhados pelo código.
- Model Router: FAST (classificar, extrair, intenção, resumos), MAIN (criar/modificar Tools,
  telas, entidades), REASONING (reorganizações grandes, migrações, operações destrutivas).
- Prompts por papel e versionados (`orchestrator`, `builder:v1`, `designer:v1`, `observer`,
  `automator`), compostos em: regras base + papel + estado do app + ferramentas + memória
  relevante + pedido.
- Contexto seletivo: só a Tool, as Entities e Screens relacionadas, o catálogo de componentes
  e o histórico relevante. Nunca o banco inteiro.
- Observabilidade (`ai_calls`): requestId, provider, modelo, papel, versão do prompt,
  latência, tokens, custo estimado (tabela de preços configurável), tool calls, validação,
  tentativas. **Nunca** chaves, tokens ou dados sensíveis.
- Prompt injection: conteúdo externo é **dado não confiável**, separado das instruções.
  Uma Skill não concede permissões; permissões são do app.
- Privacidade: enviar o mínimo, nunca credenciais; registrar a categoria do dado usado
  ("Por que a IA sabe disso?").
- A escolha do fornecedor (OpenAI, Claude, Gemini) é feita no passo 6, comparando a
  documentação oficial (suporte a schema recursivo, preço por nível, limites). Nada de nomes,
  preços ou limites de memória.

Fatos já verificados (2026-10-06):
- OpenAI Structured Outputs: recomendado via Responses API; helper `zodTextFormat`; aceita
  schemas recursivos com `$ref`/`$defs`; recusa vem em campo `refusal`.
  ([docs](https://developers.openai.com/api/docs/guides/structured-outputs))
- Reanimated no Expo SDK 57: instala com `react-native-worklets`; plugin Babel já
  configurado pelo `babel-preset-expo`. ([docs](https://docs.expo.dev/versions/latest/sdk/reanimated/))

## 4.1 Servidor (passo 2)

Código: `apps/server`. Fastify 5 ([docs](https://fastify.dev/docs/latest/)), `pg` na Heroku
(SSL conforme a [documentação](https://devcenter.heroku.com/articles/connecting-heroku-postgres)),
PGlite em desenvolvimento e testes ([docs](https://pglite.dev/docs/api)).

| Rota | O que faz |
|---|---|
| `GET /v1/health` | Sem token |
| `POST /v1/auth/pair` | Código de pareamento → token (sem token; freio após 20 falhas em 15 min) |
| `GET /v1/spec` | Spec atual |
| `POST /v1/changesets` | Aplica changeset (`changesets.ts` → `commitChangeset`); CONFIRM exige `confirm: true` |
| `GET /v1/versions` · `POST /v1/versions/:v/restore` | Histórico e desfazer (sempre CONFIRM) |
| `GET /v1/evolution` | Linha do tempo + contadores (ferramentas, automações, integrações) |
| `GET /v1/records?cursor=` | Sincronização: registros alterados depois do cursor, inclusive apagados |
| `POST /v1/records` · `PATCH /v1/records/:id` · `DELETE /v1/records/:id` | Escrita validada contra a spec atual; apagar exige `confirm: true` |

- Tabelas (`migrations/0001_init.sql`): `users`, `devices`, `pairing_codes`, `app_versions`,
  `records` (JSONB), `evolution_events`. Todas com `user_id`.
- Consultas da tela (filtros, agregados, gráficos) serão avaliadas **no app**, sobre os registros
  sincronizados (passo 3): funciona sem internet e respeita o fuso do aparelho.
- Log sem corpo de requisição e com `Authorization` ocultado.
- `pnpm morph …` (`scripts/dev-cli.ts`): aplica os casos de teste pela API durante os passos 3–5.

## 4.2 App (passo 3)

- **Abre sem rede e sem IA**: spec + registros ficam no aparelho (`expo-sqlite/kv-store`);
  o token fica no SecureStore. A sincronização (`@morph/client` → `pull`) roda ao abrir e ao
  voltar para o app. Escrita sem conexão é recusada com aviso ("Nada foi salvo"); fila
  offline fica para depois.
- **Consultas calculadas no aparelho** (`morph-engine/src/query.ts`): filtros, agregados,
  tendência e gráficos, no fuso do iPhone; semana começa na segunda. Formatação em PT-BR
  feita à mão (`format.ts`), igual no Node e no Hermes.
- **Renderer** (`apps/mobile/src/renderer`): um componente por tipo do protocolo; rota
  genérica `/s/<tela>?<parâmetros>`; contexto (`scope.tsx`) com item, formulário e edição
  direta. Controle de entrada escolhido pelo tipo do campo.
- **Design System** (`apps/mobile/src/design`): tokens (cores claro/escuro, destaques,
  espaçamento, tipografia), ícones por nome semântico, superfícies translúcidas.
- Bibliotecas nativas (um único build): Reanimated + Worklets, expo-blur,
  expo-linear-gradient, expo-sqlite, @react-native-community/datetimepicker
  ([docs Expo 57](https://docs.expo.dev/versions/latest/)).

## 4.2.1 Motion Engine (passo 4)

- `morph-engine/src/diff.ts`: compara duas versões da spec e diz, por tela, o que surgiu,
  sumiu, mudou ou se moveu (ids estáveis do protocolo). Irmãos que só "deram espaço" não
  contam como movidos.
- `apps/mobile/src/motion/Motion.tsx`: cada componente fica num `Animated.View` (Reanimated 4,
  [docs](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/)):
  entrada com mola, saída esmaecendo, reposicionamento deslizando, brilho breve na cor da
  ferramenta no que surgiu/mudou. Ao abrir uma tela nada anima (`LayoutAnimationConfig
  skipEntering`). Destaque vale por 10 s após a mudança chegar.
- Puxar para atualizar em todas as telas. Validado no iPhone: RPE surgindo na sessão aberta.

## 4.3 Deploy na Heroku

- `Procfile` roda o servidor direto em TypeScript (Node 22, `engines`).
- O buildpack instala o monorepo inteiro (inclusive o Expo); o script `heroku-cleanup`
  ([docs](https://devcenter.heroku.com/articles/nodejs-classic-buildpack-builds)) reinstala só
  o servidor em modo produção (`--filter "@morph/server..."`): ~46 MB de dependências.
- Pareamento: o primeiro código aparece no log; depois, um aparelho pareado gera códigos
  (`POST /v1/auth/pairing-codes`, `pnpm morph code`).

## 5. Infraestrutura

- **Servidor**: Node + TS num dyno **Basic** da Heroku (US$ 7/mês, sempre ligado) +
  **Heroku Postgres Essential-0** (US$ 5/mês, 1 GB). Pago pelos créditos de estudante
  (US$ 13/mês por 24 meses; o que sobra não acumula). **Nada além disso sem conversar**:
  há cartão cadastrado e o excedente vai para ele.
  ([dynos](https://devcenter.heroku.com/articles/dyno-types) ·
  [Postgres](https://devcenter.heroku.com/articles/heroku-postgres-plans) ·
  [preços](https://www.heroku.com/pricing) ·
  [créditos](https://www.heroku.com/github-students/))
- O código é Node + Postgres comum: dá para sair da Heroku sem reescrever.
- **iOS**: conta Apple gratuita, IPA não assinado no GitHub Actions (macOS), assinado e
  instalado pelo AltServer no Windows ([IOS-SIDELOAD.md](IOS-SIDELOAD.md)). Sem push e sem
  segundo plano: o que precisa rodar sozinho roda no servidor.
- Segredos (chave de IA, `DATABASE_URL`) só em variáveis de ambiente do servidor. O
  repositório é **público**. O app guarda apenas o token de acesso, no SecureStore.

## 6. Plano do MVP

O MVP prova uma coisa: *uma IA consegue criar e modificar uma experiência de software
funcional, persistente e visualmente coerente enquanto o usuário a usa.*

| # | Entrega | Pronto quando |
|---|---|---|
| 0 | ✅ Apagar o Pulse, esqueleto do Morph, CI e docs | typecheck + testes verdes |
| 1 | ✅ `morph-protocol` + `morph-engine` com testes (treinos, RPE, remover RPE, componente/Skill inventados, referência inválida, operação destrutiva, rollback) | testes passam sem rede |
| 2 | ✅ `apps/server`: Postgres, migrations, versões da Spec, registros, Evolution, acesso por token | aplica e desfaz changeset pela API |
| 3 | ✅ Mobile: Design System + renderer + uso real (salvar dados). Novo dev client (Reanimated) | Spec salva vira tela usável no iPhone |
| 4 | ✅ Motion Engine (RPE surge dentro da tela) | transformação animada |
| 5 | Evolution + desfazer | linha do tempo real |
| 6 | Escolha da IA + `packages/ai` + router + tela "O que vamos criar hoje?" com etapas reais | fluxo completo de 12 passos |

Do 3 ao 5, changesets são aplicados por **script de desenvolvimento** (fora do app). Nada de
tela falsa no produto: a tela de criação só aparece no passo 6, funcionando com IA de verdade.

Fases seguintes (só depois da base sólida): 2 Memory/Observer/sugestões · 3 Automações,
Context Engine, notificações · 4 Skills e integrações · 5 UI adaptativa avançada.

## 7. Decisões

| # | Decisão | Escolha |
|---|---|---|
| M1 | Destino do Pulse | Apagado por completo, inclusive o que não estava commitado (2026-10-06) |
| M2 | Onde roda o servidor | Heroku (créditos de estudante), Node + TS + Postgres (2026-10-06) |
| M3 | Nome / bundle | Morph · `dev.morph.mobile` (2026-10-06) |
| M4 | Fornecedor de IA | Escolhido no passo 6, após comparar documentação oficial (2026-10-06) |
| M5 | Postgres no desenvolvimento | PGlite (Postgres dentro do Node) em dev e testes; `pg` na Heroku (2026-10-06) |
| M6 | Acesso iPhone ↔ servidor | Código de pareamento de uso único (15 min) → token por aparelho; só hashes no banco (2026-10-06) |
| M7 | Tema | Segue o sistema (claro/escuro) |
| M8 | Usuários | MVP para um usuário, com `user_id` em todas as tabelas desde o início |
