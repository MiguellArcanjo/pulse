---
name: iniciar
description: Sobe o ambiente de desenvolvimento do Morph (servidor local + Metro do app) e confere se está de pé. Use quando o usuário disser "iniciar", "inicia", "sobe tudo", "liga o Morph" ou rodar /iniciar.
---

# Iniciar o ambiente do Morph

O usuário quer tudo rodando sem executar comando por comando. Faça nesta ordem e só relate
no final (em PT-BR, curto).

> `pnpm iniciar` sobe o servidor local (porta 47700) e o Metro (porta 8081). O iPhone usa o
> servidor da Heroku; o servidor local serve para testes e para o `pnpm morph`.

## 1. Ver o que já está rodando

```powershell
Get-NetTCPConnection -State Listen -LocalPort 47700, 8081 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
```

Se as portas 47700 e 8081 já estão escutando, **não suba de novo** e não mate o processo: diga que já
está rodando e pule para o passo 4.

## 2. Subir

Rode no **painel de Terminal do usuário** (ferramenta `run_in_terminal`, título "Morph"),
da raiz do repositório:

```
pnpm iniciar
```

**Não** use Bash com `run_in_background`: tarefas em segundo plano expiram e derrubam o
ambiente no meio do uso. O servidor recarrega sozinho quando o código muda (`--watch`).

## 3. Esperar e conferir

Leia o terminal com `read_terminal` (`wait_for_output_ms` de alguns segundos, repetindo) até
aparecerem `Server listening at http://127.0.0.1:47700` e `Waiting on http://localhost:8081`
(ou `Metro waiting`), ou um erro (`Error`, `EADDRINUSE`,
`exited with code`). Confira:

```bash
curl -s http://127.0.0.1:47700/v1/health
```

Deve responder `{"ok":true}`. Se o log mostrar `Código de pareamento: XXXXX-XXXXX`, é porque
nenhum aparelho foi pareado ainda: repasse o código ao usuário (vale 15 minutos).

## 4. Relatar

Tabela curta com ✅/❌ para servidor e Metro, mais:
- no iPhone: abrir o Morph (dev client) na mesma rede; ele carrega o código do PC;
- dados locais em `apps/server/.data/pglite` (fora do Git);
- para testar mudanças sem IA: `pnpm morph login http://127.0.0.1:47700 <código>` e
  `pnpm morph apply criar-treinos`;
- para parar: Ctrl+C na aba "Morph" do Terminal (ou `stop_terminal_tab`, se pedirem).
