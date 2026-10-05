# Pulse — Arquitetura (revisão 1: Mobile nativo iOS, desenvolvimento em Windows)

> Status: **proposta, nada implementado ainda.**
> Data da pesquisa: 2026-10-04. Fontes oficiais consultadas listadas em [§ Fontes](#fontes).

Legenda de classificação:

| Tag | Significado |
|---|---|
| `CONFIRMADO` | Sabemos como implementar; depende só de nós. |
| `POC` | Precisa de prova de conceito antes de comprometer o design. |
| `EXTERNO` | Depende de Apple, Anthropic, Tailscale, Google/Microsoft ou outro software. |
| `FORA DO MVP` | Não precisamos resolver agora. |

Um ponto pode ter mais de uma tag (ex.: `EXTERNO` + `POC`).

---

## 0. Resumo executivo

1. **O maior risco do projeto não é código — é o pipeline iOS sem Mac.** Pela documentação oficial da Expo, *todo* build para iPhone feito pelo EAS exige conta Apple paga; o único caminho com conta gratuita é compilar com Xcode. Proposta: compilar um **IPA não assinado** em runner macOS do GitHub Actions e deixar o **AltServer (Windows)** assinar com o Apple ID pessoal durante a instalação. Isso precisa ser provado **antes** de qualquer outra coisa (Milestone 1).
2. Com conta gratuita: app expira em **7 dias**, máximo **3 apps sideloaded** ativos, **10 App IDs por 7 dias**, e **sem Push Notifications / Background Modes**. Consequência direta: Pulse Mobile **não recebe notificações com o app fechado** no plano gratuito.
3. Pulse Core roda como **processo do usuário** (não serviço Windows), fala com o Desktop por **named pipe** e com o iPhone por **HTTPS via Tailscale Serve**. Nenhuma porta do Core escuta fora de `127.0.0.1`.
4. Claude Code é integrado **somente por interfaces documentadas**: `CLAUDE_CONFIG_DIR` (uma por conta), PTY, hooks e flags da CLI. O formato JSONL de transcripts é documentado como **interno e instável** — Pulse não o parseia.
5. Browser: extensão MV3 própria + Native Messaging. **Não** usar `--remote-debugging-port`: desde o Chrome 136 ele é ignorado no perfil padrão.

Decisões que preciso que você tome estão em [§ 32](#32-decisões-pendentes-preciso-da-sua-escolha).

---

## 1. Estrutura do monorepo — `CONFIRMADO`

Dois gerenciadores convivendo na raiz: **pnpm workspaces** (TS) e **Cargo workspace** (Rust).

```
pulse/
├─ Cargo.toml                    # workspace Rust
├─ pnpm-workspace.yaml
├─ package.json
├─ apps/
│  ├─ desktop/                   # Tauri 2 + React + TS (Vite)
│  │  ├─ src/                    # React
│  │  └─ src-tauri/              # shell Tauri (fino; fala com o Core)
│  └─ mobile/                    # React Native + TS (Expo, prebuild/CNG)
├─ crates/
│  ├─ pulse-core/                # binário pulse-core.exe (daemon)
│  ├─ pulse-protocol/            # tipos de API, eventos, ações (fonte da verdade)
│  ├─ pulse-db/                  # SQLite, migrations, repositórios
│  ├─ pulse-events/              # Event Bus
│  ├─ pulse-auth/                # pairing, tokens, permissões, audit
│  ├─ pulse-modules/             # control, devos, browser, trigger, claude, terminal, files, echo
│  ├─ pulse-ipc/                 # cliente/servidor named pipe (usado por Desktop, host, hook)
│  ├─ pulse-browser-host/        # binário Native Messaging (Chrome/Edge ↔ Core)
│  └─ pulse-hook/                # binário chamado pelos hooks do Claude Code
├─ extensions/
│  └─ browser/                   # extensão MV3 (Chrome + Edge)
├─ packages/
│  ├─ protocol/                  # tipos TS GERADOS a partir de pulse-protocol + validadores
│  ├─ client/                    # cliente Pulse API (HTTP + WS), sem dependência de DOM/RN
│  └─ tokens/                    # design tokens (cores, espaçamento) — só dados
├─ .github/workflows/
│  ├─ ci.yml                     # Rust + TS em Windows runner
│  └─ ios-build.yml              # IPA não assinado em macOS runner
└─ docs/
```

Princípio: **Rust é a fonte da verdade dos contratos.** TS é gerado, nunca escrito à mão.

---

## 2. Tauri Desktop — `CONFIRMADO`

- Tauri 2 + React + TypeScript + Vite. Interface administrativa completa (editor de Triggers, gestão de dispositivos, aprovação de pareamento, configuração de providers de IA).
- O processo Rust do Tauri é **fino**: não contém lógica de negócio. Ele abre o named pipe do Core e expõe ao React via `invoke` (comandos) e eventos Tauri (stream do Event Bus).
- Capabilities do Tauri restritas: o webview **não** recebe plugin `shell`, `fs` amplo nem acesso de rede arbitrário. Tudo passa pelos comandos Rust próprios.
- Desktop pode **iniciar** o Core se ele não estiver rodando (spawn do executável instalado), mas o ciclo de vida do Core é independente — fechar a janela não derruba o Core.
- Alternativa considerada: empacotar o Core como *sidecar* Tauri (`externalBin`). Funciona para distribuição, mas acopla o ciclo de vida ao app. Pode ser usado só como mecanismo de instalação.

---

## 3. Rust Pulse Core — `CONFIRMADO` (estrutura) / `POC` (GPU, serviços)

**Modelo de processo:** `pulse-core.exe` roda **na sessão do usuário logado**, iniciado no logon (Task Scheduler "at log on" ou chave `HKCU\…\Run`).

Por que **não** um Windows Service: serviços rodam na Session 0, isolada da área de trabalho do usuário. Abrir apps, tirar screenshot, falar com o navegador, criar PTYs com o ambiente do usuário e rodar Claude Code com o perfil do usuário exigem a sessão interativa.

Crates previstas (ecossistema maduro, sem APIs inventadas):

| Necessidade | Escolha |
|---|---|
| Runtime | `tokio` |
| HTTP/WS | `axum` |
| SQLite | `rusqlite` (bundled) ou `sqlx` — ver § 32 |
| Métricas CPU/RAM/disco/rede/processos | `sysinfo` |
| APIs Win32 (lock, shutdown, suspend, janelas) | crate `windows` (oficial Microsoft) |
| PTY | `portable-pty` (usa ConPTY no Windows) |
| Segredos | `keyring` → Windows Credential Manager |
| Screenshot | `xcap` ou Windows Graphics Capture — `POC` |
| GPU | não há API única: NVML (NVIDIA) ou contadores PDH "GPU Engine" — `POC` |
| Serviços Windows | leitura via SCM é simples; start/stop exige admin → MVP somente leitura |

Módulos internos se registram num **Action Registry** (§ 24): todo módulo expõe ações estruturadas, nunca comandos livres.

---

## 4. React Native Mobile — `CONFIRMADO` (código) / `EXTERNO` + `POC` (build)

- **Expo SDK com Continuous Native Generation (`expo prebuild`) + `expo-dev-client`.** Não usamos Expo Go: Face ID não funciona no Expo Go (documentado) e não queremos depender dele.
- O diretório `ios/` é **gerado** no runner macOS; não é versionado. Isso evita precisar de Xcode localmente.
- Bibliotecas Expo para o que precisamos: `expo-secure-store` (Keychain), `expo-local-authentication` (Face ID), `expo-camera` (QR), `expo-haptics`, `@react-native-community/netinfo`, React Navigation (bottom tabs + native stack), `react-native-safe-area-context`.
- Desenvolvimento diário **no Windows**: Metro roda no PC; o *dev client* instalado no iPhone carrega o bundle JS pela rede (LAN ou Tailscale). Só precisamos de um novo build nativo quando mudarmos dependências nativas ou a assinatura expirar.
- Bundle ID **fixo** (ex.: `dev.pulse.mobile`) para não queimar a cota de 10 App IDs/semana.

---

## 5. Código compartilhável Web ↔ React Native — `CONFIRMADO`

| Compartilhar | Não compartilhar |
|---|---|
| Tipos gerados da API, eventos, ações, níveis de permissão (`packages/protocol`) | Componentes visuais |
| Validadores de payload | Navegação |
| Cliente Pulse API: HTTP, WS, reconexão, cursor de eventos (`packages/client`, usando apenas `fetch`/`WebSocket` globais, presentes nos dois runtimes) | Armazenamento (Desktop não guarda tokens no JS; Mobile usa SecureStore) |
| Formatadores (bytes, durações, datas) | Gestos, haptics, Face ID |
| Design tokens (valores, não componentes) | |

Geração de tipos Rust → TS: ver alternativas em § 32.

---

## 6. Comunicação Core ↔ Desktop — `CONFIRMADO` (decisão pendente § 32)

**Recomendado: Named pipe Windows** `\\.\pipe\pulse-core-<SID>` com ACL restrita ao SID do usuário.

- Protocolo: frames `u32` (tamanho) + JSON, mensagens tipadas em `pulse_protocol::ipc` (`hello` → `welcome`, `request`/`response` com `id`, `event` por tópico assinado). Mesmo modelo de ações do HTTP. *(Implementado no M0.)*
- O pipe é criado com `first_pipe_instance`: um segundo Core, ou um processo tentando se passar pelo Core, não consegue criá-lo. **Hardening pendente (M10):** o cliente verificar o executável do servidor via `GetNamedPipeServerProcessId`, para o caso de um impostor criar o pipe *antes* do Core.
- Motivo principal: o canal administrativo **não pode ser alcançado via TCP**. Se o Desktop usasse `127.0.0.1:porta`, um erro de configuração no Tailscale Serve (apontando para a porta errada) exporia o canal administrativo ao tailnet. Pipe não é proxyável pelo Serve.
- O mesmo pipe atende `pulse-browser-host.exe` e `pulse-hook.exe`, cada um com identidade de cliente distinta e escopo próprio.

Principal identificado como `local:desktop` → nível máximo permitido, mas **ainda auditado**.

---

## 7. Comunicação Core ↔ iPhone — `CONFIRMADO`

- Core abre listener **remoto** em `127.0.0.1:<porta_remota>` (nunca `0.0.0.0`).
- **Tailscale Serve** publica esse listener no tailnet com HTTPS (§ 8).
- HTTP (REST, JSON) para consultas e ações: `/v1/...`.
- WebSocket `/v1/stream` para estado em tempo real e eventos.
- Todo request remoto é autenticado por token de dispositivo (§ 10). Os headers de identidade do Tailscale (`Tailscale-User-Login` etc.) são registrados no audit, **mas não substituem** a autenticação do Pulse: identificam o usuário Tailscale, não o dispositivo pareado, e não existem para nós tagueados.

---

## 8. Tailscale — `EXTERNO` (`CONFIRMADO` em documentação)

Fatos da documentação oficial:

- **Serve** compartilha um serviço local apenas dentro do tailnet; **Funnel** é que expõe à Internet — **Funnel não será usado.**
- Serve exige habilitar **HTTPS certificates** no tailnet. Certificados são Let's Encrypt para o nome `máquina.tailnet.ts.net`; chave privada gerada localmente.
- ⚠️ **Os nomes das máquinas aparecem no log público de Certificate Transparency.** O nome do PC não deve conter informação sensível.
- **Unattended mode** (somente Windows) mantém o PC no tailnet mesmo com usuário deslogado/reboot. Node keys expiram em 180 dias por padrão; para o PC, recomenda-se desabilitar key expiry (trade-off: fica conectado até revogação manual).
- ACLs do Tailscale se aplicam ao Serve: recomenda-se ACL permitindo apenas o iPhone → PC na porta do Serve.

Com o certificado válido via Serve, o app iOS fala HTTPS normal — **sem exceções ATS**.

Pulse **não** configura o Tailscale programaticamente no MVP; o Desktop mostra um checklist e verifica o que for verificável (processo `tailscaled` presente, hostname resolvendo). Instruções: `tailscale serve` apontando para a porta remota do Core.

Fallback LAN sem Tailscale: `FORA DO MVP` (exigiria TLS próprio + pinning + permissão Local Network no iOS).

---

## 9. Device pairing — `CONFIRMADO`

```
Desktop                         Core                          iPhone
  │ Settings→Devices→Add          │                               │
  │──── pairing.create ──────────▶│ cria pairing (TTL 120s,       │
  │◀─── {qr} ─────────────────────│ secret 256 bits, uso único)   │
  │ mostra QR                     │                               │
  │                               │◀── POST /v1/pairing/claim ────│ escaneia QR
  │                               │    {pairing_id, proof=HMAC(   │
  │                               │     secret, device_nonce),    │
  │                               │     device_name, model}       │
  │◀── evento pairing.requested ──│                               │
  │ "iPhone de Miguel deseja      │                               │ mostra código
  │  acessar Pulse" + código 6    │    código = derivado de       │ de 6 dígitos
  │  dígitos (compare)            │    (secret, device_nonce)     │ (mesmo)
  │ [Autorizar] [Recusar]         │                               │
  │──── pairing.approve ─────────▶│ cria device_id + credenciais  │
  │                               │──── WS/poll: approved ───────▶│ grava no Keychain
```

QR contém apenas: versão, URL `https://<pc>.<tailnet>.ts.net`, `pairing_id`, `secret`, expiração. **Nada** reutilizável depois do uso.

**Revisado na implementação (M2):** o código de 6 dígitos aparece **só no iPhone** e o usuário o **digita** no Desktop; o Core confere (tempo constante) e recusa o pedido após 3 erros. Comparar visualmente permitiria aprovar no automático: se um atacante usar um QR fotografado, o iPhone legítimo mostra apenas um erro, e sem código para digitar não há como aprovar o intruso.

Cada dispositivo recebe identidade própria; não existe senha compartilhada.

---

## 10. Autenticação — `CONFIRMADO` (base) / `POC` (prova biométrica)

- Ao aprovar: Core emite **refresh token** (256 bits, opaco) e **access token** de curta duração (ex.: 15 min).
- Core guarda apenas **hash** (SHA-256) dos tokens, ligados a `device_id`.
- Refresh com **rotação**: cada uso gera novo refresh token; reuso de token antigo ⇒ revoga o dispositivo (detecção de roubo).
- Revogação no Desktop invalida imediatamente e derruba o WS do dispositivo.
- Rate limiting por dispositivo e por IP de origem (no Core; o Serve repassa `X-Forwarded-For`).
- Audit de autenticações e falhas.

**Limitação honesta sobre Face ID:** o Face ID acontece no iPhone; o Core não tem como *saber* que ocorreu se só receber um booleano. Duas camadas:

1. **MVP:** Face ID no app (SecurityGate) + ação CRITICAL exige `confirmation_id` de uso único emitido pelo Core. Protege contra uso casual do celular desbloqueado, não contra um app modificado.
2. **POC posterior:** chave no Secure Enclave com controle de acesso biométrico assina um *challenge* do Core — prova criptográfica de biometria. Exige módulo nativo (não há API Expo pronta para isso); avaliar viabilidade.

---

## 11. Armazenamento seguro de tokens no iPhone — `CONFIRMADO` + `POC` (sob re-assinatura)

- `expo-secure-store` → Keychain (`kSecClassGenericPassword`).
- Acessibilidade: `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (não migra em backup restaurado em outro aparelho).
- **Nunca** AsyncStorage/MMKV para segredos. Cache não-secreto pode usar armazenamento comum.
- Documentado pela Expo: itens com `requireAuthentication` ficam inacessíveis se a biometria mudar; dados no Keychain podem persistir após desinstalar. Por isso o app, no primeiro launch, verifica um marcador não-secreto e limpa Keychain órfão.
- **M1:** persistência entre aberturas ✅ confirmada. **Pendente:** confirmar que o Keychain persiste entre *refreshes* do AltStore (re-assinatura a cada 7 dias com o mesmo Apple ID). Se trocar de Apple ID, o Team ID muda e os itens ficam inacessíveis ⇒ basta parear de novo (aceitável).

---

## 12. Face ID — `CONFIRMADO` (lib) + `POC` (em build sideloaded)

- `expo-local-authentication`, com `NSFaceIDUsageDescription` via config plugin. Não funciona no Expo Go (motivo extra para dev client).
- Face ID não depende de entitlement pago. **✅ Confirmado no M1** em build com assinatura gratuita.
- `SecurityGate` reutilizável:
  - `gate(reason, scope)` → abre Face ID uma vez e concede uma **janela curta** (ex.: 60 s) restrita ao `scope` da operação, para não pedir repetidamente dentro de uma mesma operação (ex.: sessão de terminal aberta).
  - Escopos: `terminal`, `power`, `file.delete`, `echo.critical`, `security.settings`.
  - Respeita os toggles "Require Face ID for …" (configuração **no Core**, por dispositivo, não só local, para que um app adulterado não possa simplesmente desligá-los).
  - Fallback para senha do iPhone: configurável; padrão permitido.

---

## 13. WebSocket / reconexão — `CONFIRMADO`

- Todo evento persistido tem `seq` monotônico (tabela `events`).
- Cliente conecta com `?since=<último seq>`; Core reenvia o que faltou (limite de janela; se exceder ⇒ sinaliza `resync_required` e o cliente busca snapshot via REST).
- Heartbeat ping/pong ~20 s; timeout ⇒ reconexão.
- Backoff exponencial com jitter (1 s → 30 s máx).
- Gatilhos de reconexão imediata: app volta ao foreground (`AppState`), mudança de rede (NetInfo).
- Filtro por permissão: o Core só envia ao dispositivo eventos de módulos que ele pode ler.

**Limitação iOS (comportamento do sistema):** o app é suspenso em background e o socket cai. Sem Background Modes/Push (conta gratuita), não há recebimento em background. Ver § 14 e Notificações.

---

## 14. Comportamento offline — `CONFIRMADO`

- Estado de conexão explícito: `online` / `reconnecting` / `PC Offline` / `não autorizado` (token revogado).
- "PC Offline" é mostrado em destaque; dados em cache ficam esmaecidos com **"Última atualização: …"**.
- Cada dado em cache guarda `fetched_at`; nenhum componente exibe cache sem o carimbo.
- Ações ficam **desabilitadas** offline (não enfileirar ações de controle para executar depois — evitaria, por ex., um "desligar" executado horas depois).
- Cache mínimo: snapshot da Home, lista de projetos, lista de Triggers. Nada de conteúdo de arquivos, logs completos ou conversas Echo em disco além do necessário.

**Notificações:** sem APNs (conta gratuita), Pulse Mobile só mostra alertas **enquanto aberto**. Com conta paga, o Core poderia chamar APNs diretamente (sem backend SaaS) — `FORA DO MVP`.

---

## 15. Geração do build iOS — `EXTERNO` + `POC` (crítico)

Fato documentado (Expo): *"All builds that run on an iPhone device require a paid Apple Developer account for build signing"* no EAS; e compilar localmente com Xcode é *"the only way to install a development build on an iPhone without a paid Apple Developer account."*

Logo, com conta gratuita, **EAS Build não serve para o iPhone**. Proposta:

```
GitHub Actions (macos runner)
  pnpm install
  npx expo prebuild -p ios
  pod install
  xcodebuild archive  -sdk iphoneos  CODE_SIGNING_ALLOWED=NO
  empacotar Payload/Pulse.app → Pulse.ipa (não assinado)
  upload como artifact
        │
        ▼ (download no Windows)
AltServer (Windows) → "Sideload .ipa…" → assina com Apple ID gratuito → instala
```

Duas variantes do IPA:
- **dev client** (carrega JS do Metro no PC) — para desenvolvimento.
- **release** (JS embutido) — para uso diário.

As duas variantes usam o mesmo bundle ID (`dev.pulse.mobile`): instalar uma **substitui** a outra; não ocupam dois slots.

**POC (Milestone 1)** precisa provar: build não assinado no runner, aceitação pelo AltServer, Face ID, Keychain, câmera (QR) e HTTPS via Tailscale funcionando no build re-assinado.

---

## 16. Limitações de desenvolver iOS no Windows — `CONFIRMADO`

| Possível no Windows | Impossível no Windows |
|---|---|
| Todo o código TS/React Native | Compilar binário iOS (Xcode/SDK só macOS) |
| Metro bundler + hot reload no iPhone via dev client | iOS Simulator |
| Testes unitários (Jest), lint, typecheck | Debug nativo Swift/ObjC (LLDB do Xcode) |
| Instalar IPA via AltServer | Instruments/profiling nativo |
| Escrever config plugins Expo | Ver erros de build nativo localmente (só nos logs do CI) |

Consequência de processo: **minimizar código nativo próprio.** Preferir bibliotecas Expo/RN mantidas; cada módulo nativo custom é um ciclo lento (push → CI macOS → download → sideload).

---

## 17. Processo de signing — `EXTERNO`

- **Conta gratuita (Personal Team):** perfil de provisionamento expira em **7 dias**; até **3 apps** por dispositivo; **10 App IDs** que expiram em 7 dias; sem Push, iCloud, App Groups, Associated Domains, etc.
- Signing é feito **pelo AltServer** (ou SideStore) no momento da instalação/refresh, com o Apple ID do usuário. O pipeline do Pulse nunca toca no Apple ID.
- **Pulse nunca armazena a senha da Apple Account.** Ela é digitada apenas no AltServer/SideStore.
- **Alternativa paga (US$ 99/ano):** perfis de 1 ano, EAS Build funciona direto do Windows, Push disponível. Ver § 32.

---

## 18. Processo de sideloading — `EXTERNO`

**AltStore Classic / AltServer para Windows** (documentação oficial):
- Requer Windows 10+ e **iTunes e iCloud baixados diretamente da Apple, não da Microsoft Store**.
- AltServer roda como administrador; primeira instalação via cabo, depois "Wi-Fi sync".
- iOS 16+: habilitar **Developer Mode** no iPhone; confiar no perfil em *Ajustes → Geral → VPN e Gerenciamento de Dispositivos*.
- Sideload direto de `.ipa` pelo AltServer: Shift + clique no ícone → "Sideload .ipa…".

**SideStore** (alternativa): computador (Windows 8+ suportado) **só na instalação inicial**; refresh feito no próprio iPhone com o app LocalDevVPN ligado.

Pulse **não** contém lógica de AltStore/SideStore (requisito). Integração não documentada é proibida.

---

## 19. Renovação da assinatura pessoal — `EXTERNO`

- Apps expiram em 7 dias e deixam de abrir.
- AltStore: "Refresh All" manual ou background refresh, com AltServer acessível na mesma rede Wi-Fi. Como o PC do Pulse está sempre ligado, ele é o AltServer natural.
- SideStore: refresh no próprio iPhone.

O que Pulse pode monitorar **de forma confiável** (sem integração não documentada):
- **Core:** se o processo `AltServer.exe` está rodando (lista de processos) → alerta "AltServer parado".
- **Mobile:** o app pode tentar ler a data de expiração do perfil embutido no próprio bundle (`embedded.mobileprovision`) e reportá-la ao Core → alerta "Pulse Mobile expira em 2 dias". **`POC`** — confirmar que o arquivo existe após re-assinatura do AltServer.

Gestão dos 3 slots: o Pulse ocupa **um** (release e dev client compartilham o bundle ID e se substituem). Falta confirmar se o próprio AltStore conta como slot.

---

## 20. Partes que obrigatoriamente exigem macOS — `EXTERNO`

1. Compilar o binário iOS (`xcodebuild`) — Xcode só existe para macOS.
2. `pod install` com resolução nativa (CocoaPods roda em outros sistemas, mas o build não).
3. Ler erros de compilação nativa / debug nativo.

**Não** exigem macOS: assinatura (AltServer/SideStore assinam no Windows/iPhone), instalação, refresh, todo o desenvolvimento JS.

---

## 21. Alternativas gratuitas para as etapas macOS — `EXTERNO`

| Opção | Custo | Observação |
|---|---|---|
| **GitHub Actions, repo público** | Runners padrão gratuitos em repo público | Código do Pulse fica público (sem segredos no repo, por design). **Recomendado se aceitável.** |
| **GitHub Actions, repo privado** | Cota de minutos do plano Free (2.000/mês); macOS custa ~10× o Linux por minuto | Builds nativos só quando deps nativas mudam; viável mas apertado. |
| EAS Build (plano gratuito) | Grátis para build, mas **dispositivo exige conta Apple paga** | Só útil se migrar para conta paga. |
| Mac emprestado / alugado | Variável | Só para emergência; não é dependência permanente. |
| VM macOS em hardware não-Apple | — | **Não recomendado**: viola a licença da Apple. |

Outros serviços de CI com macOS gratuito existem, mas não verifiquei a documentação deles nesta pesquisa — não os listo como opção.

---

## 22. Threat model — `CONFIRMADO` (modelo) / revisão contínua

**Ativos:** controle do PC (energia, processos), código e segredos dos projetos, sessões Claude Code (créditos e acesso a repos), API key de IA, cookies/sessões do navegador, dados pessoais, histórico/audit.

| # | Ameaça | Mitigação |
|---|---|---|
| T1 | iPhone perdido/roubado **desbloqueado** | Face ID em ações sensíveis; tokens `THIS_DEVICE_ONLY`; revogação no Desktop; Lockdown Mode. |
| T2 | iPhone roubado bloqueado | Keychain inacessível; revogar no Desktop. |
| T3 | Outro dispositivo comprometido no tailnet | ACL Tailscale limitando origem; token por dispositivo obrigatório; rate limit. |
| T4 | QR de pareamento fotografado | TTL 120 s, uso único, código de comparação, aprovação manual no Desktop. |
| T5 | Processo local malicioso no Windows | Fora do escopo total de defesa (mesmo usuário = mesmo privilégio). Mitigar: pipe com ACL de SID, nenhum segredo em arquivo plano, Credential Manager. |
| T6 | Serve mal configurado expondo canal admin | Canal admin só por named pipe; listener remoto só aceita tokens de dispositivo. |
| T7 | Funnel ligado por engano (exposição à Internet) | Core detecta requests sem headers de identidade Tailscale e registra alerta; documentação proíbe Funnel. |
| T8 | **Prompt injection** via conteúdo de páginas, títulos de abas, arquivos de repositório, logs | Echo só executa READ automaticamente; ações CONFIRM/CRITICAL exigem aprovação humana; Echo **não tem** ferramentas de terminal, delete ou shell. Conteúdo externo marcado como não confiável no prompt. |
| T9 | Vazamento de segredos para o provider de IA | Context Builder mínimo + Redaction + denylist de arquivos (§ 26). |
| T10 | Hook do Claude Code falsificado | `pulse-hook.exe` fala só pelo pipe; token por sessão injetado no ambiente da sessão. |
| T11 | Extensão maliciosa falando com o host | `allowed_origins` do Native Messaging com ID fixo da extensão Pulse (sem wildcard, por regra do Chrome). |
| T12 | Abuso de ações destrutivas via Trigger | Triggers rodam como principal `system:trigger` com teto SAFE_ACTION, salvo aprovação explícita no Desktop por ação. Proteção contra loop. |
| T13 | Replay de requests | TLS; `confirmation_id` uso único; tokens de curta duração. |
| T14 | Build do app adulterado | App só confia no Core por HTTPS com hostname do QR; políticas (Face ID obrigatório, Lockdown) aplicadas **no Core**. |

---

## 23. Armazenamento de secrets no Windows — `CONFIRMADO`

- **Windows Credential Manager** via crate `keyring` (protegido por DPAPI, escopo do usuário): API keys de IA, segredo-mestre do Core.
- SQLite guarda **referências** (`secret_ref`), nunca valores.
- Tokens de dispositivo: só hashes no SQLite.
- Credenciais do Claude Code: **gerenciadas pelo próprio Claude Code** dentro de cada `CLAUDE_CONFIG_DIR`; Pulse não lê nem copia.
- Logs passam pelo mesmo Redaction (§ 26) antes de persistir.
- Alternativa: plugin Stronghold do Tauri. Descartado para o Core porque o Core não é Tauri.

---

## 24. Sistema de permissões — `CONFIRMADO`

**Action Registry** (em `pulse-protocol`): cada ação declara:

```
id: "control.power.restart"
module: control
level: CONFIRM            # READ | SAFE_ACTION | CONFIRM | CRITICAL
params_schema: {...}
remote_allowed: true      # pode vir do iPhone?
echo_allowed: false       # Echo pode propor?
trigger_allowed: false    # Trigger pode executar?
face_id_scope: "power"    # se aplicável
```

**Pipeline de autorização (sempre no Core):**

```
autenticação → dispositivo ativo? → Lockdown? → rate limit
 → nível da ação vs. grants do dispositivo
 → READ/SAFE_ACTION: executa
 → CONFIRM: retorna confirmation_id; cliente confirma (UI nativa)
 → CRITICAL: confirmation_id + gate biométrico (se configurado) ou bloqueado remotamente
 → executa → audit (timestamp, device, module, action, params relevantes redigidos,
                    permission_level, result, duration)
```

**Lockdown Mode** (no Core, por dispositivo ou global): só READ; terminal bloqueado; CRITICAL bloqueado; Echo não executa ações; monitoramento continua.

**Tensão na especificação — precisa ficar explícita:** "não disponibilizar shell arbitrário pela API pública" × "Terminal remoto". Proposta: terminal remoto é **desligado por padrão**, habilitado por dispositivo no Desktop, nível CRITICAL, Face ID obrigatório, sessões só em diretórios de projetos registrados, auditado (abertura/fechamento; conteúdo não é gravado no audit), **nunca** disponível ao Echo nem ao Trigger. Se preferir, o MVP pode ter terminal remoto **somente leitura** (ver saída), sem input.

---

## 25. Comunicação Echo → AI Provider — `CONFIRMADO` (arquitetura) / `EXTERNO` (APIs)

```
Mobile → Core: {prompt, context_request?, conversation_id}
Core: Context Builder → Redaction → AIProvider (trait) → stream → Mobile
```

- `trait AIProvider { chat_stream(req) ; models() ; capabilities() }` — implementações `AnthropicProvider`, `OpenAIProvider`, `GeminiProvider` **depois do MVP**.
- Formato interno de tool-calling próprio do Pulse; cada provider traduz. Ferramentas = subconjunto do Action Registry com `echo_allowed: true`.
- READ: executadas automaticamente. SAFE_ACTION: configurável. CONFIRM/CRITICAL: o Echo **propõe**, o Mobile mostra card de aprovação (Face ID se CRITICAL), o Core executa.
- Chamadas saem **exclusivamente do Core**. A API key nunca vai ao iPhone.
- Histórico: provider, model, tokens in/out, custo estimado (tabela de preços **configurável pelo usuário**, não embutida), ferramentas usadas.
- Pulse continua 100% funcional sem key configurada.
- As APIs e modelos de cada provider serão verificados na documentação oficial no momento da implementação (Milestone Echo), não agora.

---

## 26. Redaction de secrets — `CONFIRMADO` (abordagem) / `POC` (taxa de acerto)

Camadas, nesta ordem:

1. **Denylist de arquivos** — nunca lidos para contexto: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*.pfx`, `*.p12`, `.npmrc`, `.pypirc`, `credentials*`, `.aws/`, `.ssh/`, `.git-credentials`, perfis de navegador.
2. **Padrões conhecidos** — regras estilo gitleaks: prefixos de chaves de providers, JWT, `Authorization:`/`Cookie:`/`Set-Cookie:`, `-----BEGIN … PRIVATE KEY-----`, connection strings (`postgres://user:pass@`), `password=`/`secret=`/`token=` em configs.
3. **Entropia** — strings longas de alta entropia em contexto de atribuição.
4. **Substituição tipada**: `‹REDACTED:jwt#3›`, mantendo consistência na conversa.
5. **Política de persistência**: se algo foi detectado, o prompt original **não é armazenado**; só a versão redigida + metadados (tipos detectados, contagem).
6. **Volume**: acima de N arquivos/KB de logs, Core exige aprovação explícita mostrando o que será enviado.

Redaction é *best effort* — a defesa principal é o Context Builder enviar o mínimo. `POC`: corpus de teste com segredos falsos para medir falsos negativos.

---

## 27. Integração Browser — `CONFIRMADO` (abordagem) / `EXTERNO` / `POC`

**Descartado:** `--remote-debugging-port`. Desde o Chrome 136 a flag é ignorada no diretório de dados padrão (exige `--user-data-dir` não padrão) — ou seja, não controlaria seu navegador real.

**Proposto:** extensão MV3 "Pulse Browser" + **Native Messaging**:

```
Extensão (Chrome/Edge) ⇄ stdio ⇄ pulse-browser-host.exe ⇄ named pipe ⇄ Core
```

- `chrome.runtime.connectNative` mantém o host vivo enquanto a porta existir.
- Manifesto registrado em `HKCU\Software\Google\Chrome\NativeMessagingHosts\<nome>`; `allowed_origins` com ID fixo da extensão (sem wildcard).
- Limites: host → extensão **1 MB por mensagem**; extensão → host 64 MiB. Screenshots precisam ser fatiados ou reduzidos.
- APIs de extensão para: listar abas/janelas, ativar, reload, back/forward, fechar, abrir URL, capturar a aba visível (`captureVisibleTab` — só a aba ativa de uma janela).
- **Edge:** suporta Native Messaging com chave de registro própria — **verificar na documentação Microsoft na implementação** (`EXTERNO`).
- **Console/Network:** só via `chrome.debugger`, que mostra uma barra "está depurando este navegador" ao usuário. → `FORA DO MVP` / `POC`.
- Instalação pessoal: extensão carregada como *unpacked* (modo desenvolvedor) ou empacotada localmente.
- Extensão não lê cookies nem conteúdo de páginas no MVP; só metadados de abas.

---

## 28. Claude Code com duas contas/sessões — `EXTERNO` + `POC`

Usando **somente** mecanismos documentados:

- **Perfil de conta = um `CLAUDE_CONFIG_DIR`.** Documentado: a variável move settings, plugins, logs e transcripts; é lida só do ambiente na inicialização. Ex.: `%LOCALAPPDATA%\Pulse\claude\pessoal`, `…\trabalho`.
  - **POC:** confirmar no Windows que as **credenciais** de login também ficam isoladas por `CLAUDE_CONFIG_DIR` (a documentação garante settings/transcripts; credenciais precisam de teste). `claude auth status` retorna JSON com `configDirectory` e `authMethod` — usaremos para verificar o perfil.
  - Login: o usuário executa `claude auth login` num PTY do Pulse. Pulse **nunca** vê a senha.
  - Alternativa documentada: `CLAUDE_CODE_OAUTH_TOKEN` (gerado por `claude setup-token`) — Pulse guardaria no Credential Manager. Só se você quiser.
- **Sessão gerenciada** = processo `claude` interativo dentro de um **PTY** do Pulse, com `cwd` = worktree e env do perfil. Flags documentadas úteis: `--name`, `--session-id <uuid>` (Pulse define o ID), `--settings <json>`, `--worktree`, `--resume`.
- **Worktrees:** Pulse cria via `git worktree add` (controle total) ou usa `claude -w` (cria em `<repo>/.claude/worktrees/<nome>`). Recomendo Pulse criar, para o DevOS conhecer a árvore.
- **Status em tempo real:** hooks documentados injetados via `--settings` (sem tocar nos settings do usuário): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`. Hook do tipo *command* chama `pulse-hook.exe`, que lê o JSON do stdin (`session_id`, `cwd`, `hook_event_name`, …) e envia pelo pipe. Hooks HTTP também são suportados, mas exigiriam outro listener TCP — evitar.
  - Estados derivados: `working`, `waiting_permission`, `idle`, `ended`.
- **Não parsear** `~/.claude/projects/*.jsonl`: documentado como formato interno que muda entre versões.
- **View Terminal:** stream do PTY (somente leitura no mobile por padrão). **View Git Changes / Worktree:** via módulo Git do DevOS. **Create Handoff:** documento gerado pelo Pulse (diff, commits, arquivos, timeline); opcionalmente `claude -p --resume <id> "resuma…" --output-format json` — **consome créditos da conta**, então só sob ação explícita.
- Pulse **não** apresenta Claude Code como agente interno: UI rotula "Claude Code — conta X".
- Claude Code tem o recurso próprio *Remote Control* (claude.ai/app). É independente do Pulse; não integramos.

---

## 29. PTY / terminal — `CONFIRMADO` (Core) / `POC` (render mobile)

- Core: `portable-pty` (ConPTY). Shells permitidos por allowlist (`pwsh`, `powershell`, `cmd`, Git Bash) + `claude`.
- Saída em ring buffer por sessão (ex.: 1 MB); stream via WS com backpressure; resize suportado.
- **Mobile:** não há emulador de terminal nativo maduro para RN. Proposta: **xterm.js dentro de `react-native-webview`** (componente local, sem carregar URL externa; isso **não** é PWA — é uma view dentro do app nativo). Barra de atalhos touch (Ctrl, Esc, Tab, setas, Ctrl+C), copiar/colar nativos, histórico de comandos. `POC` para teclado iOS + performance.
- Desktop: xterm.js direto.

---

## 30. Trigger / Event Bus — `CONFIRMADO`

**Event Bus:**
- In-process: `tokio::sync::broadcast` por tópico.
- Persistência: eventos relevantes vão para `events` (append-only, `seq`), alimentando WS (`since`), timeline e Triggers. Eventos de alta frequência (métricas a cada segundo) **não** são persistidos; só amostras agregadas.
- Envelope: `{seq, ts, topic, source, severity, payload, correlation_id}`.
- Tópicos iniciais: `system.*`, `process.*`, `project.*`, `git.*`, `browser.*`, `claude.*`, `trigger.*`, `device.*`, `audit.*`.

**Trigger:**
- `Trigger = quando (evento + filtro | cron | manual) → condições → ações[]`.
- Ações = mesmo Action Registry (`trigger_allowed: true`), executadas como principal `system:trigger`.
- Teto padrão SAFE_ACTION; ação mais alta exige aprovação no Desktop ao salvar.
- Proteções: debounce, máximo de execuções/minuto, detecção de loop (cadeia de `correlation_id`).
- Histórico em `trigger_runs`.
- Editor avançado só no Desktop; Mobile: listar, enable/disable, executar manualmente, histórico.

---

## 31. Modelo de dados SQLite (rascunho)

WAL mode, migrations versionadas, `foreign_keys=ON`.

```
devices(id, name, model, status[pending|active|revoked], paired_at, last_seen_at,
        grants_json, policy_json)               -- policy: require_face_id_*, lockdown
device_tokens(id, device_id, kind[access|refresh], token_hash, expires_at,
              rotated_from, revoked_at)
pairing_sessions(id, secret_hash, expires_at, state, device_draft_json)
audit_log(id, ts, principal, device_id, module, action, params_redacted_json,
          permission_level, result, error, duration_ms, confirmation_id)
events(seq, ts, topic, source, severity, payload_json, correlation_id)
projects(id, name, root_path, git_remote, created_at, settings_json)
project_services(id, project_id, name, command_ref, cwd, env_ref, autostart)
project_sessions(id, project_id, started_at, ended_at, branch, notes)   -- "onde parei"
service_runs(id, service_id, pid, started_at, ended_at, exit_code, log_path)
triggers(id, name, enabled, spec_json, max_level, created_at, updated_at)
trigger_runs(id, trigger_id, started_at, ended_at, result, detail_json)
claude_profiles(id, name, config_dir)
claude_sessions(id, profile_id, project_id, worktree_path, claude_session_id,
                status, started_at, ended_at, pty_id)
terminal_sessions(id, kind, shell, cwd, opened_by_device, opened_at, closed_at)
allowed_paths(id, path, kind[project|download|custom], read, write)
allowed_apps(id, name, exe_path, level)
ai_providers(id, kind, label, secret_ref, default_model, price_table_json)
echo_conversations(id, device_id, created_at, title)
echo_messages(id, conversation_id, role, content_redacted, redaction_meta_json,
              provider, model, tokens_in, tokens_out, est_cost, tools_json, ts)
settings(key, value_json)
```

Comandos de serviços de projeto são **estruturados e cadastrados no Desktop** (`command_ref`), nunca recebidos como string do mobile.

---

## 32. Decisões pendentes (preciso da sua escolha)

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| D1 | Conta Apple | (a) gratuita: 7 dias, 3 apps, sem Push · (b) paga US$ 99/ano: 1 ano, EAS direto do Windows, Push possível | ✅ **Decidido: (a) gratuita** (2026-10-04) |
| D2 | Onde compilar iOS | (a) GitHub Actions repo **público** (grátis ilimitado) · (b) repo privado (cota de minutos) · (c) EAS (só com D1=b) | ✅ **Decidido: (a) repo público** (2026-10-04) |
| D3 | Processo do Core | (a) processo separado + named pipe · (b) Core embutido no Tauri (mais simples, morre com a UI) | ✅ **Decidido: (a)** (2026-10-04) |
| D4 | Transporte remoto | (a) Tailscale Serve HTTPS (nome da máquina vai ao log CT) · (b) HTTP no IP 100.x + TLS próprio + pinning + exceção ATS | (a) |
| D5 | Contratos Rust→TS | (a) `ts-rs` (tipos) · (b) OpenAPI via `utoipa` + gerador TS · (c) JSON Schema via `schemars` | (a) + validação leve no client |
| D6 | SQLite em Rust | (a) `rusqlite` (síncrono, simples) · (b) `sqlx` (async, checagem em compile-time) | (a) com pool `spawn_blocking` |
| D7 | Terminal remoto no MVP | (a) desligado · (b) somente leitura · (c) interativo com Face ID | (b) no MVP, (c) depois |
| D8 | Refresh do app | (a) AltStore + AltServer no PC · (b) SideStore (refresh no iPhone) | (a), PC já fica ligado |

---

## 33. Milestones

Ordem guiada por **risco primeiro** e por *vertical slice* executável a cada etapa.

### M0 — Fundações (Windows)
Monorepo (pnpm + Cargo), CI Windows (fmt, clippy, test, tsc, eslint), `pulse-core` com SQLite + migrations + audit, named pipe, Desktop Tauri mostrando "Core conectado" e eventos de heartbeat.
**Pronto quando:** `pnpm dev` sobe Desktop + Core e você vê o heartbeat ao vivo.

### M1 — POC do pipeline iOS (gate do projeto)
App Expo mínimo (tela, câmera QR, Face ID, SecureStore, fetch HTTPS) → workflow macOS gerando IPA não assinado (dev client e release) → sideload pelo AltServer no Windows → Metro no PC servindo JS ao iPhone → validar Keychain após refresh, leitura de `embedded.mobileprovision`, contagem de slots.
**Pronto quando:** o app abre no seu iPhone, faz Face ID e chama um endpoint do Core via Tailscale Serve.
**Se falhar:** decidir D1/D2 antes de continuar.

**✅ Concluído em 2026-10-04** (iPhone 15, conta Apple gratuita, Windows 11):

| Item | Resultado |
|---|---|
| IPA não assinado no GitHub Actions (macOS) | ✅ release 7 min / 8,4 MB · dev client 4 min / 18,2 MB |
| Sideload pelo AltServer no Windows | ✅ (ver "Lições" abaixo) |
| `embedded.mobileprovision` legível pelo app | ✅ validade de 7,0 dias + nome do time |
| Keychain persiste entre aberturas | ✅ |
| Face ID em build com assinatura gratuita | ✅ |
| Câmera / QR | ✅ |
| Dev client carregando JS do Metro no Windows | ✅ |
| HTTPS iPhone → Tailscale Serve → Core (`/v1/health`) | ✅ sem exceção ATS |
| Keychain após Refresh do AltStore | ⏳ acompanhar no 1º refresh (sinal positivo: valor gravado antes de uma reinstalação continuou lá) |
| Slots: o AltStore conta como 1 dos 3? | ⏳ verificar em *My Apps* |

**Lições do setup no Windows:**
- O app **Apple Devices** (Microsoft Store) estava instalado e o **Apple Mobile Device Support** não existia. Foi preciso desinstalar o Apple Devices e reinstalar o iTunes do site da Apple.
- Mesmo assim, o iPhone ficou com o driver genérico da Microsoft (`wpdmtp.inf`, "câmera"). O driver **Apple Mobile Device USB** (Windows Update, `Apple, Inc. - USBDevice - 538.0.0.0`) não aparecia na tela de atualizações opcionais e foi instalado pela API do Windows Update.
- `tailscale serve` deve apontar para `http://127.0.0.1:<porta>` (o Core escuta só em IPv4 loopback).

### M2 — Vertical slice remota
Listener remoto + Tailscale Serve, pairing com QR e código de comparação, tokens com rotação, revogação, rate limit, WS com `since`/reconexão, Settings → Devices (Desktop e Mobile). Home mobile com CPU/RAM/rede ao vivo e estado "PC Offline".
**Pronto quando:** pareia, vê métricas ao vivo, desliga o Wi-Fi do PC e o iPhone mostra "PC Offline" com "Última atualização".

**Implementado em 2026-10-04** (falta validar no iPhone real):

| Peça | Onde | Verificado por |
|---|---|---|
| Pareamento QR + HMAC + código de 6 dígitos | `pulse-core/src/pairing.rs`, `packages/client/src/pairing.ts` | testes unitários; vetor fixo idêntico em Rust, TS e Python |
| Tokens (acesso 15 min, renovação 30 dias com rotação, reuso ⇒ revogação, janela de 30 s para corrida legítima) | `pulse-core/src/auth.rs` | testes unitários |
| API remota + rate limit por origem/dispositivo | `pulse-core/src/remote_api.rs`, `rate_limit.rs` | teste do fluxo HTTP completo |
| Stream WS (auth na 1ª mensagem, replay da auditoria por `sinceAuditId`, ping 20 s, fechamento 4401/4403) | `remote_api.rs`, `packages/client/src/stream.ts` | teste com WebSocket real |
| Detecção do endereço e do `tailscale serve` (somente leitura) | `pulse-core/src/tailscale.rs` | E2E |
| Desktop: Dispositivos, QR, aprovação com código, revogação | `apps/desktop` | UI dirigida por script + `phone-sim` |
| Mobile: Expo Router, abas, pareamento, Home ao vivo, offline com cache, Dispositivos, desparear | `apps/mobile/src/app` | typecheck + bundle iOS |
| E2E pelo Tailscale Serve real (HTTPS/WSS) | `pnpm --filter @pulse/client e2e` | passou |

Decisões tomadas na implementação:
- Sessões de pareamento ficam só em memória (restart do Core invalida QRs abertos).
- Tokens de dispositivo: só o SHA-256 no SQLite (`device_tokens`); sessão no iPhone em um item do Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
- Cache de exibição no iPhone em arquivo comum (sem segredos), sempre com "Última atualização".
- Em segundo plano o app fecha o stream; ao voltar, reconecta na hora.
- Permissão inicial de todo dispositivo pareado: `READ`. Ações chegam no M3.

### M3 — Control + Permissões
Action Registry, pipeline de autorização, confirmações, SecurityGate (Face ID), toggles "Require Face ID…", Lockdown Mode. Ações: apps permitidos, processos, fechar app, screenshot, bloquear, suspender, reiniciar, desligar. GPU e serviços (leitura) conforme POC.

### M4 — DevOS
Projetos, serviços de projeto (start/stop/restart, logs), sessões de trabalho, "onde parei", Git básico (status, branch, últimos commits, arquivos modificados). Tela Projects/Project Detail no mobile.

### M5 — Browser básico
Extensão MV3 + `pulse-browser-host`, abas (listar, ativar, reload, back/forward, fechar, abrir URL, screenshot da aba ativa), "Enviar URL para PC". Chrome primeiro; Edge após verificar a documentação.

### M6 — Trigger básico
Event Bus persistido, Trigger engine (evento/cron/manual), editor no Desktop, lista/enable/disable/run/histórico no mobile.

### M7 — Files (leitura) + polimento Mobile
Diretórios autorizados, browse/preview/search/download; upload. Operações destrutivas com CRITICAL. Cache offline, Dynamic Type, haptics, alertas in-app, ações rápidas configuráveis na Home.
**Fim do MVP sem IA.**

### M8 — Claude Code + Terminal
POC de credenciais por `CLAUDE_CONFIG_DIR`, perfis, sessões em PTY, worktrees, hooks via `pulse-hook`, status ao vivo, View Terminal (xterm.js em WebView), Git changes, Handoff. Terminal remoto conforme D7.

### M9 — Echo
`AIProvider` + primeiro provider (escolhido por você), Context Builder, Redaction com corpus de testes, tool-calling restrito, aprovações no mobile, histórico com tokens/custo.

### M10 — Hardening
Revisão do threat model, testes de fuzz nos parsers do pipe/WS, prova biométrica via Secure Enclave (se viável), backup/export do SQLite.

---

## Fontes

- Expo — Development builds (conta paga para builds em dispositivo; Xcode local como único caminho gratuito): https://docs.expo.dev/develop/development-builds/introduction/
- Expo — EAS Build setup: https://docs.expo.dev/build/setup/
- Expo — LocalAuthentication (Face ID fora do Expo Go): https://docs.expo.dev/versions/latest/sdk/local-authentication/
- Expo — SecureStore: https://docs.expo.dev/versions/latest/sdk/securestore/
- Apple — comparação de contas de desenvolvedor: https://developer.apple.com/support/compare-memberships/
- AltStore — Getting Started (7 dias, 3 apps): https://faq.altstore.io/altstore-classic/your-altstore
- AltStore — Instalação no Windows: https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows
- SideStore — Prerequisites: https://docs.sidestore.io/docs/installation/prerequisites
- Tailscale — Serve: https://tailscale.com/kb/1312/serve
- Tailscale — HTTPS certificates: https://tailscale.com/kb/1153/enabling-https
- Tailscale — Unattended mode: https://tailscale.com/kb/1088/run-unattended
- GitHub — Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Chrome — Mudança do remote debugging (Chrome 136): https://developer.chrome.com/blog/remote-debugging-port
- Chrome — Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Tauri 2 — Sidecar: https://v2.tauri.app/develop/sidecar/
- Claude Code — Env vars: https://code.claude.com/docs/en/env-vars
- Claude Code — CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code — Hooks: https://code.claude.com/docs/en/hooks
- Claude Code — Sessions (formato JSONL interno): https://code.claude.com/docs/en/sessions
