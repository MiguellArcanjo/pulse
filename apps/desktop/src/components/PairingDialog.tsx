import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, CheckCircle2, Smartphone, X } from "lucide-react";
import type { PairingRequest, PairingResolved, PairingTicket } from "@pulse/protocol";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "qr"; ticket: PairingTicket }
  | {
      kind: "request";
      ticket: PairingTicket;
      request: PairingRequest;
      /** Código digitado pelo usuário (o PC não conhece o código; o iPhone mostra). */
      code: string;
      busy: boolean;
      error: string | null;
    }
  | { kind: "done"; outcome: "approved" | "denied" | "expired"; name?: string };

/**
 * Fluxo "Adicionar dispositivo": mostra o QR, espera o iPhone ler e pede para
 * o usuário DIGITAR o código que o iPhone mostra. Digitar (em vez de comparar)
 * impede aprovar no automático: se outro aparelho usou o QR, o seu iPhone não
 * mostra código nenhum e não há o que digitar.
 */
export function PairingDialog({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [now, setNow] = useState(Date.now());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const create = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const ticket = await invoke<PairingTicket>("pairing_create");
      setPhase({ kind: "qr", ticket });
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  }, []);

  useEffect(() => {
    void create();
  }, [create]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const keep = (un: () => void) => (disposed ? un() : unlisteners.push(un));

    void listen<PairingRequest>("core://pairing-requested", (e) => {
      const p = phaseRef.current;
      if (p.kind === "qr" && p.ticket.pairingId === e.payload.pairingId) {
        setPhase({ kind: "request", ticket: p.ticket, request: e.payload, code: "", busy: false, error: null });
      }
    }).then(keep);

    void listen<PairingResolved>("core://pairing-resolved", (e) => {
      const p = phaseRef.current;
      const id = p.kind === "qr" || p.kind === "request" ? p.ticket.pairingId : null;
      if (id !== e.payload.pairingId) return;
      const outcome = e.payload.outcome as "approved" | "denied" | "expired";
      setPhase({ kind: "done", outcome, name: p.kind === "request" ? p.request.deviceName : undefined });
    }).then(keep);

    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, []);

  // Fechar com um QR ainda válido o invalida no Core.
  const close = () => {
    const p = phaseRef.current;
    if (p.kind === "qr" || p.kind === "request") {
      void invoke("pairing_deny", { pairingId: p.ticket.pairingId }).catch(() => {});
    }
    onClose();
  };

  const decide = async (approve: boolean) => {
    const p = phaseRef.current;
    if (p.kind !== "request") return;
    setPhase({ ...p, busy: true, error: null });
    try {
      if (approve) {
        await invoke("pairing_approve", { pairingId: p.ticket.pairingId, code: p.code });
      } else {
        await invoke("pairing_deny", { pairingId: p.ticket.pairingId });
      }
      // O resultado chega pelo evento core://pairing-resolved.
    } catch (e) {
      // Código errado: continua no pedido para tentar de novo. Se esgotou as
      // tentativas, o evento de "denied" troca a tela logo em seguida.
      const cur = phaseRef.current;
      if (cur.kind === "request") setPhase({ ...cur, busy: false, code: "", error: String(e) });
    }
  };

  const setCode = (raw: string) => {
    const p = phaseRef.current;
    if (p.kind !== "request") return;
    setPhase({ ...p, code: raw.replace(/\D/g, "").slice(0, 6), error: null });
  };

  const secondsLeft =
    phase.kind === "qr" ? Math.max(0, Math.round((phase.ticket.expiresAtMs - now) / 1000)) : 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pair-title">
        <header className="modal-header">
          <h2 id="pair-title">Adicionar dispositivo</h2>
          <button className="icon-btn" onClick={close} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        {phase.kind === "loading" && <p className="dim">Gerando QR Code…</p>}

        {phase.kind === "error" && (
          <div className="modal-body">
            <p className="bad">{phase.message}</p>
            <button className="btn" onClick={() => void create()}>
              Tentar de novo
            </button>
          </div>
        )}

        {phase.kind === "qr" && (
          <div className="modal-body pair-qr">
            <p className="dim">
              No iPhone, abra o Pulse e escaneie este código. Ele vale por <strong>{secondsLeft}s</strong> e
              pode ser usado uma única vez.
            </p>
            {secondsLeft > 0 ? (
              <div className="qr-box">
                <QRCodeSVG value={phase.ticket.qrPayload} size={232} marginSize={2} level="M" />
              </div>
            ) : (
              <button className="btn" onClick={() => void create()}>
                QR expirado — gerar outro
              </button>
            )}
            <p className="mono dim">{phase.ticket.coreUrl || "sem endereço do Core"}</p>
            {phase.ticket.warnings.map((w) => (
              <p key={w} className="warn-line">
                <AlertTriangle size={14} aria-hidden /> {w}
              </p>
            ))}
          </div>
        )}

        {phase.kind === "request" && (
          <div className="modal-body pair-request">
            <Smartphone size={36} className="accent" aria-hidden />
            <p className="pair-ask">
              <strong>{phase.request.deviceName}</strong> deseja acessar o Pulse.
            </p>
            {phase.request.deviceModel && <p className="dim">{phase.request.deviceModel}</p>}
            <label className="dim" htmlFor="pair-code-input">
              Digite o código que aparece no iPhone:
            </label>
            <form
              className="pair-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (phase.code.length === 6) void decide(true);
              }}
            >
              <input
                id="pair-code-input"
                className="pair-code-input"
                value={phase.code.length > 3 ? `${phase.code.slice(0, 3)} ${phase.code.slice(3)}` : phase.code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000 000"
                maxLength={7}
                autoFocus
                disabled={phase.busy}
                aria-invalid={phase.error ? true : undefined}
              />
              {phase.error && <p className="bad small">{phase.error}</p>}
              <p className="dim small">Se o iPhone não mostra um código, recuse: outro aparelho usou o QR.</p>
              <div className="modal-actions">
                <button type="button" className="btn" disabled={phase.busy} onClick={() => void decide(false)}>
                  Recusar
                </button>
                <button type="submit" className="btn btn-primary" disabled={phase.busy || phase.code.length !== 6}>
                  Autorizar
                </button>
              </div>
            </form>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="modal-body pair-done">
            {phase.outcome === "approved" ? (
              <>
                <CheckCircle2 size={40} className="ok" aria-hidden />
                <p>
                  <strong>{phase.name ?? "Dispositivo"}</strong> foi autorizado.
                </p>
                <button className="btn btn-primary" onClick={onClose}>
                  Concluir
                </button>
              </>
            ) : (
              <>
                <p>{phase.outcome === "denied" ? "Acesso recusado." : "O pedido expirou."}</p>
                <div className="modal-actions">
                  <button className="btn" onClick={onClose}>
                    Fechar
                  </button>
                  <button className="btn btn-primary" onClick={() => void create()}>
                    Gerar novo QR
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
