# Pulse

Camada de controle pessoal, local-first, sobre o PC Windows e o ambiente de desenvolvimento.

- **Pulse Core** (Rust): processo em segundo plano que monitora e controla o PC.
- **Pulse Desktop** (Tauri 2 + React): interface administrativa.
- **Pulse Mobile** (React Native, iOS, sideloading): controle remoto pela rede privada. _(a partir do M1)_

Arquitetura e decisões: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pré-requisitos (Windows)

- [Rust](https://rustup.rs) (toolchain `stable-x86_64-pc-windows-msvc`)
- Visual Studio Build Tools com **Desenvolvimento para desktop com C++**
- Node.js 22 e pnpm 10
- WebView2 (já vem no Windows 11)

## Rodando

```bash
pnpm install
pnpm dev
```

Sobe o Pulse Core e o Pulse Desktop juntos. A janela mostra CPU/RAM ao vivo.
Para testar a reconexão, rode só o Desktop (`pnpm dev:desktop`) e ligue/desligue o Core em
outro terminal (`pnpm dev:core`).

| Comando | O que faz |
|---|---|
| `pnpm dev` | Core + Desktop em modo desenvolvimento |
| `pnpm dev:core` | Só o Core |
| `pnpm dev:desktop` | Só o Desktop |
| `pnpm gen:protocol` | Regera os tipos TS a partir de `crates/pulse-protocol` |
| `pnpm typecheck` | Checagem de tipos TS |
| `pnpm check:rust` | fmt + clippy + testes Rust |

## Onde ficam os dados

| Modo | Pasta |
|---|---|
| Desenvolvimento | `%LOCALAPPDATA%\Pulse-dev\data\pulse.db` |
| Uso diário | `%LOCALAPPDATA%\Pulse\data\pulse.db` |

`PULSE_DATA_DIR` sobrescreve o local. `PULSE_ENV=dev|prod` força o modo.
O banco **nunca** fica dentro do repositório.

## Estrutura

```
apps/desktop          Tauri 2 + React (UI); src-tauri é só a ponte com o Core
crates/pulse-core     binário do Core
crates/pulse-protocol contratos (fonte da verdade dos tipos TS)
crates/pulse-db       SQLite + migrations
crates/pulse-ipc      named pipe restrito ao usuário do Windows
packages/protocol     tipos TS gerados
```
