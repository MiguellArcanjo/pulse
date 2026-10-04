import { ComingSoon } from "../../ui";

export default function Projects() {
  return (
    <ComingSoon
      title="Projects"
      milestone="M4"
      icon="folder-outline"
      items={["Projetos e status", "Sessão atual e branch", "Git: commits e arquivos modificados", "Start / Stop / Restart e logs", "“Onde parei”"]}
    />
  );
}
