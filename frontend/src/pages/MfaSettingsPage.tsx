import { FormEvent, useState } from "react";
import { useSession } from "../context/session-context";
import { api } from "../lib/api";

type EnrollStartResponse = {
  secret: string;
  otpAuthUrl: string;
  qrCodeDataUrl: string;
};

type EnrollConfirmResponse = {
  enabled: boolean;
  recoveryCodes: string[];
};

export function MfaSettingsPage() {
  const { user, refreshUser } = useSession();
  const [pending, setPending] = useState<EnrollStartResponse | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const isEligibleRole = user?.role === "ADMIN" || user?.role === "EXECUTIVE";
  if (!isEligibleRole) {
    return (
      <div className="page-stack">
        <div className="error-panel">El doble factor solo esta disponible para roles administrativos.</div>
      </div>
    );
  }

  async function handleStartEnroll() {
    setError("");
    setInfo("");
    setRecoveryCodes(null);
    setIsWorking(true);
    try {
      const response = await api.post<EnrollStartResponse>("/auth/mfa/enroll/start");
      setPending(response);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible iniciar el enrolamiento de MFA.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleConfirmEnroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    setError("");
    setIsWorking(true);
    try {
      const response = await api.post<EnrollConfirmResponse>("/auth/mfa/enroll/confirm", { code });
      setRecoveryCodes(response.recoveryCodes);
      setInfo("MFA activado. Guarda los codigos de recuperacion en un lugar seguro.");
      setPending(null);
      setCode("");
      await refreshUser?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible confirmar el codigo MFA.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
    setIsWorking(true);
    try {
      await api.post("/auth/mfa/disable", { password: disablePassword });
      setInfo("MFA desactivado.");
      setDisablePassword("");
      await refreshUser?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "No fue posible desactivar MFA.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Seguridad de cuenta</p>
          <h1>Autenticacion de dos factores (MFA)</h1>
          <p className="page-subtitle">
            Anade un segundo factor mediante una app TOTP como Google Authenticator, Authy o 1Password.
            Recomendado obligatoriamente para administradores y ejecutivos.
          </p>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {info ? <p className="success-text">{info}</p> : null}

      {user?.mfaEnabled ? (
        <section className="single-page-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Estado</p>
              <h2>MFA activado</h2>
            </div>
            <span className="soft-badge accent">Activo</span>
          </div>
          <p className="subtle-text">
            Cada inicio de sesion solicitara un codigo de tu app o un codigo de recuperacion.
            Para desactivarlo, confirma tu contrasena.
          </p>
          <form className="auth-form" onSubmit={handleDisable} style={{ marginTop: "16px" }}>
            <label className="field">
              <span>Contrasena actual</span>
              <input
                type="password"
                value={disablePassword}
                onChange={(event) => setDisablePassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="ghost-button" disabled={isWorking}>
              {isWorking ? "Procesando..." : "Desactivar MFA"}
            </button>
          </form>
        </section>
      ) : pending ? (
        <section className="single-page-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Paso 1</p>
              <h2>Escanea el codigo QR</h2>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 240px) 1fr", gap: "24px", alignItems: "start" }}>
            <img src={pending.qrCodeDataUrl} alt="QR code para MFA" style={{ background: "#fff", padding: "10px", borderRadius: "12px" }} />
            <div>
              <p className="subtle-text">
                Si tu app no puede leer el codigo, captura manualmente la siguiente clave secreta:
              </p>
              <code style={{ display: "inline-block", marginTop: "6px", padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                {pending.secret}
              </code>
              <p className="subtle-text" style={{ marginTop: "16px" }}>
                Despues de agregar la cuenta, captura el codigo de 6 digitos que muestre la app para
                confirmar el enrolamiento.
              </p>
              <form className="auth-form" onSubmit={handleConfirmEnroll} style={{ marginTop: "12px" }}>
                <label className="field">
                  <span>Codigo de 6 digitos</span>
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoFocus
                    placeholder="123456"
                  />
                </label>
                <button type="submit" className="primary-button" disabled={isWorking}>
                  {isWorking ? "Verificando..." : "Confirmar y activar"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setPending(null);
                    setCode("");
                  }}
                >
                  Cancelar
                </button>
              </form>
            </div>
          </div>
        </section>
      ) : (
        <section className="single-page-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Estado</p>
              <h2>MFA no esta activado</h2>
            </div>
            <span className="soft-badge">Inactivo</span>
          </div>
          <p className="subtle-text">
            Al activarlo se generaran codigos de recuperacion de un solo uso. Guardalos en un lugar
            seguro para no perder acceso si el dispositivo se pierde.
          </p>
          <button type="button" className="primary-button" disabled={isWorking} onClick={handleStartEnroll}>
            {isWorking ? "Generando..." : "Iniciar enrolamiento"}
          </button>
        </section>
      )}

      {recoveryCodes ? (
        <section className="single-page-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Guarda estos codigos</p>
              <h2>Codigos de recuperacion</h2>
            </div>
            <span className="soft-badge accent">Se mostraran solo una vez</span>
          </div>
          <p className="subtle-text">
            Cada codigo solo puede usarse una vez para iniciar sesion si pierdes acceso al segundo factor.
          </p>
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "8px", padding: 0, listStyle: "none", marginTop: "12px" }}>
            {recoveryCodes.map((entry) => (
              <li
                key={entry}
                style={{
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  fontFamily: "monospace",
                  letterSpacing: "0.04em",
                }}
              >
                {entry}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
