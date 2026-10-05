// SecurityGate: Face ID reutilizável para ações sensíveis.
//
// Uma aprovação vale por uma janela curta e só para o mesmo escopo, para não
// pedir Face ID repetidamente dentro de uma mesma operação (ex.: terminal
// aberto). Escopos diferentes nunca compartilham aprovação.
//
// Limitação (docs/ARCHITECTURE.md §10): o Core não tem como verificar o Face ID;
// ele confia na declaração do app. Protege contra uso casual do iPhone
// desbloqueado, não contra um app adulterado.

import * as LocalAuthentication from "expo-local-authentication";

export type GateScope = "power" | "terminal" | "fileDeletion" | "echoCritical" | "securitySettings" | "critical";

const WINDOW_MS = 60_000;
const approvedAt = new Map<GateScope, number>();

export async function requireFaceId(scope: GateScope, reason: string): Promise<boolean> {
  const last = approvedAt.get(scope);
  if (last && Date.now() - last < WINDOW_MS) return true;

  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: "Cancelar",
    // Sem Face ID cadastrado, o iOS cai para o código do iPhone.
    disableDeviceFallback: false,
  });
  if (!res.success) return false;
  approvedAt.set(scope, Date.now());
  return true;
}

/** Esquece aprovações (ex.: app foi para segundo plano). */
export function resetGate(): void {
  approvedAt.clear();
}
