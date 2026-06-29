import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../context/session-context";
import { api } from "../lib/api";

export function ForcePasswordPage() {
  const navigate = useNavigate();
  const { isAuthenticated, updateUser, user } = useSession();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  const sessionUser = user;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || (newPassword.match(/\d/g) ?? []).length < 2 || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError("La contrasena debe tener al menos 8 caracteres, una mayuscula, dos numeros y un caracter especial.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }

    setIsSaving(true);
    try {
      await api.post<{ success: boolean }>("/auth/change-password", { newPassword });
      updateUser({
        id: sessionUser.id,
        username: sessionUser.username,
        email: sessionUser.email,
        firstName: sessionUser.firstName,
        lastName: sessionUser.lastName,
        role: sessionUser.role,
        clientId: sessionUser.clientId,
        mustChangePassword: false,
      });
      navigate("/", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible actualizar la contrasena.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="single-page-shell">
      <section className="single-page-card">
        <p className="brand-eyebrow">Paso de seguridad</p>
        <h2>Reemplaza la contrasena temporal</h2>
        <p className="subtle-text">
          Este paso es obligatorio antes de habilitar el portal. Asegura que el espacio de certificacion quede protegido por una credencial controlada por el cliente.
        </p>

        <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: "20px" }}>
          <p className="info-text">Usa al menos 8 caracteres, una mayuscula, dos numeros y un caracter especial.</p>
          <label className="field">
            <span>Nueva contrasena</span>
            <span className="password-input-wrap">
              <input type={showPassword ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              <button type="button" className="password-visibility-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <label className="field">
            <span>Confirmar contrasena</span>
            <span className="password-input-wrap">
              <input type={showConfirmation ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              <button type="button" className="password-visibility-button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? "Ocultar confirmacion" : "Mostrar confirmacion"}>
                {showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit" className="primary-button auth-submit" disabled={isSaving}>
            {isSaving ? "Actualizando..." : "Guardar y continuar"}
          </button>
        </form>
      </section>
    </div>
  );
}
