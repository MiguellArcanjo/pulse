import { router } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";
import { resolveOperand, type StoredRecord } from "@morph/engine";
import { describeError, useReady } from "../data/MorphProvider";
import { openScreen } from "./navigation";
import { useEvalContext } from "./scope";

/**
 * Dispara ações declaradas na spec. O nível de permissão é do engine:
 * navegar é READ; apagar registro é CONFIRM e sempre pergunta antes.
 */
export function useRunAction() {
  const { snapshot, deleteRecord } = useReady();
  const base = useEvalContext();

  return useCallback(
    (actionId: string, item?: StoredRecord) => {
      const action = snapshot?.spec.actions.find((a) => a.id === actionId);
      if (!action) return;
      const ctx = item ? { ...base, item } : base;

      switch (action.kind) {
        case "navigate": {
          const params: Record<string, string> = {};
          for (const [key, op] of Object.entries(action.params ?? {})) {
            const v = resolveOperand(op, ctx);
            if (typeof v === "string") params[key] = v;
          }
          openScreen(action.screen, params);
          return;
        }
        case "go_back":
          if (router.canGoBack()) router.back();
          return;
        case "delete_record": {
          const id = resolveOperand(action.record, ctx);
          if (typeof id !== "string") return;
          Alert.alert("Apagar?", "Esse registro será removido.", [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Apagar",
              style: "destructive",
              onPress: () => {
                deleteRecord(id).catch((err: unknown) => Alert.alert("Não apagado", describeError(err)));
              },
            },
          ]);
          return;
        }
      }
    },
    [snapshot, base, deleteRecord],
  );
}
