import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { SecurityPolicy } from "@pulse/protocol";
import { usePolicy } from "../useControl";

const FACE_ID: Array<{ key: keyof SecurityPolicy; label: string }> = [
  { key: "requireFaceIdPower", label: "Ações de energia (suspender, reiniciar, desligar)" },
  { key: "requireFaceIdTerminal", label: "Terminal remoto" },
  { key: "requireFaceIdFileDeletion", label: "Excluir arquivos" },
  { key: "requireFaceIdEchoCritical", label: "Ações críticas do Echo" },
];

/** Política de segurança dos iPhones. Só aqui (Desktop) é possível desligar o Lockdown. */
export function SecurityPanel() {
  const [policy, setPolicy] = usePolicy();
  const [error, setError] = useState<string | null>(null);

  if (!policy) return null;

  const update = async (next: SecurityPolicy) => {
    setError(null);
    try {
      await setPolicy(next);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="panel" aria-labelledby="security-title">
      <header className="panel-header">
        <h2 id="security-title">Segurança dos iPhones</h2>
      </header>

      <div className={`lockdown ${policy.lockdown ? "is-on" : ""}`}>
        <ShieldAlert size={20} aria-hidden />
        <div className="lockdown-text">
          <strong>Lockdown Mode {policy.lockdown ? "ativo" : "desligado"}</strong>
          <span className="dim small">
            Ativo: iPhones ficam somente leitura (sem ações, terminal ou Echo). Pode ser ligado pelo iPhone;
            só é desligado aqui.
          </span>
        </div>
        <Toggle
          checked={policy.lockdown}
          label="Lockdown Mode"
          onChange={(v) => void update({ ...policy, lockdown: v })}
        />
      </div>

      <h3 className="subhead">Exigir Face ID para</h3>
      <ul className="toggles">
        {FACE_ID.map((f) => (
          <li key={f.key}>
            <span>{f.label}</span>
            <Toggle
              checked={policy[f.key] as boolean}
              label={f.label}
              onChange={(v) => void update({ ...policy, [f.key]: v })}
            />
          </li>
        ))}
      </ul>
      <p className="dim small">
        O Face ID é verificado no próprio iPhone. Ações CRITICAL exigem Face ID sempre.
      </p>
      {error && <p className="bad small">{error}</p>}
    </section>
  );
}

export function Toggle(props: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={`toggle ${props.checked ? "is-on" : ""}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}
