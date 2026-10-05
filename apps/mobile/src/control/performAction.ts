// Executa uma ação no PC seguindo o que o Core decidir:
// SAFE → executa; CONFIRM → confirmação nativa (+ Face ID se exigido) → executa.

import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { PulseApiError, type PulseClient } from "@pulse/client";
import type { Action, ActionResult, Confirmation } from "@pulse/protocol";
import { requireFaceId, type GateScope } from "../security/SecurityGate";

export type Outcome =
  | { kind: "done"; result: ActionResult }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const POWER_ACTIONS = new Set<Action["action"]>(["suspend", "restart", "shutdown"]);

function confirmNatively(c: Confirmation, destructive: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `${c.summary}?`,
      c.detail ?? undefined,
      [
        { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
        { text: "Confirmar", style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export async function performAction(client: PulseClient, action: Action): Promise<Outcome> {
  try {
    const first = await client.action({ ...action, confirmationId: null, faceIdVerified: false });
    if (first.status === "done") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { kind: "done", result: first.result };
    }

    const c = first.confirmation;
    const destructive = POWER_ACTIONS.has(action.action) || action.action === "processKill";
    if (!(await confirmNatively(c, destructive))) return { kind: "cancelled" };

    let faceIdVerified = false;
    if (c.faceId) {
      const scope: GateScope = POWER_ACTIONS.has(action.action) ? "power" : "critical";
      faceIdVerified = await requireFaceId(scope, c.summary);
      if (!faceIdVerified) return { kind: "cancelled" };
    }

    const second = await client.action({ ...action, confirmationId: c.id, faceIdVerified });
    if (second.status !== "done") return { kind: "error", message: "O PC pediu outra confirmação." };
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return { kind: "done", result: second.result };
  } catch (e) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    return { kind: "error", message: e instanceof PulseApiError || e instanceof Error ? e.message : String(e) };
  }
}
