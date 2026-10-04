import { ComingSoon } from "../../ui";

export default function Control() {
  return (
    <ComingSoon
      title="Control"
      milestone="M3"
      icon="desktop-outline"
      items={["Apps, processos e serviços", "Abrir e fechar apps permitidos", "Screenshot, bloquear, suspender", "Reiniciar e desligar (com Face ID)", "Lockdown Mode"]}
    />
  );
}
