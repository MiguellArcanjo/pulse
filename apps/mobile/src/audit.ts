// Rótulos das ações de auditoria (espelha apps/desktop/src/components/Activity.tsx).

import type { AuditItem } from "@pulse/protocol";
import type { IconName } from "./ui";

const ACTIONS: Record<string, { title: string; icon: IconName }> = {
  "core.started": { title: "Pulse Core iniciado", icon: "power" },
  "core.stopped": { title: "Pulse Core encerrado", icon: "power-outline" },
  "ipc.client_connected": { title: "Desktop conectado", icon: "desktop-outline" },
  "ipc.client_disconnected": { title: "Desktop desconectado", icon: "desktop-outline" },
  "pairing.created": { title: "QR de pareamento gerado", icon: "qr-code-outline" },
  "pairing.claimed": { title: "iPhone leu o QR", icon: "phone-portrait-outline" },
  "pairing.claim_rejected": { title: "Pareamento com prova inválida", icon: "shield-outline" },
  "pairing.denied": { title: "Pareamento recusado", icon: "close-circle-outline" },
  "device.paired": { title: "Dispositivo autorizado", icon: "phone-portrait-outline" },
  "device.revoked": { title: "Acesso revogado", icon: "shield-outline" },
  "device.grants_changed": { title: "Permissões alteradas", icon: "key-outline" },
  "pairing.code_rejected": { title: "Código de pareamento errado", icon: "close-circle-outline" },
  "control.app.launch": { title: "App aberto", icon: "play-circle-outline" },
  "control.app.close": { title: "App fechado", icon: "close-circle-outline" },
  "control.process.kill": { title: "Processo encerrado", icon: "stop-circle-outline" },
  "control.screenshot": { title: "Screenshot", icon: "camera-outline" },
  "control.power.lock": { title: "PC bloqueado", icon: "lock-closed-outline" },
  "control.power.suspend": { title: "PC suspenso", icon: "moon-outline" },
  "control.power.restart": { title: "Reinício do PC", icon: "refresh-outline" },
  "control.power.shutdown": { title: "Desligamento do PC", icon: "power-outline" },
  "control.allowed_app.added": { title: "App permitido", icon: "checkmark-circle-outline" },
  "control.allowed_app.removed": { title: "App removido da lista", icon: "remove-circle-outline" },
  "security.lockdown.enable": { title: "Lockdown ativado", icon: "shield-half-outline" },
  "security.policy_changed": { title: "Segurança alterada", icon: "shield-checkmark-outline" },
};

const WHO: Record<string, string> = {
  system: "Sistema",
  "local:desktop": "Pulse Desktop",
  "remote:pairing": "Pareamento",
};

export function describeAudit(item: AuditItem): { title: string; icon: IconName; who: string } {
  const known = ACTIONS[item.action];
  const who = WHO[item.principal] ?? (item.principal.startsWith("device:") ? "iPhone" : item.principal);
  return { title: known?.title ?? item.action, icon: known?.icon ?? "pulse-outline", who };
}
