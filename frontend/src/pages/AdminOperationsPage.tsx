import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Play, RefreshCw } from "lucide-react";
import { API_URL, api } from "../lib/api";
import { getToken } from "../lib/session";
import { AdminAuditLogItem, AdminOperationsSummary } from "../types";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Sin registro";
  }

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    DRAFT: "Borrador",
    IN_PROGRESS: "En progreso",
    READY_TO_GENERATE: "Listo para generar",
    GENERATED: "Generado",
    FINALIZED: "Finalizado",
    ARCHIVED: "Archivado",
    UNPAID: "Pendiente",
    PENDING: "En revision",
    PAID: "Pagado",
    OVERDUE: "Vencido",
  };
  return labels[value] ?? value;
}

function countEntries(values: Record<string, number>) {
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
}

function buildAuditFilterParams(filters: {
  actionType: string;
  clientId: string;
  userId: string;
  from: string;
  to: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters.actionType.trim()) params.set("actionType", filters.actionType.trim());
  if (filters.clientId.trim()) params.set("clientId", filters.clientId.trim());
  if (filters.userId.trim()) params.set("userId", filters.userId.trim());
  if (filters.from.trim()) params.set("from", filters.from.trim());
  if (filters.to.trim()) params.set("to", filters.to.trim());
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  return params;
}

type EmailStatusResponse = {
  configured: boolean;
  mode: "PRODUCTION" | "DEV_FALLBACK";
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  mailFrom: string;
  publicAppUrl: string;
  recentResetActivity: Array<{ actionType: string; createdAt: string }>;
  notes: string[];
};

type EmailTestResponse = {
  success: boolean;
  devMode: boolean;
  message: string;
};

export function AdminOperationsPage() {
  const queryClient = useQueryClient();
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditClientFilter, setAuditClientFilter] = useState("");
  const [auditUserFilter, setAuditUserFilter] = useState("");
  const [auditFromFilter, setAuditFromFilter] = useState("");
  const [auditToFilter, setAuditToFilter] = useState("");
  const [exportError, setExportError] = useState("");
  const [emailTestTarget, setEmailTestTarget] = useState("");
  const [emailTestResult, setEmailTestResult] = useState<EmailTestResponse | null>(null);
  const [emailTestError, setEmailTestError] = useState("");
  const summaryQuery = useQuery({
    queryKey: ["admin-operations-summary"],
    queryFn: () => api.get<AdminOperationsSummary>("/admin/operations/summary"),
  });
  const emailStatusQuery = useQuery({
    queryKey: ["admin-email-status"],
    queryFn: () => api.get<EmailStatusResponse>("/admin/operations/email-status"),
  });
  const emailTestMutation = useMutation({
    mutationFn: (to: string) =>
      api.post<EmailTestResponse>("/admin/operations/email-test", { to }),
    onSuccess(result) {
      setEmailTestResult(result);
      setEmailTestError("");
      queryClient.invalidateQueries({ queryKey: ["admin-email-status"] });
    },
    onError(error) {
      setEmailTestError(error instanceof Error ? error.message : "No fue posible enviar el correo de prueba.");
      setEmailTestResult(null);
    },
  });
  const auditLogsQuery = useQuery({
    queryKey: [
      "admin-audit-logs",
      auditActionFilter,
      auditClientFilter,
      auditUserFilter,
      auditFromFilter,
      auditToFilter,
    ],
    queryFn: () => {
      const params = buildAuditFilterParams({
        actionType: auditActionFilter,
        clientId: auditClientFilter,
        userId: auditUserFilter,
        from: auditFromFilter,
        to: auditToFilter,
        limit: 75,
      });
      return api.get<{ items: AdminAuditLogItem[] }>(`/admin/operations/audit-logs?${params.toString()}`);
    },
  });

  async function handleAuditCsvExport() {
    setExportError("");
    const params = buildAuditFilterParams({
      actionType: auditActionFilter,
      clientId: auditClientFilter,
      userId: auditUserFilter,
      from: auditFromFilter,
      to: auditToFilter,
      limit: 2000,
    });
    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/admin/operations/audit-logs.csv?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `pcinexus-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setExportError(
        error instanceof Error ? `No fue posible exportar los logs: ${error.message}` : "No fue posible exportar los logs.",
      );
    }
  }

  const runRemindersMutation = useMutation({
    mutationFn: () => api.post<unknown>("/admin/operations/reminders/run-now"),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["admin-operations-summary"] });
    },
  });

  const summary = summaryQuery.data;
  const highSignalAuditLogs = useMemo(
    () => auditLogsQuery.data?.items ?? summary?.recentAuditLogs.filter((log) => log.warningLevel !== "LOW").slice(0, 12) ?? [],
    [auditLogsQuery.data?.items, summary?.recentAuditLogs],
  );

  if (summaryQuery.isLoading) {
    return <div className="loading-panel">Cargando operacion administrativa...</div>;
  }

  if (summaryQuery.isError || !summary) {
    return (
      <div className="error-panel">
        No fue posible cargar operaciones. {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Revisa permisos y conexion del servidor."}
      </div>
    );
  }

  return (
    <div className="page-stack admin-operations-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administrador</p>
          <h1>Operacion y estabilidad</h1>
          <p className="page-subtitle">
            Reportes, salud de datos, auditoria, recordatorios y guias de respaldo para operar la plataforma.
          </p>
        </div>
        <button type="button" className="ghost-button icon-text-button" onClick={() => summaryQuery.refetch()}>
          <RefreshCw size={16} aria-hidden="true" />
          Actualizar
        </button>
      </section>

      {summary.maintenance.enabled ? (
        <section className="operation-alert operation-alert-warning">
          <strong>Modo mantenimiento activo</strong>
          <p>{summary.maintenance.message}</p>
        </section>
      ) : null}

      <section className="operations-kpi-grid">
        <article className="stat-card">
          <span>Clientes activos</span>
          <strong>{summary.counts.activeClients}</strong>
        </article>
        <article className="stat-card">
          <span>Certificaciones activas</span>
          <strong>{summary.counts.activeCertifications}</strong>
        </article>
        <article className="stat-card">
          <span>Listas para generar</span>
          <strong>{summary.counts.readyToGenerate}</strong>
        </article>
        <article className="stat-card">
          <span>Documentos generados</span>
          <strong>{summary.counts.generatedDocuments}</strong>
        </article>
        <article className="stat-card">
          <span>SAQ activos</span>
          <strong>{summary.counts.activeSaqTypes}</strong>
        </article>
        <article className="stat-card">
          <span>Mapeos activos</span>
          <strong>{summary.counts.activeMappings}</strong>
        </article>
      </section>

      <section className="operations-grid">
        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Reportes</p>
              <h2>Estado de certificaciones y pagos</h2>
            </div>
            <span className="soft-badge">Actualizado {formatDateTime(summary.generatedAt)}</span>
          </div>
          <div className="operations-two-column">
            <div>
              <h3 className="compact-heading">Certificaciones</h3>
              <div className="operation-list">
                {countEntries(summary.certificationStatus).map(([status, total]) => (
                  <div key={status} className="operation-row">
                    <span>{statusLabel(status)}</span>
                    <strong>{total}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="compact-heading">Pagos</h3>
              <div className="operation-list">
                {(["PAID", "PENDING", "UNPAID", "OVERDUE"] as const).map((state) => {
                  const clients = summary.paymentBreakdown?.[state] ?? [];
                  return (
                    <div key={state} className="operation-row">
                      <span title={clients.join(", ")}>
                        {statusLabel(state)}
                        {clients.length > 0 ? (
                          <span className="subtle-text" style={{ display: "block", fontSize: "0.85em" }}>
                            {clients.slice(0, 3).join(", ")}
                            {clients.length > 3 ? ` y ${clients.length - 3} mas` : ""}
                          </span>
                        ) : null}
                      </span>
                      <strong>{clients.length}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </article>

        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Salud operativa</p>
              <h2>Datos base y mapeos</h2>
            </div>
            <span className={`soft-badge${summary.dataHealth.ok ? "" : " accent"}`}>
              {summary.dataHealth.ok ? "Sin alertas" : `${summary.dataHealth.warnings.length} alerta(s)`}
            </span>
          </div>
          {summary.dataHealth.ok ? (
            <p className="subtle-text">Roles, SAQ, mapeos, plantillas y pagos base se ven consistentes.</p>
          ) : (
            <div className="operation-list">
              {summary.dataHealth.warnings.map((warning) => (
                <div key={warning} className="operation-row warning-row">
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="operations-grid">
        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Vencimientos</p>
              <h2>Clientes proximos a vencer</h2>
            </div>
            <span className="soft-badge">{summary.expirations.length} caso(s)</span>
          </div>
          <div className="operation-list">
            {summary.expirations.length > 0 ? summary.expirations.map((item) => (
              <div key={item.certificationId} className="operation-row">
                <span>{item.companyName} - SAQ {item.saqTypeCode}</span>
                <strong>{formatDateTime(item.validUntil)}</strong>
              </div>
            )) : <p className="subtle-text">No hay certificaciones con vencimiento en los proximos 60 dias.</p>}
          </div>
        </article>

        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Renovaciones</p>
              <h2>Certificaciones vencidas (overdue)</h2>
            </div>
            <span
              className={`soft-badge${(summary.renewalsOverdue?.length ?? 0) > 0 ? " accent" : ""}`}
            >
              {summary.renewalsOverdue?.length ?? 0} caso(s)
            </span>
          </div>
          <div className="operation-list">
            {(summary.renewalsOverdue?.length ?? 0) > 0 ? (
              summary.renewalsOverdue.map((item) => (
                <div key={item.certificationId} className="operation-row warning-row">
                  <span>
                    {item.companyName} - SAQ {item.saqTypeCode}
                    <span className="subtle-text" style={{ display: "block", fontSize: "0.85em" }}>
                      Pago: {statusLabel(item.paymentState)} - Estado: {statusLabel(item.status)}
                    </span>
                  </span>
                  <strong>{item.daysOverdue} dia(s) vencido</strong>
                </div>
              ))
            ) : (
              <p className="subtle-text">No hay certificaciones con vigencia vencida.</p>
            )}
          </div>
        </article>

        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Correo electronico</p>
              <h2>Configuracion SMTP y prueba de envio</h2>
            </div>
            {emailStatusQuery.data ? (
              <span
                className={`soft-badge${emailStatusQuery.data.configured ? "" : " accent"}`}
              >
                {emailStatusQuery.data.configured ? "Configurado" : "Sin configurar"}
              </span>
            ) : null}
          </div>
          {emailStatusQuery.isLoading ? (
            <p className="subtle-text">Cargando estado SMTP...</p>
          ) : emailStatusQuery.data ? (
            <>
              <div className="operation-list" style={{ marginBottom: "12px" }}>
                <div className="operation-row">
                  <span>Modo</span>
                  <strong>{emailStatusQuery.data.mode === "PRODUCTION" ? "Produccion" : "Solo logs (devMode)"}</strong>
                </div>
                <div className="operation-row">
                  <span>Servidor SMTP</span>
                  <strong>
                    {emailStatusQuery.data.smtpHost
                      ? `${emailStatusQuery.data.smtpHost}:${emailStatusQuery.data.smtpPort}`
                      : "No configurado"}
                  </strong>
                </div>
                <div className="operation-row">
                  <span>Usuario SMTP</span>
                  <strong>{emailStatusQuery.data.smtpUser ?? "No configurado"}</strong>
                </div>
                <div className="operation-row">
                  <span>Remitente (MAIL_FROM)</span>
                  <strong>{emailStatusQuery.data.mailFrom}</strong>
                </div>
                <div className="operation-row">
                  <span>URL publica para enlaces</span>
                  <strong>{emailStatusQuery.data.publicAppUrl}</strong>
                </div>
              </div>
              {!emailStatusQuery.data.configured ? (
                <div className="warning-panel" style={{ marginBottom: "12px" }}>
                  {emailStatusQuery.data.notes.map((note) => (
                    <p key={note} style={{ margin: "4px 0" }}>{note}</p>
                  ))}
                </div>
              ) : null}
              <div className="field-grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
                <label className="field">
                  <span>Enviar correo de prueba a</span>
                  <input
                    type="email"
                    placeholder="correo@dominio.com"
                    value={emailTestTarget}
                    onChange={(event) => setEmailTestTarget(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="primary-button"
                  style={{ alignSelf: "end" }}
                  disabled={!emailTestTarget.trim() || emailTestMutation.isPending}
                  onClick={() => emailTestMutation.mutate(emailTestTarget.trim())}
                >
                  {emailTestMutation.isPending ? "Enviando..." : "Enviar prueba"}
                </button>
              </div>
              {emailTestError ? <p className="error-text">{emailTestError}</p> : null}
              {emailTestResult ? (
                <p
                  className={emailTestResult.success ? "info-text" : "error-text"}
                  style={{ marginTop: "8px" }}
                >
                  {emailTestResult.message}
                </p>
              ) : null}
              {emailStatusQuery.data.recentResetActivity.length > 0 ? (
                <details style={{ marginTop: "12px" }}>
                  <summary>Actividad reciente de recuperacion de contrasena ({emailStatusQuery.data.recentResetActivity.length})</summary>
                  <ul style={{ marginTop: "8px", paddingLeft: "18px" }}>
                    {emailStatusQuery.data.recentResetActivity.map((entry, index) => (
                      <li key={`${entry.createdAt}-${index}`} className="subtle-text">
                        {formatDateTime(entry.createdAt)} - {entry.actionType}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="error-text">No fue posible cargar el estado de correo.</p>
          )}
        </article>

        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Seguimiento</p>
              <h2>Procesos posiblemente abandonados</h2>
            </div>
            <span className="soft-badge">{summary.abandoned.length} caso(s)</span>
          </div>
          <div className="operation-list">
            {summary.abandoned.length > 0 ? summary.abandoned.map((item) => (
              <div key={item.certificationId} className="operation-row">
                <span>{item.companyName} - {statusLabel(item.status)}</span>
                <strong>{formatDateTime(item.lastActivityAt)}</strong>
              </div>
            )) : <p className="subtle-text">No se detectan procesos inactivos mayores a 15 dias.</p>}
          </div>
        </article>
      </section>

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Ejecutivos</p>
            <h2>Portafolio asignado</h2>
          </div>
          <span className="soft-badge">{summary.executivePortfolio.length} ejecutivo(s)</span>
        </div>
        <div className="operations-table">
          {summary.executivePortfolio.map((executive) => (
            <div key={executive.executiveUserId} className="operations-table-row">
              <div>
                <strong>{executive.name || executive.username}</strong>
                <p className="subtle-text">{executive.email}</p>
              </div>
              <strong>{executive.activeClientCount} cliente(s)</strong>
              <p className="subtle-text">{executive.clients.length > 0 ? executive.clients.join(", ") : "Sin clientes asignados"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="operations-grid">
        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Recordatorios</p>
              <h2>Scheduler de notificaciones</h2>
            </div>
            <button
              type="button"
              className="ghost-button icon-text-button"
              disabled={runRemindersMutation.isPending || summary.reminderScheduler.runInProgress}
              onClick={() => runRemindersMutation.mutate()}
            >
              <Play size={16} aria-hidden="true" />
              Ejecutar ahora
            </button>
          </div>
          <div className="operation-list">
            <div className="operation-row">
              <span>Estado</span>
              <strong>{summary.reminderScheduler.enabled ? "Habilitado" : "Deshabilitado"}</strong>
            </div>
            <div className="operation-row">
              <span>Intervalo</span>
              <strong>{summary.reminderScheduler.intervalMinutes} min</strong>
            </div>
            <div className="operation-row">
              <span>Ultima ejecucion</span>
              <strong>{formatDateTime(summary.reminderScheduler.lastFinishedAt)}</strong>
            </div>
            <div className="operation-row">
              <span>Siguiente ejecucion</span>
              <strong>{formatDateTime(summary.reminderScheduler.nextRunAt)}</strong>
            </div>
          </div>
          {runRemindersMutation.isError ? <p className="error-text">No fue posible ejecutar recordatorios.</p> : null}
          {runRemindersMutation.isSuccess ? <p className="success-text">Escaneo de recordatorios ejecutado.</p> : null}
        </article>

        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Auditoria</p>
              <h2>Eventos de auditoria</h2>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className="soft-badge">{summary.counts.auditLogCount} evento(s)</span>
              <button
                type="button"
                className="ghost-button icon-text-button"
                onClick={() => void handleAuditCsvExport()}
              >
                <Download size={16} aria-hidden="true" />
                Exportar CSV
              </button>
            </div>
          </div>
          <div className="audit-filter-grid">
            <label className="field">
              <span>Filtrar por accion</span>
              <input
                value={auditActionFilter}
                onChange={(event) => setAuditActionFilter(event.target.value)}
                placeholder="Ej. PAYMENT, ADMIN, LOGIN"
              />
            </label>
            <label className="field">
              <span>Filtrar por clientId</span>
              <input
                value={auditClientFilter}
                onChange={(event) => setAuditClientFilter(event.target.value)}
                placeholder="ID del cliente"
              />
            </label>
            <label className="field">
              <span>Filtrar por userId</span>
              <input
                value={auditUserFilter}
                onChange={(event) => setAuditUserFilter(event.target.value)}
                placeholder="ID del usuario actor"
              />
            </label>
            <label className="field">
              <span>Desde</span>
              <input
                type="date"
                value={auditFromFilter}
                onChange={(event) => setAuditFromFilter(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Hasta</span>
              <input
                type="date"
                value={auditToFilter}
                onChange={(event) => setAuditToFilter(event.target.value)}
              />
            </label>
          </div>
          {exportError ? <p className="error-text">{exportError}</p> : null}
          <div className="operation-list">
            {highSignalAuditLogs.length > 0 ? highSignalAuditLogs.map((log) => (
              <div key={log.id} className="operation-row">
                <span>{log.actionType}{log.user ? ` - ${log.user.username}` : ""}</span>
                <strong>{formatDateTime(log.createdAt)}</strong>
              </div>
            )) : <p className="subtle-text">{auditLogsQuery.isLoading ? "Buscando eventos..." : "No hay eventos de auditoria con esos filtros."}</p>}
          </div>
        </article>
      </section>

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Respaldo y produccion</p>
            <h2>Comandos operativos para VPS</h2>
          </div>
          <span className="soft-badge">Guia</span>
        </div>
        <div className="operations-two-column">
          <div>
            <h3 className="compact-heading">Base de datos</h3>
            <ol className="operation-command-list">
              {summary.backupGuidance.database.map((line) => <li key={line}>{line}</li>)}
            </ol>
          </div>
          <div>
            <h3 className="compact-heading">Archivos y datos iniciales</h3>
            <ol className="operation-command-list">
              {[...summary.backupGuidance.uploads, ...summary.backupGuidance.productionSeed].map((line) => <li key={line}>{line}</li>)}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
