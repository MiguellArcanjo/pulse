import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Action, ActionResult, ControlSnapshot, SecurityPolicy } from "@pulse/protocol";

const REFRESH_MS = 5000;

/** Foto do PC para a página Control, atualizada a cada 5 s enquanto ela está aberta. */
export function useControl(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await invoke<ControlSnapshot>("control_snapshot"));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { snapshot, error, refresh };
}

/** Política de segurança, atualizada ao vivo quando muda (Desktop ou iPhone). */
export function usePolicy(): [SecurityPolicy | null, (p: SecurityPolicy) => Promise<void>] {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SecurityPolicy>("core://policy", (e) => setPolicy(e.payload)).then((un) =>
      disposed ? un() : (unlisten = un),
    );
    void invoke<SecurityPolicy>("security_get")
      .then((p) => !disposed && setPolicy(p))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const update = useCallback(async (next: SecurityPolicy) => {
    setPolicy(await invoke<SecurityPolicy>("security_set", { policy: next }));
  }, []);

  return [policy, update];
}

export function runAction(action: Action): Promise<ActionResult> {
  return invoke<ActionResult>("run_action", { action });
}
