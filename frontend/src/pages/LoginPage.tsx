import { FormEvent, useState } from "react";
import { Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../context/session-context";
import { api } from "../lib/api";
import { SessionUser } from "../lib/session";

type LoginResponse =
  | {
      token: string;
      user: SessionUser;
      mfaRequired?: false;
    }
  | {
      mfaRequired: true;
      mfaChallengeToken: string;
    };

type MfaVerifyResponse = {
  token: string;
  user: SessionUser;
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, setSession } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setInfo("");

    try {
      const response = await api.post<LoginResponse>("/auth/login", { username, password });
      if ("mfaRequired" in response && response.mfaRequired) {
        setMfaChallengeToken(response.mfaChallengeToken);
        setInfo("Captura el codigo de tu app de autenticacion para continuar.");
        return;
      }
      if ("token" in response) {
        setSession(response.token, response.user);
        navigate(response.user.mustChangePassword ? "/change-password" : from, { replace: true });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible iniciar sesion.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallengeToken) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await api.post<MfaVerifyResponse>("/auth/mfa/verify", {
        mfaChallengeToken,
        code: mfaCode,
      });
      setSession(response.token, response.user);
      navigate(response.user.mustChangePassword ? "/change-password" : from, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Codigo MFA invalido.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResetRequest() {
    setError("");
    setInfo("");

    try {
      const response = await api.post<{ message: string }>("/auth/request-password-reset", {
        usernameOrEmail: username,
      });
      setInfo(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible solicitar el restablecimiento.");
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-hero">
        <div className="auth-hero-inner">
          <div className="auth-brand-lockup">
            <img className="auth-logo auth-logo-hero" src="/pcinexus-logo.png" alt="PCI Nexus logo" />
          </div>

          <p className="brand-eyebrow auth-eyebrow">Plataforma de certificacion</p>
          <h1>Portal de certificacion PCI DSS.</h1>

          <p className="auth-hero-copy">
            Acceso controlado para clientes con credenciales emitidas de forma interna y vinculadas al ciclo de certificacion.
          </p>

          <div className="auth-hero-panel">
            <article className="auth-feature">
              <p className="muted-label" style={{ color: "rgba(200,214,240,0.42)" }}>Acceso del cliente</p>
              <strong>Credenciales asignadas</strong>
              <span>El primer ingreso exige cambio de contrasena antes de habilitar el espacio de trabajo.</span>
            </article>
            <article className="auth-feature">
              <p className="muted-label" style={{ color: "rgba(200,214,240,0.42)" }}>Control operativo</p>
              <strong>Sesion y trazabilidad</strong>
              <span>La asignacion del SAQ y el historial de acceso quedan vinculados desde el inicio.</span>
            </article>
          </div>

          <div className="credential-note">
            <p className="muted-label">Acceso autorizado</p>
            <strong>Usa las credenciales emitidas para tu empresa.</strong>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", placeItems: "center", padding: "48px 40px" }}>
        <div className="auth-card">
          <div className="auth-card-header">
            <p className="brand-eyebrow">Ingreso al portal</p>
            <h2>Acceso seguro</h2>
            <p className="subtle-text">
              Usa las credenciales asignadas a tu empresa para continuar con el flujo de certificacion PCI DSS.
            </p>
          </div>

          {mfaChallengeToken ? (
            <form className="auth-form" onSubmit={handleMfaSubmit}>
              <label className="field">
                <span>Codigo MFA (6 digitos) o codigo de recuperacion</span>
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  inputMode="text"
                  autoFocus
                  placeholder="123456 o XXXXX-XXXXX"
                />
              </label>
              {error ? <p className="error-text">{error}</p> : null}
              {info ? <p className="info-text">{info}</p> : null}
              <button type="submit" className="primary-button auth-submit" disabled={isLoading}>
                {isLoading ? "Verificando..." : "Verificar y entrar"}
              </button>
              <button
                type="button"
                className="ghost-button auth-secondary"
                onClick={() => {
                  setMfaChallengeToken(null);
                  setMfaCode("");
                  setInfo("");
                }}
              >
                Volver a iniciar sesion
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>Usuario o correo</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} />
              </label>

              <label className="field">
                <span>Contrasena</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>

              {error ? <p className="error-text">{error}</p> : null}
              {info ? <p className="info-text">{info}</p> : null}

              <button type="submit" className="primary-button auth-submit" disabled={isLoading}>
                {isLoading ? "Ingresando..." : "Ingresar"}
              </button>
              <button type="button" className="ghost-button auth-secondary" onClick={handleResetRequest}>
                Solicitar restablecimiento
              </button>
              <Link to="/reset-password" className="ghost-button auth-secondary" style={{ textAlign: "center" }}>
                Tengo un token de restablecimiento
              </Link>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
