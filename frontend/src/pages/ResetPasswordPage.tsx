import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../context/session-context";
import { api } from "../lib/api";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useSession();
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const queryToken = searchParams.get("token") ?? searchParams.get("resetToken") ?? "";
    if (queryToken) {
      setToken(queryToken);
    }
  }, [searchParams]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");

    if (!token.trim()) {
      setError("Pega el token recibido por correo o usa el enlace del mensaje.");
      return;
    }
    if (newPassword.length < 8) {
      setError("La nueva contrasena debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La confirmacion no coincide con la nueva contrasena.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post<{ success: boolean }>("/auth/reset-password", {
        token: token.trim(),
        newPassword,
      });
      setInfo("Contrasena restablecida. Inicia sesion con la nueva contrasena.");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => navigate("/login", { replace: true }), 1800);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible restablecer la contrasena. Solicita un nuevo enlace.",
      );
    } finally {
      setIsSubmitting(false);
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
          <h1>Restablecimiento de contrasena.</h1>
          <p className="auth-hero-copy">
            Define una nueva contrasena para continuar con tu proceso de certificacion PCI DSS.
            El enlace recibido por correo es de un solo uso y caduca despues de 60 minutos.
          </p>

          <div className="credential-note">
            <p className="muted-label">Recordatorio</p>
            <strong>Si el enlace expiro, solicita un nuevo restablecimiento desde el login.</strong>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", placeItems: "center", padding: "48px 40px" }}>
        <div className="auth-card">
          <div className="auth-card-header">
            <p className="brand-eyebrow">Restablecer acceso</p>
            <h2>Define tu nueva contrasena</h2>
            <p className="subtle-text">
              Captura la contrasena que usaras a partir de ahora. Se requiere al menos 8 caracteres.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Token recibido</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Pega el token del correo si no se completo automaticamente"
                disabled={isSubmitting}
              />
            </label>

            <label className="field">
              <span>Nueva contrasena</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            </label>

            <label className="field">
              <span>Confirmar nueva contrasena</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            </label>

            {error ? <p className="error-text">{error}</p> : null}
            {info ? <p className="info-text">{info}</p> : null}

            <button type="submit" className="primary-button auth-submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando..." : "Restablecer contrasena"}
            </button>
            <Link to="/login" className="ghost-button auth-secondary" style={{ textAlign: "center" }}>
              Volver al inicio de sesion
            </Link>
          </form>
        </div>
      </section>
    </div>
  );
}
