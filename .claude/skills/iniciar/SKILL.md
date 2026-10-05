---
name: iniciar
description: Sobe o ambiente de desenvolvimento do Pulse inteiro (Core, Desktop e Metro do iPhone) e confere se cada parte está de pé. Use quando o usuário disser "iniciar", "inicia", "sobe tudo", "liga o Pulse" ou rodar /iniciar.
---

# Iniciar o ambiente do Pulse

O usuário quer tudo rodando sem executar comando por comando. Faça nesta ordem e
só relate no final (em PT-BR, curto).

## 1. Ver o que já está rodando

```powershell
Get-Process pulse-core, pulse-desktop -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path
Get-NetTCPConnection -State Listen -LocalPort 47610, 1420, 8081 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
```

- Se Core, Desktop e Metro (portas 47610, 1420 e 8081) já estão de pé, **não suba de novo**:
  diga que já está tudo rodando e pule para o passo 4.
- Se só parte está de pé, **não mate processos do usuário**. Explique o que está rodando e
  pergunte se pode reiniciar. (Um segundo Core recusa iniciar: o named pipe é exclusivo.)

## 2. Subir tudo

Rode no **painel de Terminal do usuário** (ferramenta `run_in_terminal`, título "Pulse"),
da raiz do repositório:

```
pnpm iniciar
```

**Não** use Bash com `run_in_background`: tarefas em segundo plano expiram (30 min) e
derrubam o ambiente no meio do uso. No painel de Terminal o processo fica até o usuário
parar (Ctrl+C), e ele vê os logs.

`pnpm iniciar` = `concurrently` com `pnpm dev:core`, `pnpm dev:desktop` e `pnpm dev:mobile`.
A primeira compilação Rust pode levar alguns minutos.

## 3. Esperar e conferir

Leia o terminal com `read_terminal` (`tab_id` devolvido, `wait_for_output_ms` de alguns
segundos, repetindo) até aparecerem os sinais abaixo, ou um erro:

| Parte | Sinal de pronto no log | Conferência extra |
|---|---|---|
| Core | `Pulse Core ... iniciado` | `curl -s http://127.0.0.1:47610/v1/health` → `"ok":true` |
| Desktop | `local:desktop conectado` (linha do core) | — |
| Metro | `Waiting on http://localhost:8081` ou `Metro waiting` | porta 8081 escutando |

Sinais de erro: `error[`, `error:`, `exited with code`, `EADDRINUSE`, `já existe um Pulse Core`.
Se algo falhar, mostre as linhas relevantes do log e o diagnóstico; não tente "consertar"
matando processos sem perguntar.

## 4. Conferir o Tailscale (só leitura)

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" serve status
```

Deve mostrar `proxy http://127.0.0.1:47610`. Se não mostrar, **não rode** `tailscale serve`
(muda a configuração do usuário): diga o comando para ele rodar:
`tailscale serve --bg --https=443 http://127.0.0.1:47610`.

## 5. Relatar

Uma tabela curta com ✅/❌ para Core, Desktop, Metro e Tailscale Serve, mais:
- no iPhone: abrir o Pulse (dev client) no mesmo Wi-Fi; ele recarrega o código sozinho;
- para parar tudo: Ctrl+C na aba "Pulse" do Terminal (ou eu paro com `stop_terminal_tab`, se pedirem).

Para **reiniciar** (ex.: depois de mudar código Rust do Core): pare a aba com
`stop_terminal_tab` e rode o passo 2 de novo. Código TypeScript (Desktop e iPhone) recarrega
sozinho, sem reiniciar.
