import { router } from "expo-router";

/**
 * Abre uma tela da spec: /s/<id da tela>?<parâmetros>.
 * Caminho em texto, como na documentação do Expo Router
 * (https://docs.expo.dev/router/reference/url-parameters/).
 */
export function openScreen(screen: string, params: Record<string, string> = {}): void {
  // Montado à mão: o URLSearchParams do React Native é incompleto.
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  router.push(`/s/${encodeURIComponent(screen)}${query ? `?${query}` : ""}`);
}
