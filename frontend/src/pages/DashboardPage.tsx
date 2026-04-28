import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useSession } from "../context/session-context";
import { api } from "../lib/api";
import { ClientDocumentsResponse, DashboardResponse } from "../types";
import { SignaturePad } from "../components/SignaturePad";
import { useState } from "react";

const STATUS_ES: Record<string, string> = {
  DRAFT: "Borrador",
  IN_PROGRESS: "En progreso",
  READY_TO_GENERATE: "Listo para generar",
  GENERATED: "Generado",
  FINALIZED: "Finalizado",
  ARCHIVED: "Archivado",
  COMPLETED: "Completado",
  BLOCKED: "Bloqueado",
  NOT_STARTED: "No iniciado",
  "IN PROGRESS": "En progreso",
};

const PAYMENT_ES: Record<string, string> = {
  UNPAID: "NO PAGADO",
  PENDING: "Pendiente",
  PAID: "Pagado",
  OVERDUE: "Vencido",
  unpaid: "NO PAGADO",
  paid: "Pagado",
};
async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function formatDate(value?: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

type StaffCertificationList = {
  items: Array<{
    id: string;
    companyName: string;
    saqType: string;
    cycleYear: number;
    status: string;
    paymentState: string;
    evidenceCount: number;
    generatedDocumentCount: number;
    answeredCount: number;
    issuedAt?: string | null;
    validUntil?: string | null;
  }>;
};

type ReminderSchedulerStatus = {
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastResult: {
    success?: boolean;
    scanSkipped?: boolean;
    source?: string;
    scanned?: number;
    candidates?: number;
    sent?: number;
    skipped?: number;
    reason?: string;
  } | null;
  lastError: string | null;
  nextRunAt: string | null;
  runInProgress: boolean;
};

function formatSchedulerResult(result: ReminderSchedulerStatus["lastResult"]) {
  if (!result) {
    return "Sin ejecuciones registradas.";
  }

  if (result.scanSkipped) {
    return result.reason ?? "Ejecucion omitida porque ya habia un escaneo activo.";
  }

  return `Escaneadas: ${result.scanned ?? 0} · Candidatos: ${result.candidates ?? 0} · Enviados: ${result.sent ?? 0} · Duplicados: ${result.skipped ?? 0}`;
}

function StaffDashboard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const certificationsQuery = useQuery({
    queryKey: ["staff-certifications"],
    queryFn: () => api.get<StaffCertificationList>("/client/certifications"),
  });
  const schedulerQuery = useQuery({
    queryKey: ["reminder-scheduler-status"],
    queryFn: () => api.get<ReminderSchedulerStatus>("/client/reminders/scheduler-status"),
    enabled: user?.role === "ADMIN",
  });

  const paymentMutation = useMutation({
    mutationFn: (payload: { certificationId: string; state: string }) =>
      api.patch<{ success: boolean }>("/client/payment-state", payload),
    onSuccess: async () => {
      setMessage("Estado de pago actualizado.");
      await queryClient.invalidateQueries({ queryKey: ["staff-certifications"] });
    },
    onError(error) {
      setMessage(error instanceof Error ? error.message : "No fue posible actualizar el pago.");
    },
  });

  const reminderMutation = useMutation({
    mutationFn: (certificationId: string) =>
      api.post<{ success: boolean; skipped: boolean }>("/client/reminders", {
        certificationId,
        title: "Recordatorio de avance",
        message: "Te recordamos revisar pendientes de cuestionario, evidencia, firma o pago para continuar con la certificacion.",
      }),
    onSuccess(result) {
      setMessage(result.skipped ? "Recordatorio duplicado prevenido." : "Recordatorio enviado al panel del cliente.");
    },
    onError(error) {
      setMessage(error instanceof Error ? error.message : "No fue posible enviar el recordatorio.");
    },
  });

  const schedulerRunMutation = useMutation({
    mutationFn: () => api.post<ReminderSchedulerStatus["lastResult"]>("/client/reminders/scheduler-run-now"),
    onSuccess: async (result) => {
      setMessage(result?.scanSkipped ? "Escaneo omitido porque ya habia uno en proceso." : "Escaneo de recordatorios ejecutado.");
      await queryClient.invalidateQueries({ queryKey: ["reminder-scheduler-status"] });
    },
    onError(error) {
      setMessage(error instanceof Error ? error.message : "No fue posible ejecutar el escaneo de recordatorios.");
    },
  });

  if (certificationsQuery.isLoading) {
    return <div className="loading-panel">Cargando certificaciones...</div>;
  }

  if (certificationsQuery.isError || !certificationsQuery.data) {
    return <div className="error-panel">No fue posible cargar el panel operativo.</div>;
  }

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Panel operativo</p>
          <h1>Clientes y pagos</h1>
          <p className="page-subtitle">Actualiza pagos, revisa evidencias y envia recordatorios sin duplicados.</p>
        </div>
      </section>

      {message ? <p className="info-text">{message}</p> : null}

      {user?.role === "ADMIN" ? (
        <section className="single-page-card wide placeholder-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Recordatorios automaticos</p>
              <h2>Scheduler backend</h2>
            </div>
            <span className={`soft-badge ${schedulerQuery.data?.enabled ? "success" : ""}`}>
              {schedulerQuery.data?.enabled ? "Activo" : "Inactivo"}
            </span>
          </div>
          {schedulerQuery.isLoading ? (
            <p className="subtle-text">Cargando estado del scheduler...</p>
          ) : schedulerQuery.isError || !schedulerQuery.data ? (
            <p className="error-text">No fue posible cargar el estado del scheduler.</p>
          ) : (
            <>
              <div className="stats-grid" style={{ marginTop: "14px" }}>
                <article className="stat-card">
                  <p>Intervalo</p>
                  <strong>{schedulerQuery.data.intervalMinutes} min</strong>
                </article>
                <article className="stat-card">
                  <p>En ejecucion</p>
                  <strong>{schedulerQuery.data.runInProgress ? "Si" : "No"}</strong>
                </article>
                <article className="stat-card">
                  <p>Ultima ejecucion</p>
                  <strong>{formatDate(schedulerQuery.data.lastFinishedAt)}</strong>
                </article>
                <article className="stat-card">
                  <p>Siguiente ejecucion</p>
                  <strong>{formatDate(schedulerQuery.data.nextRunAt)}</strong>
                </article>
              </div>
              <p className="subtle-text" style={{ marginTop: "12px" }}>
                {formatSchedulerResult(schedulerQuery.data.lastResult)}
              </p>
              {schedulerQuery.data.lastError ? <p className="error-text">{schedulerQuery.data.lastError}</p> : null}
              <button
                type="button"
                className="primary-button"
                style={{ marginTop: "14px" }}
                disabled={schedulerQuery.data.runInProgress || schedulerRunMutation.isPending}
                onClick={() => schedulerRunMutation.mutate()}
              >
                {schedulerRunMutation.isPending ? "Ejecutando..." : "Ejecutar escaneo ahora"}
              </button>
            </>
          )}
        </section>
      ) : null}

      <section className="single-page-card wide placeholder-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Certificaciones activas</p>
            <h2>Seguimiento de Milestone 2</h2>
          </div>
          <span className="soft-badge">{certificationsQuery.data.items.length} ciclos</span>
        </div>
        <div className="documents-list-stack">
          {certificationsQuery.data.items.map((item) => (
            <article key={item.id} className="mini-card document-list-item">
              <div className="document-list-copy">
                <strong>{item.companyName}</strong>
                <p className="subtle-text">
                  {item.saqType} · Ciclo {item.cycleYear} · {STATUS_ES[item.status] ?? item.status}
                </p>
                <p className="subtle-text">
                  Respuestas: {item.answeredCount} · Evidencias: {item.evidenceCount} · Generados: {item.generatedDocumentCount}
                </p>
              </div>
              <div className="documents-action-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                <select
                  value={item.paymentState}
                  onChange={(event) => paymentMutation.mutate({ certificationId: item.id, state: event.target.value })}
                >
                  <option value="UNPAID">No pagado</option>
                  <option value="PENDING">Pendiente</option>
                  <option value="PAID">Pagado</option>
                  <option value="OVERDUE">Vencido</option>
                </select>
                <button type="button" className="ghost-button" onClick={() => reminderMutation.mutate(item.id)}>
                  Enviar recordatorio
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useSession();
  return user?.role && user.role !== "CLIENT" ? <StaffDashboard /> : <ClientDashboard />;
}

function ClientDashboard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/client/dashboard"),
  });
  const documentsQuery = useQuery({
    queryKey: ["client-documents"],
    queryFn: () => api.get<ClientDocumentsResponse>("/client/documents"),
  });
  const [isDrawingSignature, setIsDrawingSignature] = useState(false);
  const [renewalMessage, setRenewalMessage] = useState("");
  const [renewalScopeChanged, setRenewalScopeChanged] = useState("false");
  const [renewalCardHandlingChanged, setRenewalCardHandlingChanged] = useState("false");
  const [renewalNotes, setRenewalNotes] = useState("");

  const signatureMutation = useMutation({
    mutationFn: async (file: File) => {
      const imageDataUrl = await fileToDataUrl(file);
      return api.post<{ success: boolean }>("/saq/signature", { imageDataUrl });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["saq-current"] });
      setIsDrawingSignature(false);
    },
  });
  const renewalMutation = useMutation({
    mutationFn: (payload: { scopeChanged: boolean; cardHandlingChanged: boolean; notes?: string }) =>
      api.post<{ success: boolean; preloaded: boolean }>("/client/renewals", payload),
    onSuccess: async (result) => {
      setRenewalMessage(result.preloaded ? "Renovacion iniciada con respuestas precargadas." : "Renovacion iniciada sin precarga por cambio de alcance.");
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["saq-current"] });
    },
    onError(error) {
      setRenewalMessage(error instanceof Error ? error.message : "No fue posible iniciar la renovacion.");
    },
  });

  if (dashboardQuery.isLoading) {
    return <div className="loading-panel">Cargando panel...</div>;
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return <div className="error-panel">No fue posible cargar el panel del cliente.</div>;
  }

  const { client, certification, stats, topics, messages } = dashboardQuery.data;

  return (
    <div className="page-stack">
      {/* ── Page header ── */}
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Panel del cliente</p>
          <h1>Bienvenido, {user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : (user?.username || client.companyName)}</h1>
          <p className="page-subtitle">Panel de control del proceso de certificacion PCI DSS.</p>
        </div>
      </section>

      {/* ── Tutorial Callout ── */}
      <section className="tutorial-callout" style={{ 
        background: "var(--blue-050)", 
        border: "1px solid var(--blue-400)", 
        borderRadius: "var(--radius-md)", 
        padding: "16px 20px", 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: "24px"
      }}>
        <div style={{ flex: 1, paddingRight: "16px" }}>
          <strong style={{ color: "var(--blue-600)", fontSize: "0.95rem" }}>¿Nuevo en la plataforma?</strong>
          <p style={{ color: "var(--ink-700)", fontSize: "0.85rem", marginTop: "4px" }}>
            Te recomendamos revisar nuestro tutorial interactivo guiado y el manual de uso.
          </p>
        </div>
        <Link className="primary-button" to="/tutorial" style={{ whiteSpace: "nowrap" }}>
          Ver tutorial
        </Link>
      </section>

      {/* ── Certification hero + quick actions ── */}
      <section className="dashboard-top-grid">
        <article className="certification-hero-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Estado de certificacion</p>
              <h2>{client.companyName}</h2>
              <p className="subtle-text" style={{ marginTop: "4px" }}>
                Cuestionario asignado: <strong>{certification.saqType}</strong> · Ciclo <strong>{certification.cycleYear}</strong>
                {certification.preloadedFromCertificationId ? " · Respuestas precargadas" : ""}
              </p>
            </div>
            <span className={`status-chip payment-chip ${certification.paymentState.toLowerCase()}`}>
              {PAYMENT_ES[certification.paymentState.toUpperCase()] || certification.paymentState}
            </span>
          </div>

          <div className="hero-summary-grid">
            <div className="progress-ring-card">
              <div
                className="progress-ring"
                style={{ ["--progress" as string]: `${stats.progressPercentage}%` }}
                aria-label={`${stats.progressPercentage}% progress`}
              >
                <div>
                  <strong>{stats.progressPercentage}%</strong>
                  <span>Avance</span>
                </div>
              </div>
            </div>

            <div className="hero-cert-meta">
              <div className="hero-meta-line">
                <span>Estado</span>
                <strong>{STATUS_ES[certification.status] || STATUS_ES[certification.status.replaceAll("_", " ")] || certification.status.replaceAll("_", " ")}</strong>
              </div>
              <div className="hero-meta-line">
                <span>Requisitos</span>
                <strong>
                  {stats.answeredCount} / {stats.totalRequirements}
                </strong>
              </div>
              <div className="hero-meta-line">
                <span>Ultimo tema</span>
                <strong>{certification.lastViewedTopicCode ?? "Inicio"}</strong>
              </div>
              <Link className="primary-button hero-primary-action" to="/questionnaire">
                Continuar cuestionario
              </Link>
            </div>
          </div>
        </article>

        <article className="quick-actions-card">
          <p className="brand-eyebrow">Acciones rapidas</p>
          <h3>Flujo principal</h3>
          <div className="quick-action-list">
            <Link className="quick-action-button" to="/questionnaire">
              <span>Cuestionario SAQ</span>
              <strong>01</strong>
            </Link>
            <Link className="quick-action-button" to="/documents">
              <span>Gestionar documentos</span>
              <strong>02</strong>
            </Link>
            <Link className="quick-action-button" to="/outputs">
              <span>Revisar salidas</span>
              <strong>03</strong>
            </Link>
            <Link className="quick-action-button" to="/tutorial">
              <span>Ver tutorial de uso</span>
              <strong>04</strong>
            </Link>
            <Link className="quick-action-button" to="/repository">
              <span>Repositorio y plantillas</span>
              <strong>05</strong>
            </Link>
          </div>
        </article>
      </section>

      {/* ── Key metrics ── */}
      <section className="stats-grid">
        <article className="stat-card">
          <p className="muted-label">Avance general</p>
          <strong>{stats.progressPercentage}%</strong>
          <span>{stats.answeredCount} de {stats.totalRequirements} requisitos respondidos</span>
        </article>
        <article className="stat-card">
          <p className="muted-label">Pendientes</p>
          <strong>{stats.unansweredCount}</strong>
          <span>Elementos restantes para completar el cuestionario</span>
        </article>
        <article className="stat-card">
          <p className="muted-label">Evidencia pendiente</p>
          <strong>{stats.pendingEvidenceCount}</strong>
          <span>{stats.uploadedEvidenceCount} evidencias cargadas de {stats.requiredEvidenceCount} requeridas</span>
        </article>
        <article className="stat-card">
          <p className="muted-label">Firma</p>
          <strong>{certification.hasSignature ? "Registrada" : "Pendiente"}</strong>
          <span>Se requerira antes de la generacion final</span>
        </article>
      </section>

      {/* ── Topic progress + certification details ── */}
      <section className="two-column-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="muted-label">Avance por capitulo</p>
              <h3>Progreso por tema PCI</h3>
            </div>
            <span className="soft-badge">{STATUS_ES[certification.status] || certification.status.replaceAll("_", " ")}</span>
          </div>
          <div className="topic-progress-list" style={{ marginTop: "16px" }}>
            {topics.map((topic) => (
              <div key={topic.topicCode} className="topic-progress-row">
                <div className="topic-meta">
                  <strong>{topic.topicName}</strong>
                  <span>
                    {topic.answered}/{topic.total}
                  </span>
                </div>
                <div className="progress-bar">
                  <span style={{ width: `${topic.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="muted-label">Marco de certificacion</p>
              <h3>Detalle del ciclo actual</h3>
            </div>
          </div>
          <div className="detail-list" style={{ marginTop: "12px" }}>
            <div>
              <span>Giro</span>
              <strong>{client.businessType}</strong>
            </div>
            <div>
              <span>Ultimo tema abierto</span>
              <strong>{certification.lastViewedTopicCode ?? "Comenzar desde el capitulo 1"}</strong>
            </div>
            <div>
              <span>Fecha de emision</span>
              <strong>{formatDate(certification.issueDate)}</strong>
            </div>
            <div>
              <span>Vigencia</span>
              <strong>{formatDate(certification.validUntil)}</strong>
            </div>
            <div>
              <span>Fecha objetivo</span>
              <strong>{formatDate(certification.validUntil)}</strong>
            </div>
          </div>

          <div className="mini-card" style={{ marginTop: "16px" }}>
            <p className="muted-label">Renovacion</p>
            <strong>Iniciar nuevo ciclo</strong>
            <p className="subtle-text" style={{ marginTop: "6px" }}>
              Antes de precargar respuestas, confirma si cambio el alcance o el manejo de tarjetas.
            </p>
            {certification.status === "GENERATED" || certification.status === "FINALIZED" ? (
              <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
                <label className="field">
                  <span>Cambio el alcance?</span>
                  <select value={renewalScopeChanged} onChange={(event) => setRenewalScopeChanged(event.target.value)}>
                    <option value="false">No, mantener alcance</option>
                    <option value="true">Si, cambio alcance</option>
                  </select>
                </label>
                <label className="field">
                  <span>Cambio el manejo de tarjetas?</span>
                  <select value={renewalCardHandlingChanged} onChange={(event) => setRenewalCardHandlingChanged(event.target.value)}>
                    <option value="false">No, mismo manejo</option>
                    <option value="true">Si, cambio manejo</option>
                  </select>
                </label>
                <label className="field">
                  <span>Notas de renovacion</span>
                  <textarea rows={2} value={renewalNotes} onChange={(event) => setRenewalNotes(event.target.value)} placeholder="Describe cambios o confirma continuidad." />
                </label>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={renewalMutation.isPending}
                  onClick={() =>
                    renewalMutation.mutate({
                      scopeChanged: renewalScopeChanged === "true",
                      cardHandlingChanged: renewalCardHandlingChanged === "true",
                      notes: renewalNotes.trim() || undefined,
                    })
                  }
                >
                  {renewalMutation.isPending ? "Iniciando..." : "Iniciar renovacion"}
                </button>
              </div>
            ) : (
              <p className="subtle-text" style={{ marginTop: "8px" }}>
                La renovacion se habilita cuando exista una certificacion generada o finalizada.
              </p>
            )}
            {renewalMessage ? <p className="info-text" style={{ marginTop: "8px" }}>{renewalMessage}</p> : null}
          </div>

          <div className="signature-upload">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <p className="muted-label">Firma automatizada</p>
              {!certification.signaturePreviewUrl && !isDrawingSignature && (
                <button type="button" className="ghost-button" onClick={() => setIsDrawingSignature(true)} style={{ padding: "4px 8px", fontSize: "0.75rem" }}>
                  Trazar con mouse
                </button>
              )}
            </div>

            {isDrawingSignature ? (
              <SignaturePad 
                onSave={(file) => signatureMutation.mutate(file)}
                onCancel={() => setIsDrawingSignature(false)} 
              />
            ) : (
              !certification.signaturePreviewUrl && (
                <label className="field">
                  <span>O Cargar firma desde archivo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        signatureMutation.mutate(file);
                      }
                    }}
                  />
                </label>
              )
            )}

            {signatureMutation.isPending ? <p className="info-text" style={{ marginTop: "8px" }}>Cargando firma...</p> : null}
            {signatureMutation.isSuccess ? <p className="success-text" style={{ marginTop: "8px" }}>La firma quedo asociada a esta certificacion.</p> : null}
            {signatureMutation.isError ? <p className="error-text" style={{ marginTop: "8px" }}>No fue posible guardar la firma.</p> : null}
            {certification.signaturePreviewUrl && !isDrawingSignature ? (
              <div className="signature-preview">
                <img src={certification.signaturePreviewUrl} alt="Vista previa de firma almacenada" />
                <button type="button" className="ghost-button" onClick={() => setIsDrawingSignature(true)} style={{ marginTop: "8px", fontSize: "0.75rem", padding: "4px 8px", width: "fit-content" }}>
                  Actualizar firma
                </button>
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {/* ── Onboarding cards ── */}
      <section className="three-column-grid">
        <article className="mini-card">
          <p className="muted-label">Inicio</p>
          <strong>Comienza con el SAQ asignado</strong>
          <p>Revisa las respuestas precargadas, valida el alcance de tu empresa y avanza capitulo por capitulo.</p>
        </article>
        <article className="mini-card">
          <p className="muted-label">Documentos</p>
          <strong>Repositorio seguro</strong>
          <p>El panel ya reserva el espacio documental requerido por el flujo final de certificacion.</p>
        </article>
        <article className="mini-card">
          <p className="muted-label">Continuidad</p>
          <strong>Retoma donde te quedaste</strong>
          <p>La plataforma recuerda el ultimo tema abierto para que cada regreso se sienta continuo.</p>
        </article>
      </section>

      {/* ── Documents + messages ── */}
      <section className="two-column-grid lower-dashboard-grid">
        <section className="panel empty-state-panel">
          <div className="panel-header">
            <div>
              <p className="muted-label">Documentos recientes</p>
              <h3>
                {documentsQuery.data?.items.length
                  ? `${documentsQuery.data.items.length} documentos cargados`
                  : "Sin documentos todavia"}
              </h3>
            </div>
          </div>
          {documentsQuery.data?.items.length ? (
            <div className="message-list" style={{ marginTop: "12px" }}>
              {documentsQuery.data.items.slice(0, 3).map((item) => (
                <article key={item.id} className="message-card info">
                  <strong>{item.title}</strong>
                  <p>
                    {item.fileName} · {formatDate(item.createdAt)}
                  </p>
                </article>
              ))}
            </div>
          ) : (
              <div className="document-placeholder">
              <div className="document-placeholder-icon">DOC</div>
              <p className="subtle-text">
                Descarga una plantilla en Plantillas, editala y regresa el documento resultante en Documentos para verlo reflejado aqui.
              </p>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="muted-label">Informacion</p>
              <h3>Mensajes del proceso</h3>
            </div>
          </div>
          <div className="message-list" style={{ marginTop: "12px" }}>
            {messages.map((message) => (
              <article key={message.id} className={`message-card ${message.messageType.toLowerCase()}`}>
                <strong>{message.title}</strong>
                <p>{message.message}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
