import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { useSession } from "../context/session-context";

type AsvScan = {
  id: string;
  scanReference: string;
  targetScope: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  summary: string | null;
  findings: Array<{
    id: string;
    severity: string;
    title: string;
    description: string | null;
    remediation: string | null;
    hostTarget: string;
    isResolved: boolean;
    resolvedAt: string | null;
  }>;
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitado",
  IN_PROGRESS: "En proceso",
  PASSED: "Aprobado",
  FAILED: "Reprobado",
  NEEDS_REMEDIATION: "Requiere remediacion",
  CANCELLED: "Cancelado",
};

const SEVERITY_LABEL: Record<string, string> = {
  INFO: "Informativo",
  LOW: "Bajo",
  MEDIUM: "Medio",
  HIGH: "Alto",
  CRITICAL: "Critico",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export function AsvScansWidget({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [newScopeInput, setNewScopeInput] = useState("");
  const [showAll, setShowAll] = useState(false);

  const canRequestScan = user?.role === "EXECUTIVE" || user?.role === "ADMIN";
  const canSimulateScan = canRequestScan;

  const scansQuery = useQuery({
    queryKey: ["asv-scans", clientId],
    queryFn: () => api.get<{ items: AsvScan[] }>(`/asv/clients/${clientId}/scans`),
    enabled: Boolean(clientId),
  });

  const requestScanMutation = useMutation({
    mutationFn: (targetScope: string) =>
      api.post<AsvScan>(`/asv/clients/${clientId}/scans`, { targetScope }),
    onSuccess() {
      setNewScopeInput("");
      queryClient.invalidateQueries({ queryKey: ["asv-scans", clientId] });
    },
  });

  const simulateScanMutation = useMutation({
    mutationFn: (scanId: string) => api.post<AsvScan>(`/asv/scans/${scanId}/simulate`),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["asv-scans", clientId] });
    },
  });

  const items = scansQuery.data?.items ?? [];
  const latest = items[0] ?? null;
  const visibleItems = showAll ? items : items.slice(0, 3);

  return (
    <article className="single-page-card wide">
      <div className="panel-header">
        <div>
          <p className="brand-eyebrow">PCI DSS Req. 11.3</p>
          <h2 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ShieldCheck size={20} aria-hidden="true" /> Escaneos ASV (simulados)
          </h2>
        </div>
        <span className="soft-badge">
          {latest ? STATUS_LABEL[latest.status] ?? latest.status : "Sin scans aun"}
        </span>
      </div>

      {scansQuery.isLoading ? <p className="subtle-text">Cargando scans...</p> : null}

      {canRequestScan ? (
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
          <input
            value={newScopeInput}
            onChange={(event) => setNewScopeInput(event.target.value)}
            placeholder="Hosts o rangos de IP (ej. www.cliente.com, 203.0.113.0/24)"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="primary-button"
            disabled={requestScanMutation.isPending || newScopeInput.trim().length < 3}
            onClick={() => requestScanMutation.mutate(newScopeInput.trim())}
          >
            Solicitar scan
          </button>
        </div>
      ) : null}
      {requestScanMutation.isError ? (
        <p className="error-text">
          {requestScanMutation.error instanceof Error
            ? requestScanMutation.error.message
            : "No fue posible solicitar el scan."}
        </p>
      ) : null}

      {items.length === 0 && !scansQuery.isLoading ? (
        <p className="subtle-text">
          Aun no hay scans para este cliente.
          {canRequestScan ? " Solicita uno para validar PCI DSS 11.3." : ""}
        </p>
      ) : null}

      <div className="operation-list">
        {visibleItems.map((scan) => (
          <div key={scan.id} className="operation-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <span>
                <strong>{scan.scanReference}</strong> · {scan.targetScope}
              </span>
              <span className="soft-badge">{STATUS_LABEL[scan.status] ?? scan.status}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <span className="subtle-text">
                Solicitado: {formatDate(scan.requestedAt)} · Completado: {formatDate(scan.completedAt)}
              </span>
              {canSimulateScan && (scan.status === "REQUESTED" || scan.status === "IN_PROGRESS") ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={simulateScanMutation.isPending}
                  onClick={() => simulateScanMutation.mutate(scan.id)}
                >
                  Ejecutar scan simulado
                </button>
              ) : null}
            </div>
            {scan.summary ? <p className="subtle-text">{scan.summary}</p> : null}
            {scan.findings.length > 0 ? (
              <ul style={{ paddingLeft: "16px", margin: 0 }}>
                {scan.findings.map((finding) => (
                  <li key={finding.id} style={{ marginBottom: "4px" }}>
                    <strong>[{SEVERITY_LABEL[finding.severity] ?? finding.severity}]</strong> {finding.title}
                    {finding.isResolved ? " · Resuelto" : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>

      {items.length > 3 ? (
        <button type="button" className="ghost-button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Mostrar menos" : `Ver todos (${items.length})`}
        </button>
      ) : null}
    </article>
  );
}
