import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  AdminExecutiveCreatedResponse,
  AdminExecutiveItem,
  AdminExecutivesResponse,
  AdminExecutiveUpdatedResponse,
} from "../types";

type ExecutiveForm = {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  temporaryPassword: string;
  isActive: boolean;
};

const initialForm: ExecutiveForm = {
  firstName: "",
  lastName: "",
  email: "",
  username: "",
  phone: "",
  temporaryPassword: "Temp1234!",
  isActive: true,
};

function slugifyUsername(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
}

function executiveToForm(executive: AdminExecutiveItem): ExecutiveForm {
  return {
    firstName: executive.firstName,
    lastName: executive.lastName,
    email: executive.email,
    username: executive.username,
    phone: executive.phone ?? "",
    temporaryPassword: "",
    isActive: executive.isActive,
  };
}

export function AdminExecutivesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ExecutiveForm>(initialForm);
  const [selectedExecutiveId, setSelectedExecutiveId] = useState("");
  const [created, setCreated] = useState<AdminExecutiveCreatedResponse | null>(null);
  const [updated, setUpdated] = useState<AdminExecutiveUpdatedResponse | null>(null);
  const [error, setError] = useState("");

  const [includeInactive, setIncludeInactive] = useState(false);
  const executivesQuery = useQuery({
    queryKey: ["admin-executives", includeInactive],
    queryFn: () =>
      api.get<AdminExecutivesResponse>(
        `/admin/executives${includeInactive ? "?includeInactive=true" : ""}`,
      ),
  });

  const selectedExecutive = useMemo(
    () => executivesQuery.data?.items.find((executive) => executive.id === selectedExecutiveId) ?? null,
    [executivesQuery.data?.items, selectedExecutiveId],
  );
  const isEditing = Boolean(selectedExecutiveId);

  function updateField(key: keyof ExecutiveForm, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyName(key: "firstName" | "lastName", value: string) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      const fullName = `${next.firstName} ${next.lastName}`.trim();
      return { ...next, username: current.username || slugifyUsername(fullName) };
    });
  }

  function startCreateMode() {
    setSelectedExecutiveId("");
    setForm(initialForm);
    setCreated(null);
    setUpdated(null);
    setError("");
  }

  function startEditMode(executive: AdminExecutiveItem) {
    setSelectedExecutiveId(executive.id);
    setForm(executiveToForm(executive));
    setCreated(null);
    setUpdated(null);
    setError("");
  }

  const createMutation = useMutation({
    mutationFn: () => api.post<AdminExecutiveCreatedResponse>("/admin/executives", form),
    onSuccess(response) {
      setCreated(response);
      setUpdated(null);
      setError("");
      setForm(initialForm);
      queryClient.invalidateQueries({ queryKey: ["admin-executives"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      queryClient.invalidateQueries({ queryKey: ["admin-operations-summary"] });
    },
    onError(error) {
      setCreated(null);
      setError(error instanceof Error ? error.message : "No fue posible crear el ejecutivo.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<AdminExecutiveUpdatedResponse>(`/admin/executives/${selectedExecutiveId}`, {
        ...form,
        temporaryPassword: form.temporaryPassword || undefined,
      }),
    onSuccess(response) {
      setUpdated(response);
      setCreated(null);
      setError("");
      setForm((current) => ({ ...current, temporaryPassword: "" }));
      queryClient.invalidateQueries({ queryKey: ["admin-executives"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      queryClient.invalidateQueries({ queryKey: ["admin-operations-summary"] });
    },
    onError(error) {
      setUpdated(null);
      setError(error instanceof Error ? error.message : "No fue posible actualizar el ejecutivo.");
    },
  });

  if (executivesQuery.isLoading) {
    return <div className="loading-panel">Cargando ejecutivos...</div>;
  }

  if (executivesQuery.isError || !executivesQuery.data) {
    return (
      <div className="error-panel">
        No fue posible cargar ejecutivos. {executivesQuery.error instanceof Error ? executivesQuery.error.message : "Revisa permisos de administrador."}
      </div>
    );
  }

  const passwordValid = isEditing ? !form.temporaryPassword || form.temporaryPassword.length >= 8 : form.temporaryPassword.length >= 8;
  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    form.username.trim() &&
    passwordValid;

  return (
    <div className="page-stack admin-clients-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administrador</p>
          <h1>{isEditing ? "Editar ejecutivo" : "Alta de ejecutivos"}</h1>
          <p className="page-subtitle">
            Administra usuarios ejecutivos y revisa su portafolio asignado.
          </p>
        </div>
      </section>

      <section className="single-page-card wide admin-client-form-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">{isEditing ? "Ejecutivo seleccionado" : "Nuevo ejecutivo"}</p>
            <h2>Datos de acceso</h2>
          </div>
          {isEditing ? (
            <button type="button" className="ghost-button" onClick={startCreateMode}>
              Nuevo ejecutivo
            </button>
          ) : null}
        </div>

        <div className="documents-form-grid">
          <label className="field">
            <span>Nombre</span>
            <input value={form.firstName} onChange={(event) => applyName("firstName", event.target.value)} />
          </label>
          <label className="field">
            <span>Apellido</span>
            <input value={form.lastName} onChange={(event) => applyName("lastName", event.target.value)} />
          </label>
          <label className="field">
            <span>Correo</span>
            <input value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="ejecutivo@empresa.com" />
          </label>
          <label className="field">
            <span>Usuario</span>
            <input value={form.username} onChange={(event) => updateField("username", event.target.value)} />
          </label>
          <label className="field">
            <span>Telefono</span>
            <input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>{isEditing ? "Nueva contrasena temporal" : "Contrasena temporal"}</span>
            <input value={form.temporaryPassword} onChange={(event) => updateField("temporaryPassword", event.target.value)} />
            {isEditing ? <small>Dejalo vacio para conservar la contrasena actual.</small> : null}
          </label>
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => updateField("isActive", event.target.checked)}
            />
            <span>Ejecutivo activo</span>
          </label>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {created ? (
          <div className="success-panel">
            <strong>Ejecutivo creado</strong>
            <p>
              Usuario: <b>{created.username}</b> / Contrasena temporal: <b>{created.temporaryPassword}</b>
            </p>
          </div>
        ) : null}
        {updated ? (
          <div className="success-panel">
            <strong>Ejecutivo actualizado</strong>
            <p>{updated.passwordReset ? "Contrasena temporal restablecida." : "Datos guardados correctamente."}</p>
          </div>
        ) : null}

        <button
          type="button"
          className="primary-button"
          disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
          onClick={() => (isEditing ? updateMutation.mutate() : createMutation.mutate())}
        >
          {createMutation.isPending || updateMutation.isPending
            ? "Guardando..."
            : isEditing
              ? "Guardar cambios del ejecutivo"
              : "Crear ejecutivo"}
        </button>
      </section>

      <section className="single-page-card wide admin-clients-list-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Portafolios</p>
            <h2>Ejecutivos registrados</h2>
            <p className="subtle-text" style={{ marginTop: "4px" }}>
              Por defecto solo se muestran los ejecutivos activos (los mismos que aparecen en el selector de asignacion en Admin Clientes).
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <label className="checkbox-option" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
              />
              <span>Mostrar inactivos</span>
            </label>
            <span className="soft-badge">{executivesQuery.data.items.length} ejecutivo(s)</span>
          </div>
        </div>

        <div className="outputs-list-stack">
          {executivesQuery.data.items.map((executive) => (
            <article key={executive.id} className="mini-card document-list-item">
              <div className="document-list-copy">
                <strong>{executive.firstName} {executive.lastName}</strong>
                <p className="subtle-text">{executive.username} - {executive.email}</p>
                <p className="subtle-text">
                  {executive.clients.length > 0
                    ? executive.clients.map((client) => client.companyName).join(", ")
                    : "Sin clientes asignados"}
                </p>
              </div>
              <div className="documents-action-row">
                <span className="soft-badge">{executive.isActive ? "Activo" : "Inactivo"}</span>
                <span className="soft-badge">{executive.assignedClientCount} cliente(s)</span>
                <button type="button" className="ghost-button" onClick={() => startEditMode(executive)}>
                  Editar
                </button>
              </div>
            </article>
          ))}
        </div>

        {selectedExecutive ? (
          <p className="subtle-text" style={{ marginTop: "16px" }}>
            Para reasignar clientes de {selectedExecutive.firstName}, entra a Admin clientes y selecciona otro ejecutivo en el cliente correspondiente.
          </p>
        ) : null}
      </section>
    </div>
  );
}
