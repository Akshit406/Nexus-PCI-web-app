import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useSession } from "../context/session-context";
import { api } from "../lib/api";
import { ClientDocumentsResponse, DashboardResponse } from "../types";
import { SignaturePad } from "../components/SignaturePad";
import { useState } from "react";

const STATUS_ES: Record<string, string> = {
  IN_PROGRESS: "En progreso",
  COMPLETED: "Completado",
  BLOCKED: "Bloqueado",
  NOT_STARTED: "No iniciado",
  "IN PROGRESS": "En progreso",
};

const PAYMENT_ES: Record<string, string> = {
  UNPAID: "NO PAGADO",
  PAID: "Pagado",
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

export function DashboardPage() {
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
          <p className="muted-label">Bloqueo documental</p>
          <strong>{PAYMENT_ES[certification.paymentState] || certification.paymentState}</strong>
          <span>El pago bloquea la generacion documental, no el avance</span>
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
