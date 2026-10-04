import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeviceInfo } from "@pulse/protocol";

/** Dispositivos pareados, atualizados ao vivo pelo Core. */
export function useDevices(): DeviceInfo[] {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<DeviceInfo[]>("core://devices", (e) => setDevices(e.payload)).then((un) =>
      disposed ? un() : (unlisten = un),
    );
    void invoke<DeviceInfo[]>("devices").then((d) => !disposed && setDevices((cur) => (cur.length ? cur : d)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return devices;
}
