import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  ExecutiveCertificationsResponse,
  ExecutiveSaqTypesResponse,
  SaqChangeRequestsResponse,
} from "../types";

const CURRENT_YEAR = new Date().getFullYear();

type CreateClientForm = {
  companyName: string;
  businessType: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  primaryContactTitle: string;
  username: string;
  temporaryPassword: string;
  saqTypeId: string;
  cycleYear: string;
  paymentState: string;
};

const EMPTY_CREATE_FORM: CreateClientForm = {
  companyName: "",
  businessType: "",
  primaryContactName: "",
  primaryContactEmail: "",
  primaryContactPhone: "",
  primaryContactTitle: "",
  username: "",
  temporaryPassword: "",
  saqTypeId: "",
  cycleYear: String(CURRENT_YEAR),
  paymentState: "UNPAID",
};

type AssessorDraft = {
  assessorIsaName: string;
  assessorQsaCompany: string;
  assessorQsaLeadName: string;
};

const PAYMENT_OPTIONS = [
  { value: "UNPAID", label: "Pendiente" },
  { value: "PENDING", label: "En revision" },
  { value: "PAID", label: "Pagado" },
  { value: "OVERDUE", label: "Vencido" },
];

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    DRAFT: "Borrador",
    IN_PROGRESS: "En progreso",
    READY_TO_GENERATE: "Listo para generar",
    GENERATED: "Generado",
    FINALIZED: "Finalizado",
    UNPAID: "Pendiente",
    PENDING: "En revision",
    PAID: "Pagado",
    OVERDUE: "Vencido",
  };
  return labels[value] ?? value;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Sin fecha";
  }
  return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function isExpiringSoon(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  const date = new Date(value).getTime();
  const now = Date.now();
  return date >= now && date <= now + 60 * 24 * 60 * 60 * 1000;
}

type PaymentDraft = {
  state: string;
  notes: string;
  payerBank: string;
  paymentReference: string;
  paymentAmount: string;
  paymentCurrency: string;
};

type ExpiryFilter = "ALL" | "SOON" | "OVERDUE";

function isOverdue(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return new Date(value).getTime() < Date.now();
}

function formatAmount(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined) {
    return null;
  }
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}

export function ExecutivePortalPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, PaymentDraft>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("ALL");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateClientForm>(EMPTY_CREATE_FORM);
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string } | null>(null);
  const [assessorDrafts, setAssessorDrafts] = useState<Record<string, AssessorDraft>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  const certificationsQuery = useQuery({
    queryKey: ["executive-certifications"],
    queryFn: () => api.get<ExecutiveCertificationsResponse>("/client/certifications"),
  });

  const saqTypesQuery = useQuery({
    queryKey: ["executive-saq-types"],
    queryFn: () => api.get<ExecutiveSaqTypesResponse>("/executive/saq-types"),
  });

  const changeRequestsQuery = useQuery({
    queryKey: ["executive-change-requests"],
    queryFn: () => api.get<SaqChangeRequestsResponse>("/saq-change-requests"),
  });

  const saqTypes = saqTypesQuery.data?.saqTypes ?? [];
  const changeRequests = changeRequestsQuery.data?.items ?? [];
  const pendingChangeRequests = changeRequests.filter((request) => request.status === "PENDING");

  const certifications = certificationsQuery.data?.items ?? [];
  const metrics = useMemo(() => {
    const paymentPending = certifications.filter((item) => item.paymentState !== "PAID").length;
    const ready = certifications.filter((item) => item.status === "READY_TO_GENERATE").length;
    const expiring = certifications.filter((item) => isExpiringSoon(item.validUntil)).length;
    const abandoned = certifications.filter((item) => item.status !== "GENERATED" && item.status !== "FINALIZED" && item.answeredCount === 0).length;
    return { paymentPending, ready, expiring, abandoned };
  }, [certifications]);

  const filteredCertifications = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return certifications.filter((item) => {
      if (paymentFilter !== "ALL" && item.paymentState !== paymentFilter) {
        return false;
      }
      if (expiryFilter === "SOON" && !isExpiringSoon(item.validUntil)) {
        return false;
      }
      if (expiryFilter === "OVERDUE" && !isOverdue(item.validUntil)) {
        return false;
      }
      if (search && !`${item.companyName} ${item.saqType}`.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });
  }, [certifications, searchTerm, paymentFilter, expiryFilter]);

  function getDraft(item: ExecutiveCertificationsResponse["items"][number]): PaymentDraft {
    return (
      paymentDrafts[item.id] ?? {
        state: item.paymentState,
        notes: item.paymentNotes ?? "",
        payerBank: item.payerBank ?? "",
        paymentReference: item.paymentReference ?? "",
        paymentAmount: item.paymentAmount !== null && item.paymentAmount !== undefined ? String(item.paymentAmount) : "",
        paymentCurrency: item.paymentCurrency ?? "MXN",
      }
    );
  }

  function updateDraft(id: string, base: PaymentDraft, patch: Partial<PaymentDraft>) {
    setPaymentDrafts((current) => ({ ...current, [id]: { ...base, ...patch } }));
  }

  const paymentMutation = useMutation({
    mutationFn: (input: {
      certificationId: string;
      state: string;
      notes: string;
      payerBank?: string;
      paymentReference?: string;
      paymentAmount?: number;
      paymentCurrency?: string;
    }) => api.patch<{ success: boolean }>("/client/payment-state", input),
    onSuccess(_data, variables) {
      setError("");
      setSuccess("Estado de pago actualizado.");
      setPaymentDrafts((current) => {
        const next = { ...current };
        delete next[variables.certificationId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["executive-certifications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-operations-summary"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible actualizar el pago.");
    },
  });

  function savePayment(item: ExecutiveCertificationsResponse["items"][number]) {
    const draft = getDraft(item);
    const amountValue = draft.paymentAmount.trim() ? Number(draft.paymentAmount) : undefined;
    if (amountValue !== undefined && (Number.isNaN(amountValue) || amountValue < 0)) {
      setSuccess("");
      setError("El monto del pago debe ser un numero valido.");
      return;
    }
    paymentMutation.mutate({
      certificationId: item.id,
      state: draft.state,
      notes: draft.notes,
      payerBank: draft.payerBank.trim() || undefined,
      paymentReference: draft.paymentReference.trim() || undefined,
      paymentAmount: amountValue,
      paymentCurrency: draft.paymentCurrency.trim() || undefined,
    });
  }

  const reminderMutation = useMutation({
    mutationFn: (input: { certificationId: string; companyName: string }) =>
      api.post<{ success: boolean; skipped?: boolean }>("/client/reminders", {
        certificationId: input.certificationId,
        title: "Seguimiento de certificacion PCI DSS",
        message: `Hola, estamos dando seguimiento a la certificacion PCI DSS de ${input.companyName}. Por favor revisa tus pendientes en la plataforma.`,
      }),
    onSuccess(response) {
      setError("");
      setSuccess(response.skipped ? "Ya existia un recordatorio similar en las ultimas 24 horas." : "Recordatorio enviado al dashboard del cliente.");
      queryClient.invalidateQueries({ queryKey: ["admin-operations-summary"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible enviar el recordatorio.");
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (input: CreateClientForm) =>
      api.post<{ username: string; temporaryPassword: string; welcomeEmailSent: boolean }>("/executive/clients", {
        companyName: input.companyName.trim(),
        businessType: input.businessType.trim(),
        primaryContactName: input.primaryContactName.trim(),
        primaryContactEmail: input.primaryContactEmail.trim(),
        primaryContactPhone: input.primaryContactPhone.trim() || undefined,
        primaryContactTitle: input.primaryContactTitle.trim() || undefined,
        username: input.username.trim(),
        temporaryPassword: input.temporaryPassword,
        saqTypeId: input.saqTypeId,
        cycleYear: Number(input.cycleYear),
        paymentState: input.paymentState,
      }),
    onSuccess(response) {
      setError("");
      setSuccess(
        response.welcomeEmailSent
          ? "Cliente creado. Se envio el correo de bienvenida."
          : "Cliente creado. No se pudo enviar el correo de bienvenida; comparte las credenciales manualmente.",
      );
      setCreatedCredentials({ username: response.username, password: response.temporaryPassword });
      setCreateForm(EMPTY_CREATE_FORM);
      setShowCreateForm(false);
      queryClient.invalidateQueries({ queryKey: ["executive-certifications"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible crear el cliente.");
    },
  });

  const assessorMutation = useMutation({
    mutationFn: (input: { clientId: string } & AssessorDraft) =>
      api.patch<{ id: string }>(`/executive/clients/${input.clientId}/assessor`, {
        assessorIsaName: input.assessorIsaName.trim(),
        assessorQsaCompany: input.assessorQsaCompany.trim(),
        assessorQsaLeadName: input.assessorQsaLeadName.trim(),
      }),
    onSuccess(_data, variables) {
      setError("");
      setSuccess("Datos del asesor (QSA/ISA) actualizados.");
      setAssessorDrafts((current) => {
        const next = { ...current };
        delete next[variables.clientId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["executive-certifications"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible actualizar el asesor.");
    },
  });

  const approveChangeMutation = useMutation({
    mutationFn: (input: { id: string; notes?: string }) =>
      api.post<{ id: string }>(`/saq-change-requests/${input.id}/approve`, { notes: input.notes || undefined }),
    onSuccess() {
      setError("");
      setSuccess("Solicitud de cambio de SAQ aprobada.");
      queryClient.invalidateQueries({ queryKey: ["executive-change-requests"] });
      queryClient.invalidateQueries({ queryKey: ["executive-certifications"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible aprobar la solicitud.");
    },
  });

  const rejectChangeMutation = useMutation({
    mutationFn: (input: { id: string; notes?: string }) =>
      api.post<{ id: string }>(`/saq-change-requests/${input.id}/reject`, { notes: input.notes || undefined }),
    onSuccess() {
      setError("");
      setSuccess("Solicitud de cambio de SAQ rechazada.");
      queryClient.invalidateQueries({ queryKey: ["executive-change-requests"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible rechazar la solicitud.");
    },
  });

  function getAssessorDraft(item: ExecutiveCertificationsResponse["items"][number]): AssessorDraft {
    return (
      assessorDrafts[item.clientId] ?? {
        assessorIsaName: item.assessorIsaName ?? "",
        assessorQsaCompany: item.assessorQsaCompany ?? "",
        assessorQsaLeadName: item.assessorQsaLeadName ?? "",
      }
    );
  }

  function updateAssessorDraft(clientId: string, base: AssessorDraft, patch: Partial<AssessorDraft>) {
    setAssessorDrafts((current) => ({ ...current, [clientId]: { ...base, ...patch } }));
  }

  function submitCreateClient(event: FormEvent) {
    event.preventDefault();
    if (!createForm.saqTypeId) {
      setSuccess("");
      setError("Selecciona un tipo de SAQ para el nuevo cliente.");
      return;
    }
    if (createForm.temporaryPassword.length < 8) {
      setSuccess("");
      setError("La contrasena temporal debe tener al menos 8 caracteres.");
      return;
    }
    createClientMutation.mutate(createForm);
  }

  if (certificationsQuery.isLoading) {
    return <div className="loading-panel">Cargando portafolio ejecutivo...</div>;
  }

  if (certificationsQuery.isError) {
    return (
      <div className="error-panel">
        No fue posible cargar el portafolio. {certificationsQuery.error instanceof Error ? certificationsQuery.error.message : "Revisa permisos de ejecutivo."}
      </div>
    );
  }

  return (
    <div className="page-stack executive-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Ejecutivo</p>
          <h1>Portafolio de clientes</h1>
          <p className="page-subtitle">
            Seguimiento de SAQ, pagos, vencimientos y recordatorios para clientes asignados.
          </p>
        </div>
      </section>

      <section className="operations-kpi-grid">
        <article className="stat-card">
          <span>Clientes asignados</span>
          <strong>{certifications.length}</strong>
        </article>
        <article className="stat-card">
          <span>Pagos pendientes</span>
          <strong>{metrics.paymentPending}</strong>
        </article>
        <article className="stat-card">
          <span>Listos para salida</span>
          <strong>{metrics.ready}</strong>
        </article>
        <article className="stat-card">
          <span>Vencen pronto</span>
          <strong>{metrics.expiring}</strong>
        </article>
        <article className="stat-card">
          <span>Sin avance</span>
          <strong>{metrics.abandoned}</strong>
        </article>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {success ? <p className="success-text">{success}</p> : null}

      {createdCredentials ? (
        <section className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Credenciales</p>
              <h2>Cliente creado</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => setCreatedCredentials(null)}>
              Cerrar
            </button>
          </div>
          <p className="subtle-text">
            Comparte estas credenciales con el cliente de forma segura. La contrasena deber&aacute; cambiarse en el primer
            ingreso.
          </p>
          <p>
            <strong>Usuario:</strong> {createdCredentials.username} &nbsp;|&nbsp;{" "}
            <strong>Contrase&ntilde;a temporal:</strong> {createdCredentials.password}
          </p>
        </section>
      ) : null}

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Alta de clientes</p>
            <h2>Crear cliente</h2>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setShowCreateForm((value) => !value);
              setError("");
            }}
          >
            {showCreateForm ? "Cancelar" : "Nuevo cliente"}
          </button>
        </div>
        {showCreateForm ? (
          <form
            onSubmit={submitCreateClient}
            className="field-grid"
            style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}
          >
            <label className="field">
              <span>Empresa *</span>
              <input
                value={createForm.companyName}
                onChange={(event) => setCreateForm((form) => ({ ...form, companyName: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Giro / tipo de negocio *</span>
              <input
                value={createForm.businessType}
                onChange={(event) => setCreateForm((form) => ({ ...form, businessType: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Contacto principal *</span>
              <input
                value={createForm.primaryContactName}
                onChange={(event) => setCreateForm((form) => ({ ...form, primaryContactName: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Puesto del contacto</span>
              <input
                value={createForm.primaryContactTitle}
                onChange={(event) => setCreateForm((form) => ({ ...form, primaryContactTitle: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Correo del contacto *</span>
              <input
                type="email"
                value={createForm.primaryContactEmail}
                onChange={(event) => setCreateForm((form) => ({ ...form, primaryContactEmail: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Tel&eacute;fono del contacto</span>
              <input
                value={createForm.primaryContactPhone}
                onChange={(event) => setCreateForm((form) => ({ ...form, primaryContactPhone: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Usuario de acceso *</span>
              <input
                value={createForm.username}
                onChange={(event) => setCreateForm((form) => ({ ...form, username: event.target.value }))}
                required
                minLength={3}
              />
            </label>
            <label className="field">
              <span>Contrase&ntilde;a temporal *</span>
              <input
                value={createForm.temporaryPassword}
                onChange={(event) => setCreateForm((form) => ({ ...form, temporaryPassword: event.target.value }))}
                required
                minLength={8}
              />
            </label>
            <label className="field">
              <span>Tipo de SAQ *</span>
              <select
                value={createForm.saqTypeId}
                onChange={(event) => setCreateForm((form) => ({ ...form, saqTypeId: event.target.value }))}
                required
              >
                <option value="">Selecciona un SAQ</option>
                {saqTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Ciclo (a&ntilde;o) *</span>
              <input
                type="number"
                min="2020"
                max="2100"
                value={createForm.cycleYear}
                onChange={(event) => setCreateForm((form) => ({ ...form, cycleYear: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Estado de pago inicial</span>
              <select
                value={createForm.paymentState}
                onChange={(event) => setCreateForm((form) => ({ ...form, paymentState: event.target.value }))}
              >
                {PAYMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field" style={{ alignSelf: "end" }}>
              <button type="submit" className="primary-button" disabled={createClientMutation.isPending}>
                {createClientMutation.isPending ? "Creando..." : "Crear cliente"}
              </button>
            </div>
          </form>
        ) : (
          <p className="subtle-text" style={{ marginTop: "8px" }}>
            Da de alta una empresa nueva con su usuario de acceso y tipo de SAQ. El cliente queda asignado a tu cartera.
          </p>
        )}
      </section>

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Solicitudes</p>
            <h2>Cambios de SAQ</h2>
          </div>
          <span className="soft-badge">{pendingChangeRequests.length} pendiente(s)</span>
        </div>
        <div className="outputs-list-stack" style={{ marginTop: "12px" }}>
          {changeRequests.length === 0 ? (
            <p className="subtle-text">No hay solicitudes de cambio de SAQ.</p>
          ) : (
            changeRequests.map((request) => (
              <article key={request.id} className="mini-card">
                <div className="document-list-copy">
                  <strong>{request.companyName}</strong>
                  <p className="subtle-text">
                    SAQ actual: {request.currentSaqType}
                    {request.requestedSaqType ? ` - Solicitado: ${request.requestedSaqType}` : ""}
                  </p>
                  <p className="subtle-text">Motivo: {request.reason}</p>
                  <p className="subtle-text">
                    {statusLabel(request.status)} - {formatDate(request.createdAt)}
                    {request.resolutionNotes ? ` - Nota: ${request.resolutionNotes}` : ""}
                  </p>
                </div>
                {request.status === "PENDING" ? (
                  <div className="executive-actions">
                    <label className="field">
                      <span>Nota de resoluci&oacute;n</span>
                      <input
                        value={resolutionNotes[request.id] ?? ""}
                        onChange={(event) =>
                          setResolutionNotes((current) => ({ ...current, [request.id]: event.target.value }))
                        }
                        placeholder="Opcional"
                      />
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={approveChangeMutation.isPending}
                      onClick={() => approveChangeMutation.mutate({ id: request.id, notes: resolutionNotes[request.id] })}
                    >
                      Aprobar
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={rejectChangeMutation.isPending}
                      onClick={() => rejectChangeMutation.mutate({ id: request.id, notes: resolutionNotes[request.id] })}
                    >
                      Rechazar
                    </button>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Clientes</p>
            <h2>Certificaciones activas</h2>
          </div>
          <span className="soft-badge">
            {filteredCertifications.length} / {certifications.length} registro(s)
          </span>
        </div>

        <div
          className="field-grid"
          style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}
        >
          <label className="field">
            <span>Buscar</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Empresa o SAQ..."
            />
          </label>
          <label className="field">
            <span>Estado de pago</span>
            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <option value="ALL">Todos los pagos</option>
              {PAYMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Vencimiento</span>
            <select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value as ExpiryFilter)}>
              <option value="ALL">Todas</option>
              <option value="SOON">Vence en 60 dias</option>
              <option value="OVERDUE">Vencidas</option>
            </select>
          </label>
        </div>

        <div className="outputs-list-stack" style={{ marginTop: "16px" }}>
          {certifications.length === 0 ? (
            <p className="subtle-text">No tienes clientes asignados actualmente.</p>
          ) : filteredCertifications.length === 0 ? (
            <p className="subtle-text">Ningun cliente coincide con los filtros actuales.</p>
          ) : (
            filteredCertifications.map((item) => {
              const draft = getDraft(item);
              const showPaymentDetails = draft.state === "PAID";
              const recordedAmount = formatAmount(item.paymentAmount, item.paymentCurrency);
              const overdue = isOverdue(item.validUntil);
              return (
                <article key={item.id} className="mini-card executive-client-card">
                  <div className="document-list-copy">
                    <strong>{item.companyName}</strong>
                    <p className="subtle-text">
                      {item.saqType} - Ciclo {item.cycleYear} - {statusLabel(item.status)}
                    </p>
                    <p className="subtle-text">
                      Respuestas: {item.answeredCount} - Evidencias: {item.evidenceCount} - Salidas: {item.generatedDocumentCount}
                    </p>
                    <p className="subtle-text" style={overdue ? { color: "var(--warning)" } : undefined}>
                      Vigencia: {formatDate(item.validUntil)} {overdue ? "(vencida)" : isExpiringSoon(item.validUntil) ? "(vence pronto)" : ""}
                    </p>
                    <p className="subtle-text">
                      Pago actual: {statusLabel(item.paymentState)}
                      {recordedAmount ? ` - ${recordedAmount}` : ""}
                      {item.payerBank ? ` - ${item.payerBank}` : ""}
                      {item.paymentReference ? ` - Ref. ${item.paymentReference}` : ""}
                      {item.paidAt ? ` - ${formatDate(item.paidAt)}` : ""}
                    </p>
                  </div>
                  <div className="executive-actions">
                    <label className="field">
                      <span>Pago</span>
                      <select
                        value={draft.state}
                        onChange={(event) => updateDraft(item.id, draft, { state: event.target.value })}
                      >
                        {PAYMENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {showPaymentDetails ? (
                      <>
                        <label className="field">
                          <span>Banco</span>
                          <input
                            value={draft.payerBank}
                            onChange={(event) => updateDraft(item.id, draft, { payerBank: event.target.value })}
                            placeholder="Banco emisor"
                          />
                        </label>
                        <label className="field">
                          <span>Numero de seguimiento</span>
                          <input
                            value={draft.paymentReference}
                            onChange={(event) => updateDraft(item.id, draft, { paymentReference: event.target.value })}
                            placeholder="Referencia / folio"
                          />
                        </label>
                        <label className="field">
                          <span>Monto</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.paymentAmount}
                            onChange={(event) => updateDraft(item.id, draft, { paymentAmount: event.target.value })}
                            placeholder="0.00"
                          />
                        </label>
                        <label className="field">
                          <span>Moneda</span>
                          <input
                            value={draft.paymentCurrency}
                            onChange={(event) => updateDraft(item.id, draft, { paymentCurrency: event.target.value })}
                            placeholder="MXN"
                          />
                        </label>
                      </>
                    ) : null}
                    <label className="field">
                      <span>Nota interna</span>
                      <input
                        value={draft.notes}
                        onChange={(event) => updateDraft(item.id, draft, { notes: event.target.value })}
                        placeholder="Opcional"
                      />
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={paymentMutation.isPending}
                      onClick={() => savePayment(item)}
                    >
                      Guardar pago
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={reminderMutation.isPending}
                      onClick={() => reminderMutation.mutate({ certificationId: item.id, companyName: item.companyName })}
                    >
                      Enviar recordatorio
                    </button>
                  </div>
                  <details className="assessor-editor" style={{ marginTop: "8px" }}>
                    <summary className="subtle-text" style={{ cursor: "pointer" }}>
                      Datos del asesor (QSA / ISA)
                    </summary>
                    {(() => {
                      const assessorDraft = getAssessorDraft(item);
                      return (
                        <div
                          className="field-grid"
                          style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}
                        >
                          <label className="field">
                            <span>Nombre del ISA</span>
                            <input
                              value={assessorDraft.assessorIsaName}
                              onChange={(event) =>
                                updateAssessorDraft(item.clientId, assessorDraft, { assessorIsaName: event.target.value })
                              }
                              placeholder="No aplicable"
                            />
                          </label>
                          <label className="field">
                            <span>Empresa QSA</span>
                            <input
                              value={assessorDraft.assessorQsaCompany}
                              onChange={(event) =>
                                updateAssessorDraft(item.clientId, assessorDraft, { assessorQsaCompany: event.target.value })
                              }
                              placeholder="No aplicable"
                            />
                          </label>
                          <label className="field">
                            <span>Lider QSA</span>
                            <input
                              value={assessorDraft.assessorQsaLeadName}
                              onChange={(event) =>
                                updateAssessorDraft(item.clientId, assessorDraft, { assessorQsaLeadName: event.target.value })
                              }
                              placeholder="No aplicable"
                            />
                          </label>
                          <div className="field" style={{ alignSelf: "end" }}>
                            <button
                              type="button"
                              className="ghost-button"
                              disabled={assessorMutation.isPending}
                              onClick={() => assessorMutation.mutate({ clientId: item.clientId, ...assessorDraft })}
                            >
                              Guardar asesor
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </details>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
