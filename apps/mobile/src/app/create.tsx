import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, type AiJob } from "@morph/client";
import { Orb } from "../create/Orb";
import { describeError, useMorph } from "../data/MorphProvider";
import { UiIcon } from "../design/icons";
import { Surface, Tap, Txt } from "../design/primitives";
import { useTheme } from "../design/theme";
import { GUTTER, radius, space } from "../design/tokens";
import { openScreen } from "../renderer/navigation";

/**
 * Construção em tempo real (mockup 2). As etapas acompanham o que o servidor está fazendo
 * de verdade: entender (modelo rápido), escrever dados/telas (o que a IA está gerando),
 * validar e aplicar. Nada aqui é animação de enfeite sobre um spinner.
 */

const STEPS: { stage: AiJob["stage"]; label: string }[] = [
  { stage: "understanding", label: "Entendendo sua solicitação" },
  { stage: "choosing", label: "Escolhendo componentes" },
  { stage: "data", label: "Organizando dados" },
  { stage: "interface", label: "Criando interface" },
  { stage: "finishing", label: "Finalizando" },
];

export default function Create() {
  const { text } = useLocalSearchParams<{ text: string }>();
  const morph = useMorph();
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const [job, setJob] = useState<AiJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Começa o pedido e acompanha até terminar.
  useEffect(() => {
    if (started.current || morph.status !== "ready" || !text) return;
    started.current = true;
    let alive = true;
    void (async () => {
      try {
        let j = await morph.ai.request(text);
        setJob(j);
        while (alive && j.status === "running") {
          await new Promise((r) => setTimeout(r, 600));
          j = await morph.ai.job(j.id);
          if (alive) setJob(j);
        }
        if (alive && j.status === "done") await finish(j);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 503) setError("A criação com IA não está ligada no servidor.");
        else if (err instanceof ApiError && err.status === 429) setError("Muitos pedidos nesta hora. Tente daqui a pouco.");
        else if (err instanceof ApiError && err.status === 409) setError("Já existe um pedido em andamento.");
        else setError(describeError(err).replace("Nada foi salvo.", "Nada foi mudado."));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph.status, text]);

  /** Pronto: sincroniza (o Motion destaca o que surgiu) e abre a ferramenta. */
  const finish = async (j: AiJob) => {
    if (morph.status !== "ready") return;
    await morph.refresh();
    router.dismissAll();
    if (j.result?.home) openScreen(j.result.home);
  };

  const confirm = async () => {
    if (!job || morph.status !== "ready") return;
    setJob({ ...job, status: "running", stage: "finishing" });
    try {
      const j = await morph.ai.confirm(job.id);
      setJob(j);
      if (j.status === "done") await finish(j);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const decline = async () => {
    if (job && morph.status === "ready") await morph.ai.decline(job.id).catch(() => undefined);
    router.back();
  };

  const current = STEPS.findIndex((s) => s.stage === job?.stage);
  const running = !error && (!job || job.status === "running");
  const verb = job?.intent === "create_tool" ? "Criando" : job?.intent ? "Mudando" : "Entendendo";
  const title = job?.progressTitle ? `${verb} ${job.progressTitle}…` : "Entendendo o seu pedido…";

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <Tap onPress={decline} style={styles.close} accessibilityLabel="Fechar">
        <UiIcon name="close" size={24} color={colors.textSecondary} />
      </Tap>

      <View style={styles.center}>
        <Orb active={running} />
      </View>

      <View style={{ gap: space.xl }}>
        <Txt variant="title" style={{ fontWeight: "500" }}>
          {error || job?.status === "failed" ? "Não deu certo desta vez" : job?.status === "not_supported" ? "Ainda não sei fazer isso" : title}
        </Txt>

        {(error || job?.status === "failed") && <Txt tone="secondary">{error ?? job?.error}</Txt>}
        {job?.status === "not_supported" && <Txt tone="secondary">{job.reply}</Txt>}

        {running || job?.status === "done" ? (
          <View style={{ gap: space.md }}>
            {STEPS.map((s, i) => {
              const done = job?.status === "done" || i < current;
              const now = i === current && running;
              return (
                <View key={s.stage} style={[styles.step, { opacity: done || now ? 1 : 0.4 }]}>
                  {done ? (
                    <Animated.View entering={FadeIn.duration(200)} style={[styles.check, { backgroundColor: accent.main }]}>
                      <UiIcon name="check" size={13} color="#FFFFFF" />
                    </Animated.View>
                  ) : (
                    <View style={[styles.check, { borderWidth: 1.5, borderColor: now ? accent.main : colors.textTertiary }]} />
                  )}
                  <Txt variant="callout" tone={done || now ? "primary" : "tertiary"}>
                    {s.label}
                    {now ? "…" : ""}
                  </Txt>
                </View>
              );
            })}
          </View>
        ) : null}

        {job?.status === "needs_confirmation" && job.proposal && (
          <Surface glow style={{ gap: space.md }}>
            <Txt variant="headline">Antes de aplicar</Txt>
            <Txt tone="secondary">{job.proposal.summary}</Txt>
            <Txt variant="footnote" tone="tertiary">
              Essa mudança tira algo da sua tela. Os dados já registrados continuam guardados e dá para desfazer na Evolução.
            </Txt>
            <View style={styles.row}>
              <Tap onPress={decline} style={[styles.button, { backgroundColor: colors.surfaceStrong }]}>
                <Txt variant="callout">Agora não</Txt>
              </Tap>
              <Tap onPress={() => void confirm()} style={[styles.button, { backgroundColor: accent.main }]}>
                <Txt variant="callout" tone="onAccent">
                  Aplicar
                </Txt>
              </Tap>
            </View>
          </Surface>
        )}

        {(error || job?.status === "failed" || job?.status === "not_supported") && (
          <Tap onPress={() => router.back()} style={[styles.button, { backgroundColor: colors.surfaceStrong }]}>
            <Txt variant="callout">Voltar</Txt>
          </Tap>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: GUTTER, justifyContent: "space-between" },
  close: { alignSelf: "flex-end", width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center", flex: 1 },
  step: { flexDirection: "row", alignItems: "center", gap: space.md },
  check: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", gap: space.sm },
  button: { flex: 1, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
