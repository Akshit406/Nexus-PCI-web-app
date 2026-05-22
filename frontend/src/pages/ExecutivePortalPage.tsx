import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ExecutiveCertificationsResponse } from "../types";

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

export function ExecutivePortalPage() {
  const queryClient = useQueryClient();
  const [paymentNotes, setPaymentNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const certificationsQuery = useQuery({
    queryKey: ["executive-certifications"],
    queryFn: () => api.get<ExecutiveCertificationsResponse>("/client/certifications"),
  });

  const certifications = certificationsQuery.data?.items ?? [];
  const metrics = useMemo(() => {
    const paymentPending = certifications.filter((item) => item.paymentState !== "PAID").length;
    const ready = certifications.filter((item) => item.status === "READY_TO_GENERATE").length;
    const expiring = certifications.filter((item) => isExpiringSoon(item.validUntil)).length;
    const abandoned = certifications.filter((item) => item.status !== "GENERATED" && item.status !== "FINALIZED" && item.answeredCount === 0).length;
    return { paymentPending, ready, expiring, abandoned };
  }, [certifications]);

  const paymentMutation = useMutation({
    mutationFn: (input: { certificationId: string; state: string; notes: string }) =>
      api.patch<{ success: boolean }>("/client/payment-state", input),
    onSuccess() {
      setError("");
      setSuccess("Estado de pago actualizado.");
      queryClient.invalidateQueries({ queryKey: ["executive-certifications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-operations-summary"] });
    },
    onError(error) {
      setSuccess("");
      setError(error instanceof Error ? error.message : "No fue posible actualizar el pago.");
    },
  });

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

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Clientes</p>
            <h2>Certificaciones activas</h2>
          </div>
          <span className="soft-badge">{certifications.length} registro(s)</span>
        </div>

        <div className="outputs-list-stack">
          {certifications.length > 0 ? certifications.map((item) => (
            <article key={item.id} className="mini-card executive-client-card">
              <div className="document-list-copy">
                <strong>{item.companyName}</strong>
                <p className="subtle-text">
                  {item.saqType} - Ciclo {item.cycleYear} - {statusLabel(item.status)}
                </p>
                <p className="subtle-text">
                  Respuestas: {item.answeredCount} - Evidencias: {item.evidenceCount} - Salidas: {item.generatedDocumentCount}
                </p>
                <p className="subtle-text">Vigencia: {formatDate(item.validUntil)}</p>
              </div>
              <div className="executive-actions">
                <label className="field">
                  <span>Pago</span>
                  <select
                    value={item.paymentState}
                    onChange={(event) =>
                      paymentMutation.mutate({
                        certificationId: item.id,
                        state: event.target.value,
                        notes: paymentNotes[item.id] ?? "",
                      })
                    }
                  >
                    {PAYMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Nota interna</span>
                  <input
                    value={paymentNotes[item.id] ?? ""}
                    onChange={(event) => setPaymentNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Opcional"
                  />
                </label>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={reminderMutation.isPending}
                  onClick={() => reminderMutation.mutate({ certificationId: item.id, companyName: item.companyName })}
                >
                  Enviar recordatorio
                </button>
              </div>
            </article>
          )) : <p className="subtle-text">No tienes clientes asignados actualmente.</p>}
        </div>
      </section>
    </div>
  );
}
