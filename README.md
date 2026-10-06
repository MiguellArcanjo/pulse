# Morph

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
