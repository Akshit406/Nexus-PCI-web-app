import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  AdminClientCreatedResponse,
  AdminClientItem,
  AdminClientManagementResponse,
  AdminClientUpdatedResponse,
  AdminClientUserCreatedResponse,
} from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

const PAYMENT_OPTIONS = [
  { value: "UNPAID", label: "Pendiente" },
  { value: "PAID", label: "Pagado" },
  { value: "PENDING", label: "En revision" },
  { value: "OVERDUE", label: "Vencido" },
];

type ClientForm = {
  companyName: string;
  businessType: string;
  dbaName: string;
  website: string;
  taxId: string;
  postalAddress: string;
  fiscalAddress: string;
  primaryContactName: string;
  primaryContactTitle: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  username: string;
  temporaryPassword: string;
  saqTypeId: string;
  cycleYear: string;
  paymentState: string;
  executiveUserId: string;
};

type UserForm = {
  fullName: string;
  email: string;
  username: string;
  temporaryPassword: string;
  isPrimary: boolean;
};

const initialForm: ClientForm = {
  companyName: "",
  businessType: "",
  dbaName: "",
  website: "",
  taxId: "",
  postalAddress: "",
  fiscalAddress: "",
  primaryContactName: "",
  primaryContactTitle: "",
  primaryContactEmail: "",
  primaryContactPhone: "",
  username: "",
  temporaryPassword: "Temp1234!",
  saqTypeId: "",
  cycleYear: String(new Date().getFullYear()),
  paymentState: "UNPAID",
  executiveUserId: "",
};

const initialUserForm: UserForm = {
  fullName: "",
  email: "",
  username: "",
  temporaryPassword: "Temp1234!",
  isPrimary: false,
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

function clientToForm(client: AdminClientItem): ClientForm {
  return {
    companyName: client.companyName,
    businessType: client.businessType,
    dbaName: client.dbaName ?? "",
    website: client.website ?? "",
    taxId: client.taxId ?? "",
    postalAddress: client.postalAddress ?? "",
    fiscalAddress: client.fiscalAddress ?? "",
    primaryContactName: client.primaryContactName ?? "",
    primaryContactTitle: client.primaryContactTitle ?? "",
    primaryContactEmail: client.primaryContactEmail ?? "",
    primaryContactPhone: client.primaryContactPhone ?? "",
    username: client.username ?? "",
    temporaryPassword: "",
    saqTypeId: client.currentCertification?.saqTypeId ?? "",
    cycleYear: client.currentCertification ? String(client.currentCertification.cycleYear) : String(new Date().getFullYear()),
    paymentState: client.currentCertification?.paymentState ?? "UNPAID",
    executiveUserId: client.executiveUserId ?? "",
  };
}

export function AdminClientsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [userForm, setUserForm] = useState<UserForm>(initialUserForm);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [error, setError] = useState("");
  const [createdClient, setCreatedClient] = useState<AdminClientCreatedResponse | null>(null);
  const [updatedClient, setUpdatedClient] = useState<AdminClientUpdatedResponse | null>(null);
  const [createdUser, setCreatedUser] = useState<AdminClientUserCreatedResponse | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["admin-clients"],
    queryFn: () => api.get<AdminClientManagementResponse>("/admin/clients"),
  });

  const selectedClient = useMemo(
    () => clientsQuery.data?.items.find((client) => client.id === selectedClientId) ?? null,
    [clientsQuery.data?.items, selectedClientId],
  );

  const selectedSaqType = useMemo(
    () => clientsQuery.data?.saqTypes.find((saqType) => saqType.id === form.saqTypeId) ?? null,
    [clientsQuery.data?.saqTypes, form.saqTypeId],
  );

  const isEditing = Boolean(selectedClientId);

  function updateField(key: keyof ClientForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateUserField(key: keyof UserForm, value: string | boolean) {
    setUserForm((current) => ({ ...current, [key]: value }));
  }

  function applyCompanyName(value: string) {
    setForm((current) => ({
      ...current,
      companyName: value,
      username: current.username || slugifyUsername(value),
    }));
  }

  function startCreateMode() {
    setSelectedClientId("");
    setForm(initialForm);
    setUserForm(initialUserForm);
    setError("");
    setCreatedClient(null);
    setUpdatedClient(null);
    setCreatedUser(null);
  }

  function startEditMode(client: AdminClientItem) {
    setSelectedClientId(client.id);
    setForm(clientToForm(client));
    setUserForm(initialUserForm);
    setError("");
    setCreatedClient(null);
    setUpdatedClient(null);
    setCreatedUser(null);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<AdminClientCreatedResponse>("/admin/clients", {
        ...form,
        cycleYear: Number(form.cycleYear),
        executiveUserId: form.executiveUserId || undefined,
      }),
    onSuccess(created) {
      setCreatedClient(created);
      setUpdatedClient(null);
      setError("");
      setForm({
        ...initialForm,
        saqTypeId: form.saqTypeId,
        cycleYear: form.cycleYear,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setCreatedClient(null);
      setError(error instanceof Error ? error.message : "No fue posible crear el cliente.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<AdminClientUpdatedResponse>(`/admin/clients/${selectedClientId}`, {
        ...form,
        cycleYear: Number(form.cycleYear),
        executiveUserId: form.executiveUserId || undefined,
        temporaryPassword: form.temporaryPassword || undefined,
      }),
    onSuccess(updated) {
      setUpdatedClient(updated);
      setCreatedClient(null);
      setError("");
      setForm((current) => ({ ...current, temporaryPassword: "" }));
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setUpdatedClient(null);
      setError(error instanceof Error ? error.message : "No fue posible actualizar el cliente.");
    },
  });

  const addUserMutation = useMutation({
    mutationFn: () =>
      api.post<AdminClientUserCreatedResponse>(`/admin/clients/${selectedClientId}/users`, userForm),
    onSuccess(created) {
      setCreatedUser(created);
      setError("");
      setUserForm(initialUserForm);
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setCreatedUser(null);
      setError(error instanceof Error ? error.message : "No fue posible crear el usuario.");
    },
  });

  if (clientsQuery.isLoading) {
    return <div className="loading-panel">Cargando clientes y SAQ...</div>;
  }

  if (clientsQuery.isError || !clientsQuery.data) {
    return (
      <div className="error-panel">
        No fue posible cargar la administracion de clientes. {getErrorMessage(clientsQuery.error, "Revisa la sesion, permisos de administrador o configuracion del servidor.")}
      </div>
    );
  }

  const passwordValid = isEditing ? !form.temporaryPassword || form.temporaryPassword.length >= 8 : form.temporaryPassword.length >= 8;
  const canSubmit =
    form.companyName.trim() &&
    form.businessType.trim() &&
    form.primaryContactName.trim() &&
    form.primaryContactEmail.trim() &&
    form.username.trim() &&
    passwordValid &&
    form.saqTypeId &&
    Number(form.cycleYear);
  const canAddUser =
    selectedClientId &&
    userForm.fullName.trim() &&
    userForm.email.trim() &&
    userForm.username.trim() &&
    userForm.temporaryPassword.length >= 8;

  return (
    <div className="page-stack admin-clients-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administrador</p>
          <h1>{isEditing ? "Editar cliente de prueba" : "Alta de clientes para pruebas"}</h1>
          <p className="page-subtitle">
            Crea clientes, ajusta su SAQ/ciclo/pago y agrega usuarios de acceso para validar escenarios.
          </p>
        </div>
      </section>

      <section className="single-page-card wide admin-client-form-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">{isEditing ? "Cliente seleccionado" : "Nuevo cliente"}</p>
            <h2>Datos de empresa, acceso y SAQ</h2>
          </div>
          <div className="documents-action-row">
            {selectedSaqType ? <span className="soft-badge">SAQ {selectedSaqType.code}</span> : null}
            {isEditing ? (
              <button type="button" className="ghost-button" onClick={startCreateMode}>
                Nuevo cliente
              </button>
            ) : null}
          </div>
        </div>

        <div className="documents-form-grid">
          <label className="field">
            <span>Empresa</span>
            <input value={form.companyName} onChange={(event) => applyCompanyName(event.target.value)} placeholder="Nombre legal del comercio" />
          </label>
          <label className="field">
            <span>Tipo de negocio</span>
            <input value={form.businessType} onChange={(event) => updateField("businessType", event.target.value)} placeholder="Ej. Comercio electronico" />
          </label>
          <label className="field">
            <span>Nombre comercial</span>
            <input value={form.dbaName} onChange={(event) => updateField("dbaName", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Sitio web</span>
            <input value={form.website} onChange={(event) => updateField("website", event.target.value)} placeholder="https://..." />
          </label>
          <label className="field">
            <span>RFC / ID fiscal</span>
            <input value={form.taxId} onChange={(event) => updateField("taxId", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Direccion postal</span>
            <input value={form.postalAddress} onChange={(event) => updateField("postalAddress", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Direccion fiscal</span>
            <input value={form.fiscalAddress} onChange={(event) => updateField("fiscalAddress", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Contacto principal</span>
            <input value={form.primaryContactName} onChange={(event) => updateField("primaryContactName", event.target.value)} placeholder="Nombre y apellido" />
          </label>
          <label className="field">
            <span>Cargo del contacto</span>
            <input value={form.primaryContactTitle} onChange={(event) => updateField("primaryContactTitle", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Correo del contacto</span>
            <input value={form.primaryContactEmail} onChange={(event) => updateField("primaryContactEmail", event.target.value)} placeholder="cliente@empresa.com" />
          </label>
          <label className="field">
            <span>Telefono del contacto</span>
            <input value={form.primaryContactPhone} onChange={(event) => updateField("primaryContactPhone", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Usuario de acceso principal</span>
            <input value={form.username} onChange={(event) => updateField("username", event.target.value)} placeholder="usuario_cliente" />
          </label>
          <label className="field">
            <span>{isEditing ? "Nueva contrasena temporal" : "Contrasena temporal"}</span>
            <input value={form.temporaryPassword} onChange={(event) => updateField("temporaryPassword", event.target.value)} placeholder={isEditing ? "Opcional para restablecer" : "Temp1234!"} />
            {isEditing ? <small>Dejalo vacio para conservar la contrasena actual.</small> : null}
          </label>
          <label className="field">
            <span>Tipo de SAQ</span>
            <select value={form.saqTypeId} onChange={(event) => updateField("saqTypeId", event.target.value)}>
              <option value="">Selecciona un SAQ</option>
              {clientsQuery.data.saqTypes.map((saqType) => (
                <option key={saqType.id} value={saqType.id}>
                  {saqType.code} - {saqType.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ciclo</span>
            <input type="number" value={form.cycleYear} onChange={(event) => updateField("cycleYear", event.target.value)} />
          </label>
          <label className="field">
            <span>Estado de pago</span>
            <select value={form.paymentState} onChange={(event) => updateField("paymentState", event.target.value)}>
              {PAYMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ejecutivo asignado</span>
            <select value={form.executiveUserId} onChange={(event) => updateField("executiveUserId", event.target.value)}>
              <option value="">Sin ejecutivo asignado</option>
              {clientsQuery.data.executives.map((executive) => (
                <option key={executive.id} value={executive.id}>
                  {executive.firstName} {executive.lastName} ({executive.username})
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {createdClient ? (
          <div className="success-panel">
            <strong>Cliente creado para pruebas</strong>
            <p>
              Usuario: <b>{createdClient.username}</b> / Contrasena temporal: <b>{createdClient.temporaryPassword}</b>
            </p>
            <p>SAQ {createdClient.saqTypeCode} - Ciclo {createdClient.cycleYear}</p>
          </div>
        ) : null}
        {updatedClient ? (
          <div className="success-panel">
            <strong>Cliente actualizado</strong>
            <p>
              Usuario principal: <b>{updatedClient.username}</b>
              {updatedClient.passwordReset ? " / contrasena temporal restablecida" : ""}
            </p>
            <p>SAQ {updatedClient.saqTypeCode} - Ciclo {updatedClient.cycleYear}</p>
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
              ? "Guardar cambios del cliente"
              : "Crear cliente de prueba"}
        </button>
      </section>

      {selectedClient ? (
        <section className="single-page-card wide admin-client-form-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Usuarios del cliente</p>
              <h2>Agregar usuario de acceso</h2>
            </div>
            <span className="soft-badge">{selectedClient.users.length} usuario(s)</span>
          </div>

          <div className="documents-form-grid">
            <label className="field">
              <span>Nombre del usuario</span>
              <input
                value={userForm.fullName}
                onChange={(event) => {
                  updateUserField("fullName", event.target.value);
                  if (!userForm.username) {
                    updateUserField("username", slugifyUsername(event.target.value));
                  }
                }}
                placeholder="Nombre y apellido"
              />
            </label>
            <label className="field">
              <span>Correo</span>
              <input value={userForm.email} onChange={(event) => updateUserField("email", event.target.value)} placeholder="usuario@empresa.com" />
            </label>
            <label className="field">
              <span>Usuario</span>
              <input value={userForm.username} onChange={(event) => updateUserField("username", event.target.value)} placeholder="usuario_cliente_2" />
            </label>
            <label className="field">
              <span>Contrasena temporal</span>
              <input value={userForm.temporaryPassword} onChange={(event) => updateUserField("temporaryPassword", event.target.value)} />
            </label>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={userForm.isPrimary}
                onChange={(event) => updateUserField("isPrimary", event.target.checked)}
              />
              <span>Marcar como usuario principal</span>
            </label>
          </div>

          {createdUser ? (
            <div className="success-panel">
              <strong>Usuario agregado</strong>
              <p>
                Usuario: <b>{createdUser.username}</b> / Contrasena temporal: <b>{createdUser.temporaryPassword}</b>
              </p>
            </div>
          ) : null}

          <button
            type="button"
            className="primary-button"
            disabled={!canAddUser || addUserMutation.isPending}
            onClick={() => addUserMutation.mutate()}
          >
            {addUserMutation.isPending ? "Agregando..." : "Agregar usuario al cliente"}
          </button>

          <div className="outputs-list-stack" style={{ marginTop: "18px" }}>
            {selectedClient.users.map((user) => (
              <article key={user.id} className="mini-card document-list-item">
                <div className="document-list-copy">
                  <strong>{user.firstName} {user.lastName}</strong>
                  <p className="subtle-text">{user.username} · {user.email}</p>
                  <p className="subtle-text">{user.mustChangePassword ? "Debe cambiar contrasena" : "Contrasena actualizada"}</p>
                </div>
                <span className="soft-badge">{user.isPrimary ? "Principal" : user.isActive ? "Activo" : "Inactivo"}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="single-page-card wide admin-clients-list-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Clientes existentes</p>
            <h2>Escenarios disponibles</h2>
          </div>
          <span className="soft-badge">{clientsQuery.data.items.length} clientes</span>
        </div>

        <div className="outputs-list-stack">
          {clientsQuery.data.items.map((client) => (
            <article key={client.id} className="mini-card document-list-item">
              <div className="document-list-copy">
                <strong>{client.companyName}</strong>
                <p className="subtle-text">
                  {client.businessType} · Usuario: {client.username ?? "Sin usuario"} · {client.users.length} usuario(s)
                </p>
                <p className="subtle-text">
                  {client.currentCertification
                    ? `SAQ ${client.currentCertification.saqTypeCode} · ${client.currentCertification.cycleYear} · ${client.currentCertification.paymentState}`
                    : "Sin certificacion activa"}
                </p>
              </div>
              <div className="documents-action-row">
                <span className="soft-badge">{client.status}</span>
                <button type="button" className="ghost-button" onClick={() => startEditMode(client)}>
                  Editar
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
