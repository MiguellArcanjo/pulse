# Instalar o Morph no iPhone (sem Mac, conta Apple gratuita)

Fluxo: **GitHub compila** um IPA não assinado → **AltServer no Windows assina** com o seu
Apple ID e instala → o app vale **7 dias** e é renovado pelo AltStore.

O Morph nunca vê nem guarda a senha do seu Apple ID. Ela só é digitada no AltServer.

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

## 3. Baixar o IPA do Morph

1. Abra **https://github.com/MiguellArcanjo/pulse/actions/workflows/ios-build.yml**.
2. Clique na execução mais recente com ✅.
3. Em **Artifacts**, baixe:
   - `morph-ios-release` → app normal, para uso diário;
   - `morph-ios-dev-client` → app de desenvolvimento, que carrega o código do PC (seção 5).
4. Descompacte o `.zip`; dentro está o `Morph-….ipa`.

Para gerar um build novo manualmente: mesma página → **Run workflow**.

## 4. Instalar o IPA

Bandeja → segure **Shift** e clique no ícone do AltServer → **Sideload .ipa…** →
escolha o iPhone → selecione o `.ipa` → informe o Apple ID.

O Morph usa um bundle ID próprio (`dev.morph.mobile`), então ocupa um slot separado do
antigo Pulse. Se faltar slot, apague o Pulse do iPhone.

## 5. Desenvolvimento com o dev client (hot reload)

Com o `morph-ios-dev-client` instalado, o código TypeScript vem do seu PC. Não precisa
recompilar no GitHub a cada mudança de tela.

```bash
pnpm dev:mobile
```

Abra o Morph (dev client) no iPhone. Ele procura o servidor na rede; se não achar,
digite o endereço que o terminal mostrar. iPhone e PC precisam estar na mesma rede.

Na primeira vez, o Windows pode perguntar se o Node.js pode aceitar conexões: permita em
**redes privadas**. Sem isso, o iPhone não alcança o Metro (porta 8081).

Recompilar no GitHub só é necessário quando mudar dependências nativas (bibliotecas novas
ou `app.json`). O dev client precisa ter **todos** os módulos nativos que o código usa.

## 6. Renovação (a cada 7 dias)

- O app para de abrir quando a assinatura expira.
- Antes disso: abra o **AltStore** no iPhone → **My Apps** → **Refresh All**, com o
  AltServer rodando no PC e os dois na mesma rede Wi-Fi.

## Se o iPhone não aparece no iTunes/AltServer

Problemas encontrados no setup real (2026-10-04):

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
- **10 App IDs** a cada 7 dias. O Morph usa sempre o mesmo, então isso não costuma ser problema.
- **Sem notificações push e sem execução em segundo plano.** Tudo que precisa rodar sozinho
  (automações, agendamentos) roda no servidor, não no iPhone.
