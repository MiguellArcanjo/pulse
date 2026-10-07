# Security Research Workspace

## 1. Direção e primeira entrega

Aprovada em 2026-10-06: novo produto para pesquisa autorizada. Black-box funciona sem Git,
código-fonte ou repositório. Claude será parceiro da caça, vinculado à investigação e aos seus
materiais; revisão de código e correções são capacidades opcionais para projetos white-box.

Fluxo implementado nesta etapa: projeto/autorização/escopo → investigação → observação → hipótese
→ evidência textual → finding confirmado pelo usuário → relatório Markdown fundamentado nos registros.

Não há integração Claude, chamada de IA ou execução de ferramentas nesta entrega. A UI informa
essa ausência. Nenhum dado de exemplo é inserido no banco persistente.

## 2. Protocolo e domínio

`apps/server/src/research/schema.ts`: entradas Zod estritas para projetos, investigações, registros
e confirmação de findings. `store.ts`: regras de negócio, referências e transações.

- Projeto: tipo (OWN_PROJECT/AUTHORIZED_PROJECT/BUG_BOUNTY/LAB/CTF), origem da autorização,
  validade opcional, ambiente explícito, hosts permitidos/proibidos, restrições e versão do escopo.
- V1 inicial suporta um ambiente por projeto e hosts exatos. Subdomínios não são implícitos.
  Wildcards, CIDR, URLs e revisão de escopo ainda não são suportados. Não inferir essas permissões.
- Investigação: projeto, asset permitido, objetivo. Não possui repositoryId obrigatório.
- Registros: OBSERVATION, HYPOTHESIS e EVIDENCE distintos, com conteúdo, origem e referências locais.
  Uma evidência nesta etapa é um registro textual manual; upload e armazenamento de blobs virão depois.
- Finding: hipótese da mesma investigação, pelo menos uma evidência da mesma investigação,
  impacto, reprodução, severidade, justificativa e confirmação explícita. Uma hipótese gera no
  máximo um finding. Não há afirmação automática de confirmação a partir de IA.
- Eventos: ação, data, projeto/investigação e ator local. Gravados na mesma transação do domínio.
  A timeline apresenta até 200 eventos recentes. Ainda não há event bus/replay distribuído.

Migrations em `apps/server/research-migrations/`, separadas das migrations do Morph. Relações
estruturais têm chaves estrangeiras; os payloads por entidade usam JSONB validado. Antes de ampliar
consultas, colaboração e relações, extrair campos indexáveis e tabelas de ligação. Ainda não é o
modelo relacional completo proposto. Registros não podem ser editados ou excluídos nesta etapa.

Testes cobrem fluxo black-box, falta de confirmação, referências cruzadas, duplicação, escopo,
expiração, rollback quando a auditoria falha e proteção da API local.

## 3. Execução e armazenamento

`pnpm research` compila `apps/workspace` (React/Vite) e inicia `research/main.ts` em
127.0.0.1:47710. Banco PGlite em `apps/server/.data/research/`, ignorado pelo Git. Não lê
DATABASE_URL e não abre dados Morph. Um único processo deve ser dono do banco.

A instância é de um usuário local, sem acesso remoto: valida Host e Origin, não habilita CORS,
exige cookie aleatório HttpOnly/SameSite=Strict na API e Origin nas mutações. A sessão muda a cada
reinício; recarregar a página restabelece o cookie. Isso protege contra requisições web de outra
origem, não contra outros processos maliciosos já rodando sob o usuário do Windows.

O backend não registra payloads. Os dados locais não estão criptografados pela aplicação nesta
etapa; não tratar como cofre de credenciais. O export do relatório é uma ação manual e contém as
evidências selecionadas. Não há envio automático a fornecedores ou programas de bounty.

O build da UI é servido com CSP restritiva; conteúdo do usuário é renderizado como texto React,
sem HTML livre. Dependências e JS vêm do próprio build, sem CDN.

## 3.1 App desktop (Electron)

`pnpm desktop` compila a interface e abre o HackerBot como app do Windows (Electron 44.6.0,
`apps/desktop`). O servidor e o banco rodam dentro do processo principal (`startResearch` em
`apps/server/src/research/start.ts`, o mesmo usado por `pnpm research`), só em 127.0.0.1:47710.
Em desenvolvimento usa o mesmo banco de `apps/server/.data/research/`; empacotado, a pasta de
dados do usuário do Windows. Uma única instância por vez (o banco tem um dono só).

Segurança conforme https://www.electronjs.org/docs/latest/tutorial/security: contextIsolation e
sandbox ligados, sem nodeIntegration e sem preload, permissões negadas, navegação presa à origem
local, nenhuma janela extra nem webview, menu removido. A interface é carregada por HTTP de
loopback do próprio app (o guia prefere protocolo customizado; avaliar ao empacotar).
O main é empacotado com esbuild (`--packages=external`); ícone gerado por
`apps/desktop/scripts/make-icon.py`. Instalador e atalho no menu Iniciar: próxima etapa.

## 4. Interface

Marca HackerBot. Moldura: barra lateral de navegação, topo com busca global real (Ctrl+K, rota
`/api/search`) e página atual. **Dashboard** (mockup HackerBot) com dados reais calculados em
`research/dashboard.ts`: atenção, totais e séries de 14 dias, investigações por etapa, prioridades
(findings por severidade e hipóteses abertas pela confiança informada pelo usuário), projetos e
atividade recente; painel "desde sua última visita" (o resumo por IA fica desativado).
**Projetos** (mockup): filtros por status com contagem, grade/lista, busca, filtros por tipo e
ambiente, cartões e painel de detalhes (visão geral, assets, anel de progresso, gráfico de 30 dias,
informações, links). Dados de `research/projects-overview.ts`; progresso = média das etapas das
investigações. Menu "⋯": mudar status, editar informações, abrir. **Novo projeto**: assistente em
4 etapas (Informações → Escopo → Autorização → Revisão) com pré-visualização ao vivo
(`app/NewProject.tsx`); usado também dentro do projeto aberto. **Projeto aberto** (mockup,
`pages/ProjectView.tsx`): cabeçalho com trilha, status editável e "Editar projeto"; abas; e a
aba **Visão geral** com "continue de onde parou" (investigação em andamento mais recente, com
etapa, progresso e contagens reais), "Atenção" (findings por severidade + hipóteses abertas por
confiança informada), "Atividade recente" (eventos do projeto) e um resumo lateral (status,
tipo, ambiente, datas, membros desativado, links rápidos, tags e ações). Dados reais de
`research/project-home.ts` via `GET /api/projects/:id/home`. Nesta etapa **só a aba "Visão geral"
existe**; as demais (Assets, Endpoints, Investigações, Hipóteses, Findings, Notas, Arquivos,
Configurações) aparecem bloqueadas com o motivo, como os itens ainda não refeitos do menu. A
ferramenta de investigação (tela anterior, `pages/Workspace.tsx`) é alcançada por "Continuar
investigação" e "Nova investigação"; ela ainda mantém sua própria lista lateral de projetos
(unificar com a moldura é etapa posterior). Sem métricas fictícias, gráficos decorativos ou
painel Claude falso. Formulários em dialogs nativos. Ctrl+K foca a busca global do topo
(projetos, investigações, registros, findings).

O app roda como Electron em modo de desenvolvimento (`pnpm desktop`); instalador e terminal (PTY)
ainda não existem.

## 5. Próximas fatias

1. Sessões Claude reais por investigação, inclusive pasta de materiais sem repo: verificar CLI,
   provar PTY/resize/lifecycle/reconnect e resolver isolamento antes de liberar execução.
2. Artifacts imutáveis com hashes/proveniência, importação de capturas e masking de credenciais.
3. Authorization/Scope/Environment como entidades versionadas próprias, aprovação vinculada à
   ação e Tool Registry. Sem execução ativa até implementar toda a cadeia de validação.
4. AI Investigator usando packages/ai, novo Context Builder e propostas estruturadas validadas.
5. Electron, busca global, eventos duráveis e reanexação do terminal conforme capacidade real.
6. Git/white-box/correções/regressão opcionais. Integrações de bounty e mobile ficam para depois.

ClaudeSession, TerminalSession e ToolRun devem permanecer conceitos separados. A saída do PTY
é combinada; não fingir stdout/stderr independentes. Retomar conversa não restaura um processo morto.
Nenhuma conclusão do Claude vira finding sem revisão e evidência. A sessão não recebe automaticamente
todo o projeto. Execução externa não tem rollback transacional; registrar interrupção e incerteza.

## 6. Documentação oficial consultada

- React: https://react.dev/reference/react-dom/client/createRoot
- Vite: https://vite.dev/guide/build
- Fastify: https://fastify.dev/docs/latest/Reference/Hooks/
- PGlite: https://pglite.dev/docs/api
- Claude CLI: https://code.claude.com/docs/en/cli-reference
- Claude sandbox: https://code.claude.com/docs/en/sandboxing
- PTY: https://github.com/microsoft/node-pty

## 7. Decisões

- Autorizado iniciar incrementalmente após análise; black-box é o fluxo principal.
- O novo runtime não depende de AppSpec nem reutiliza o renderer mobile.
- Banco e porta novos; nenhuma alteração na conta Heroku e nenhum commit/push automático.
- Preservar código/dados antigos durante a extração; remoção definitiva é etapa posterior.
- Pendente: isolamento de execução do Claude no Windows. Cwd e prompts não são sandbox.
  Não anunciar confinamento de filesystem/rede sem comprovação técnica.
- Pendente: política de envio de evidências a providers e criptografia/retencão de artifacts.
- Electron aprovado pelo dono (2026-10-07). App de desenvolvimento funcionando; instalador pendente.
- Hipótese ganhou `confidence` (0–100) opcional, informada pelo usuário; usada nas prioridades.
- Projeto ganhou `status` (ACTIVE/ANALYSIS/PAUSED/DONE, padrão ACTIVE), `description`, `tags` e
  `links` (só http/https), editáveis por `PATCH /api/projects/:id`, que não aceita campos de
  escopo/autorização. Projetos antigos recebem os padrões na leitura. Links abrem no navegador do
  sistema (no Electron, `setWindowOpenHandler` + `shell.openExternal` só para http/https).
- Aba "Endpoints" e "Membros" ficam desativadas: entidade/colaboração ainda não existem.
- Projeto aberto = Visão geral (2026-10-07): a tela do projeto agora é a visão geral do mockup
  (`ProjectView` + `GET /api/projects/:id/home`, calculado em `project-home.ts`, função pura
  testada). Abrir um projeto leva à visão geral; abrir uma investigação (busca global, "continuar",
  "nova investigação") leva à ferramenta `Workspace`. As outras abas do projeto ficam bloqueadas
  com o motivo nesta etapa (decisão do dono). "Continue de onde parou" = investigação em andamento
  (etapa < 4) mais recente; se todas concluídas, a mais recente. "Atenção" lista findings por
  severidade e hipóteses abertas por confiança informada — sem misturar os dois num só número, como
  o mockup sugeria. "Adicionar nota" e "Upload de arquivo" aparecem desativados (não existem ainda).
- Assistente "Novo projeto" (2026-10-07): projeto ganhou `target` (WEB/API/MOBILE/INFRA/OTHER) e
  `criticality` (LOW/MEDIUM/HIGH/CRITICAL), opcionais e editáveis; o status inicial pode ser
  escolhido na criação. A etapa "Configurações" do mockup (Nmap, Burp, agentes de IA, scan
  automático, visibilidade) foi **removida**: o workspace não executa nada, não há agentes e é de
  um usuário só. No lugar entrou "Autorização" (tipo, origem, validade, links) e a revisão exige
  confirmar que a pesquisa é autorizada. "Endpoints específicos" e wildcards (`*.dominio`) não
  entram: o escopo continua com hosts exatos; URLs coladas viram o host.
