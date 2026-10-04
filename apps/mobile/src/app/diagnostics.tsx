import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import {
  type CheckResult,
  checkBiometrics,
  checkCore,
  checkKeychain,
  checkSigning,
  loadCoreUrl,
  saveCoreUrl,
} from "../checks";
import { colors } from "../theme";

type State = { running: boolean; result: CheckResult | null };
const idle: State = { running: false, result: null };

function useCheck(fn: () => Promise<CheckResult>) {
  const [state, setState] = useState<State>(idle);
  const run = useCallback(async () => {
    setState({ running: true, result: null });
    let result: CheckResult;
    try {
      result = await fn();
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    setState({ running: false, result });
    void Haptics.notificationAsync(
      result.ok
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
  }, [fn]);
  return [state, run] as const;
}

export default function Diagnostics() {
  const [coreUrl, setCoreUrl] = useState(loadCoreUrl);
  const [scanning, setScanning] = useState(false);
  const [lastQr, setLastQr] = useState<string | null>(null);

  const [bio, runBio] = useCheck(checkBiometrics);
  const [keychain, runKeychain] = useCheck(checkKeychain);
  const [signing, runSigning] = useCheck(checkSigning);
  const core = useCallback(() => checkCore(coreUrl), [coreUrl]);
  const [coreState, runCore] = useCheck(core);

  // Keychain e assinatura não têm efeito visível; rodam ao abrir.
  useEffect(() => {
    void runKeychain();
    void runSigning();
  }, [runKeychain, runSigning]);

  const onScanned = (data: string) => {
    setScanning(false);
    setLastQr(data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (/^https:\/\//i.test(data)) {
      setCoreUrl(data);
      saveCoreUrl(data);
    }
  };

  const version = Constants.expoConfig?.version ?? "?";

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Pulse Mobile v{version} · {__DEV__ ? "dev client" : "release"}
        </Text>

        <CheckCard
          title="Assinatura"
          hint="Validade do app instalado pelo AltServer."
          state={signing}
          action="Ler de novo"
          onRun={runSigning}
        />

        <CheckCard
          title="Keychain"
          hint="Valor gravado continua após fechar o app e após o Refresh do AltStore?"
          state={keychain}
          action="Ler de novo"
          onRun={runKeychain}
        />

        <CheckCard
          title="Face ID"
          hint="Autenticação biométrica num build com assinatura gratuita."
          state={bio}
          action="Testar Face ID"
          onRun={runBio}
        />

        <CheckCard
          title="Câmera / QR"
          hint="Leia qualquer QR. Se for um link https, vira o endereço do Core."
          state={{ running: false, result: lastQr ? { ok: true, detail: lastQr } : null }}
          action="Ler QR Code"
          onRun={() => setScanning(true)}
        />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pulse Core via Tailscale</Text>
          <Text style={styles.hint}>Endereço do Tailscale Serve, ex.: https://meu-pc.tailnet.ts.net</Text>
          <TextInput
            style={styles.input}
            value={coreUrl}
            onChangeText={setCoreUrl}
            onEndEditing={() => saveCoreUrl(coreUrl)}
            placeholder="https://…ts.net"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
          <Result state={coreState} />
          <Button label="Testar conexão" disabled={!coreUrl} onPress={runCore} />
        </View>
      </ScrollView>

      <Scanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} />
    </View>
  );
}

function CheckCard(props: {
  title: string;
  hint: string;
  state: State;
  action: string;
  onRun: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      <Text style={styles.hint}>{props.hint}</Text>
      <Result state={props.state} />
      <Button label={props.action} onPress={props.onRun} />
    </View>
  );
}

function Result({ state }: { state: State }) {
  if (state.running) return <ActivityIndicator style={styles.result} color={colors.blue} />;
  if (!state.result) return null;
  const ok = state.result.ok;
  return (
    <View style={[styles.result, styles.resultRow]}>
      <View style={[styles.chip, { backgroundColor: ok ? colors.greenSoft : colors.redSoft }]}>
        <Text style={[styles.chipText, { color: ok ? colors.green : colors.red }]}>
          {ok ? "OK" : "Falhou"}
        </Text>
      </View>
      <Text style={styles.detail} selectable>
        {state.result.detail}
      </Text>
    </View>
  );
}

function Button(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        props.disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function Scanner(props: { visible: boolean; onClose: () => void; onScanned: (data: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={styles.scanner}>
        {!permission ? (
          <ActivityIndicator color={colors.blue} />
        ) : !permission.granted ? (
          <View style={styles.scannerMsg}>
            <Text style={styles.detail}>O Pulse precisa da câmera para ler o QR Code.</Text>
            <Button label="Permitir câmera" onPress={requestPermission} />
          </View>
        ) : (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => props.onScanned(data)}
          />
        )}
        <View style={styles.scannerFooter}>
          <Button label="Fechar" onPress={props.onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  subtitle: { color: colors.dim, fontSize: 14, marginBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  hint: { color: colors.dim, fontSize: 13 },
  result: { marginTop: 4 },
  resultRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 12, fontWeight: "600" },
  detail: { color: colors.text, fontSize: 14, flex: 1 },
  input: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    marginTop: 4,
    backgroundColor: colors.blue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  scanner: { flex: 1, backgroundColor: "#000", justifyContent: "center" },
  scannerMsg: { padding: 24, gap: 16 },
  scannerFooter: { position: "absolute", left: 16, right: 16, bottom: 40 },
});
