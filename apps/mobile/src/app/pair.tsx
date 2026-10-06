import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@morph/client";
import { useMorph } from "../data/MorphProvider";
import { Tap, Txt } from "../design/primitives";
import { useTheme } from "../design/theme";
import { GUTTER, radius, space } from "../design/tokens";

/** Conectar o app ao servidor: endereço + código de pareamento (aparece no log do servidor). */
export default function Pair() {
  const morph = useMorph();
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState("https://");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const serverUrl = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/.test(serverUrl)) return setError("Endereço inválido.");
    setBusy(true);
    try {
      await morph.pair(serverUrl, code.trim());
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("Código inválido ou vencido. Gere outro no servidor.");
      else if (err instanceof ApiError && err.status === 429) setError("Muitas tentativas. Espere alguns minutos.");
      else if (err instanceof ApiError && err.offline) setError("Não foi possível falar com o servidor. Confira o endereço.");
      else setError("Algo deu errado. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { backgroundColor: colors.surfaceStrong, color: colors.text, borderColor: colors.border }];
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.root, { paddingTop: insets.top + space.xxl }]}>
        <Txt variant="title" style={{ letterSpacing: -0.5 }}>
          morph
        </Txt>
        <View style={{ gap: space.sm, marginTop: space.xxl }}>
          <Txt variant="largeTitle">Conectar ao servidor</Txt>
          <Txt tone="secondary">O código aparece no log do servidor e vale 15 minutos.</Txt>
        </View>
        <View style={{ gap: space.md, marginTop: space.xl }}>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://seu-app.herokuapp.com"
            placeholderTextColor={colors.textTertiary}
            style={input}
          />
          <TextInput
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABCDE-FGHJK"
            placeholderTextColor={colors.textTertiary}
            style={[input, styles.code]}
          />
          {error && (
            <Txt variant="footnote" tone="danger">
              {error}
            </Txt>
          )}
          <Tap
            onPress={busy || code.trim().length < 10 ? undefined : () => void submit()}
            style={[styles.button, { backgroundColor: accent.main, opacity: busy || code.trim().length < 10 ? 0.5 : 1 }]}
          >
            <Txt variant="headline" tone="onAccent">
              {busy ? "Conectando…" : "Conectar"}
            </Txt>
          </Tap>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: GUTTER },
  input: { height: 52, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, fontSize: 16 },
  code: { fontSize: 20, letterSpacing: 3, fontWeight: "600", textAlign: "center" },
  button: { height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: space.sm },
});
