import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AdminClientCreatedResponse, AdminClientManagementResponse } from "../types";

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

function slugifyUsername(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
}

export function AdminClientsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [error, setError] = useState("");
  const [createdClient, setCreatedClient] = useState<AdminClientCreatedResponse | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["admin-clients"],
    queryFn: () => api.get<AdminClientManagementResponse>("/admin/clients"),
  });

  const selectedSaqType = useMemo(
    () => clientsQuery.data?.saqTypes.find((saqType) => saqType.id === form.saqTypeId) ?? null,
    [clientsQuery.data?.saqTypes, form.saqTypeId],
  );

  function updateField(key: keyof ClientForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyCompanyName(value: string) {
    setForm((current) => ({
      ...current,
      companyName: value,
      username: current.username || slugifyUsername(value),
    }));
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

  if (clientsQuery.isLoading) {
    return <div className="loading-panel">Cargando clientes y SAQ...</div>;
  }

  if (clientsQuery.isError || !clientsQuery.data) {
    return <div className="error-panel">No fue posible cargar la administracion de clientes.</div>;
  }

  const canSubmit =
    form.companyName.trim() &&
    form.businessType.trim() &&
    form.primaryContactName.trim() &&
    form.primaryContactEmail.trim() &&
    form.username.trim() &&
    form.temporaryPassword.length >= 8 &&
    form.saqTypeId &&
    Number(form.cycleYear);

  return (
    <div className="page-stack admin-clients-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administrador</p>
          <h1>Alta de clientes para pruebas</h1>
          <p className="page-subtitle">
            Crea clientes de prueba, asigna un SAQ y genera el acceso inicial para validar distintos escenarios.
          </p>
        </div>
      </section>

      <section className="single-page-card wide admin-client-form-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Nuevo cliente</p>
            <h2>Datos de empresa, acceso y SAQ</h2>
          </div>
          {selectedSaqType ? <span className="soft-badge">SAQ {selectedSaqType.code}</span> : null}
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
            <span>Usuario de acceso</span>
            <input value={form.username} onChange={(event) => updateField("username", event.target.value)} placeholder="usuario_cliente" />
          </label>
          <label className="field">
            <span>Contrasena temporal</span>
            <input value={form.temporaryPassword} onChange={(event) => updateField("temporaryPassword", event.target.value)} />
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
            <p>
              SAQ {createdClient.saqTypeCode} - Ciclo {createdClient.cycleYear}
            </p>
          </div>
        ) : null}

        <button type="button" className="primary-button" disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? "Creando..." : "Crear cliente de prueba"}
        </button>
      </section>

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
                  {client.businessType} · Usuario: {client.username ?? "Sin usuario"}
                </p>
                <p className="subtle-text">
                  {client.currentCertification
                    ? `SAQ ${client.currentCertification.saqTypeCode} · ${client.currentCertification.cycleYear} · ${client.currentCertification.paymentState}`
                    : "Sin certificacion activa"}
                </p>
              </div>
              <span className="soft-badge">{client.status}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
