# Instalar o Pulse Mobile no iPhone (sem Mac, conta Apple gratuita)

Fluxo: **GitHub compila** um IPA não assinado → **AltServer no Windows assina** com o seu
Apple ID e instala → o app vale **7 dias** e é renovado pelo AltStore.

O Pulse nunca vê nem guarda a senha do seu Apple ID. Ela só é digitada no AltServer.

## 1. Preparar o Windows (uma vez)

Pela [documentação oficial do AltStore](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows):

1. Instale **iTunes** e **iCloud** baixados **direto do site da Apple** (não da Microsoft Store).
2. Baixe e instale o **AltServer para Windows** (link na página acima).
3. Abra o AltServer **como administrador**. Ele fica na bandeja do sistema.

## 2. Preparar o iPhone (uma vez)

1. Conecte o iPhone no PC pelo cabo e desbloqueie-o. Toque em **Confiar** se pedir.
2. No iTunes, abra o iPhone e ative **"Sincronizar com este iPhone via Wi-Fi"**.
3. Bandeja → ícone do AltServer → **Install AltStore** → escolha o iPhone → informe o Apple ID.
4. No iPhone: **Ajustes → Geral → VPN e Gerenciamento de Dispositivos** → toque no seu Apple ID → **Confiar**.
5. iOS 16+: **Ajustes → Privacidade e Segurança → Modo de Desenvolvedor** → ativar (o iPhone reinicia).

## 3. Baixar o IPA do Pulse

1. Abra **https://github.com/MiguellArcanjo/pulse/actions/workflows/ios-build.yml**.
2. Clique na execução mais recente com ✅.
3. Em **Artifacts**, baixe:
   - `pulse-ios-release` → app normal, para uso diário;
   - `pulse-ios-dev-client` → app de desenvolvimento, que carrega o código do PC (seção 5).
4. Descompacte o `.zip`; dentro está o `Pulse-….ipa`.

Para gerar um build novo manualmente: mesma página → **Run workflow**.

## 4. Instalar o IPA

Bandeja → segure **Shift** e clique no ícone do AltServer → **Sideload .ipa…** →
escolha o iPhone → selecione o `.ipa` → informe o Apple ID.

O ícone do Pulse aparece no iPhone.

## 5. Desenvolvimento com o dev client (hot reload)

Com o `pulse-ios-dev-client` instalado, o código TypeScript vem do seu PC. Não precisa
recompilar no GitHub a cada mudança de tela.

```bash
pnpm --filter @pulse/mobile start
```

Abra o Pulse (dev client) no iPhone. Ele procura o servidor na rede; se não achar,
digite o endereço que o terminal mostrar. iPhone e PC precisam estar na mesma rede
(Wi-Fi ou Tailscale).

Na primeira vez, o Windows pode perguntar se o Node.js pode aceitar conexões: permita em
**redes privadas**. Sem isso, o iPhone não alcança o Metro (porta 8081).

Recompilar no GitHub só é necessário quando mudar dependências nativas (bibliotecas novas
ou `app.json`).

## 6. Renovação (a cada 7 dias)

- O app para de abrir quando a assinatura expira.
- Antes disso: abra o **AltStore** no iPhone → **My Apps** → **Refresh All**, com o
  AltServer rodando no PC e os dois na mesma rede Wi-Fi.
- O card **Assinatura** do Pulse mostra quantos dias faltam.

## Se o iPhone não aparece no iTunes/AltServer

Problemas encontrados no setup real (M1):

1. **App "Apple Devices" da Microsoft Store instalado** → desinstale-o e reinstale o iTunes do
   site da Apple. Confirme em *Aplicativos instalados* que existe **Apple Mobile Device Support**
   e, em *Serviços*, **Apple Mobile Device Service** rodando.
2. **Windows usando o driver genérico** (o iPhone aparece só como "Apple iPhone", tipo câmera, no
   Gerenciador de Dispositivos) → instale o driver **Apple, Inc. - USBDevice** pelo Windows Update.
   Se ele não aparecer em *Atualizações opcionais*, rode no PowerShell **como administrador**:

   ```powershell
   $s = New-Object -ComObject Microsoft.Update.Session
   $r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
   $c = New-Object -ComObject Microsoft.Update.UpdateColl
   $r.Updates | Where-Object { $_.Title -match '^Apple' } | ForEach-Object { [void]$c.Add($_); "Selecionado: " + $_.Title }
   $d = $s.CreateUpdateDownloader(); $d.Updates = $c; [void]$d.Download()
   $i = $s.CreateUpdateInstaller(); $i.Updates = $c; $res = $i.Install()
   "Resultado: $($res.ResultCode)  (2 = sucesso)   Precisa reiniciar: $($res.RebootRequired)"
   ```

   Depois, o Gerenciador de Dispositivos deve mostrar **Apple Mobile Device USB Composite Device**.
3. **AltServer sem permissão** → feche-o e abra com *Executar como administrador*.

## Limites da conta gratuita

- No máximo **3 apps** instalados por sideloading ao mesmo tempo.
- Apps expiram em **7 dias**.
- **10 App IDs** a cada 7 dias. O Pulse usa sempre o mesmo, então isso não costuma ser problema.
- Sem notificações push.

---

## Checklist do M1 (o que precisamos confirmar no seu iPhone)

| # | Teste | Como | Resultado |
|---|---|---|---|
| 1 | Instala via AltServer | Seção 4 | |
| 2 | Abre sem travar | Abrir o app | |
| 3 | **Assinatura** lida | Card "Assinatura" mostra data e dias | |
| 4 | **Face ID** funciona | Card "Face ID" → Testar | |
| 5 | **Keychain** persiste ao fechar | Fechar o app (deslizar) e abrir: a data gravada não muda e o contador sobe | |
| 6 | **Keychain** persiste após Refresh | AltStore → Refresh All → abrir o Pulse: a mesma data continua | |
| 7 | **Câmera/QR** funciona | Card "Câmera / QR" → ler qualquer QR | |
| 8 | **Core via Tailscale** | Ver "Testar a conexão" abaixo | |
| 9 | Dev client carrega JS do PC | Seção 5 | |
| 10 | Quantos slots ocupa | AltStore → My Apps: AltStore conta como 1 dos 3? (o Pulse ocupa só 1: release e dev client se substituem) | |

### Testar a conexão com o Core (item 8)

1. Tailscale instalado e logado no PC e no iPhone, na mesma conta.
2. No painel do Tailscale, habilite **HTTPS Certificates** (Serve exige).
   ⚠️ O nome do PC passa a aparecer num log público de certificados; não use nome sensível.
3. Rode o Pulse no PC (`pnpm dev`). A API local de desenvolvimento fica em `127.0.0.1:47610`.
4. Publique-a no tailnet:

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:47610
   ```

5. `tailscale serve status` mostra o endereço `https://<pc>.<tailnet>.ts.net`.
6. No iPhone, cole esse endereço no card **Pulse Core via Tailscale** → **Testar conexão**.

Para desfazer: `tailscale serve reset`.
