# Security Research Workspace

Produto em migração: pesquisa de segurança autorizada, com **black-box como fluxo principal**.
Repositório e código-fonte são opcionais. O conceito do Morph foi encerrado.

## Rodar a primeira etapa local

No Windows, com Node 22 e pnpm 10:

```powershell
pnpm install
pnpm research
```

Abra **http://127.0.0.1:47710/**. A interface React é compilada e servida pelo backend local.
Esta é uma prévia funcional para desktop no navegador; o empacotamento Electron ainda não está implementado.
O banco independente fica em `apps/server/.data/research/`. Nenhuma variável da Heroku é utilizada.
Use uma única instância; feche com Ctrl+C antes de abrir outra. Não abra o banco por outro processo.

Já funciona: projeto com autorização e escopo, investigação sem repo, observações, hipóteses,
evidências textuais, confirmação humana de finding, histórico e exportação de relatório Markdown.
Busca Ctrl+K filtra os registros da aba atual da investigação; ainda não é busca global.

Ainda não implementado: Claude/PTy, AI Investigator, execução de ferramentas, importação de arquivos,
Git, múltiplos ambientes por projeto, edição/revisão de escopo e aplicativo Electron.
O cadastro de escopo é restrito a hosts exatos; não aceita wildcard, URL ou CIDR.
Nenhuma ação ativa é executada nesta etapa. Não há dados de demonstração no banco do produto.

Arquitetura e próximos passos: [docs/RESEARCH.md](docs/RESEARCH.md).
Verificação: `pnpm typecheck`, `pnpm test`, `pnpm --filter @research/workspace build`.

## Referência do produto anterior (Morph)

> O software se constrói e evolui ao redor do usuário.

App mobile (iOS) em que a IA cria e modifica o próprio aplicativo (ferramentas, telas,
dados) por meio de um runtime declarativo, o **Morph Protocol**. A IA propõe; o sistema
valida e decide.

- Arquitetura, plano e decisões: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Instalar no iPhone sem Mac: [docs/IOS-SIDELOAD.md](docs/IOS-SIDELOAD.md)

## Pré-requisitos (Windows)

- Node.js 22 e pnpm 10

## Comandos

```bash
pnpm install
pnpm iniciar
```

| Comando | O que faz |
|---|---|
| `pnpm iniciar` | Sobe o servidor local (porta 47700; código de pareamento aparece no log) |
| `pnpm dev:mobile` | Metro para o dev client no iPhone |
| `pnpm morph login <url> <código>` | Pareia o script de desenvolvimento com o servidor |
| `pnpm morph apply <caso> [--confirm]` | Aplica um caso de teste (criar-treinos, adicionar-rpe, mostrar-recorde, remover-rpe) |
| `pnpm morph undo [--confirm]` / `versions` | Desfaz a última mudança / lista versões |
| `pnpm typecheck` | Checagem de tipos de todos os pacotes |
| `pnpm test` | Testes de todos os pacotes |

## Estrutura

```
packages/morph-protocol   schema do protocolo (Zod)
packages/morph-engine     validação e aplicação de operações (funções puras)
apps/server               API (Node + Fastify + Postgres/PGlite)
apps/mobile               Expo / React Native (iOS); ios/ é gerado no CI
```
