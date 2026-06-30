import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { API_URL, api } from "../lib/api";
import { getToken } from "../lib/session";
import {
  AdminFinalSaqsResponse,
  AdminSaqEvidenceResponse,
  AdminSaqQuestionnairePreviewResponse,
  SaqResponse,
} from "../types";
import { SaqQuestionnaireView } from "./QuestionnairePage";

async function downloadFinalSaq(documentId: string, fileName: string) {
  const token = getToken();
  const response = await fetch(`${API_URL}/client/documents/${documentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? "No fue posible descargar el SAQ final.");
  }

  const objectUrl = window.URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export function AdminSaqPreviewPage() {
  const [selectedSaqTypeId, setSelectedSaqTypeId] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const saqTypesQuery = useQuery({
    queryKey: ["admin-saq-evidence-requirements"],
    queryFn: () => api.get<AdminSaqEvidenceResponse>("/admin/saq/evidence-requirements"),
  });
  const previewQuery = useQuery({
    queryKey: ["admin-saq-questionnaire-preview", selectedSaqTypeId],
    queryFn: () => api.get<AdminSaqQuestionnairePreviewResponse>(`/admin/saq/types/${selectedSaqTypeId}/questionnaire-preview`),
    enabled: Boolean(selectedSaqTypeId),
  });
  const finalSaqsQuery = useQuery({
    queryKey: ["admin-saq-final-documents", selectedSaqTypeId],
    queryFn: () => api.get<AdminFinalSaqsResponse>(`/admin/saq/types/${selectedSaqTypeId}/final-saqs`),
    enabled: Boolean(selectedSaqTypeId),
  });

  useEffect(() => {
    if (!selectedSaqTypeId && saqTypesQuery.data?.items.length) {
      setSelectedSaqTypeId(saqTypesQuery.data.items[0].id);
    }
  }, [saqTypesQuery.data, selectedSaqTypeId]);

  useEffect(() => {
    const items = finalSaqsQuery.data?.items ?? [];
    setSelectedDocumentId((current) =>
      items.some((item) => item.documentId === current) ? current : items[0]?.documentId ?? "",
    );
  }, [finalSaqsQuery.data]);

  const previewData = useMemo<SaqResponse | null>(() => {
    const preview = previewQuery.data;
    if (!preview) return null;
    return {
      certification: {
        id: `admin-preview-${preview.saqType.id}`,
        saqTypeCode: preview.saqType.code,
        saqTypeName: preview.saqType.name,
        templateVersion: preview.saqType.templateVersion,
        supportsNotTested: preview.saqType.supportsNotTested,
        isLocked: false,
        lastViewedTopicCode: null,
        paymentState: "PREVIEW",
        hasSignature: false,
      },
      ...preview.questionnaire,
    };
  }, [previewQuery.data]);

  const selectedDocument = finalSaqsQuery.data?.items.find((item) => item.documentId === selectedDocumentId) ?? null;

  async function handleDownload() {
    if (!selectedDocument) return;
    setDownloadError("");
    setIsDownloading(true);
    try {
      await downloadFinalSaq(selectedDocument.documentId, selectedDocument.fileName);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "No fue posible descargar el SAQ final.");
    } finally {
      setIsDownloading(false);
    }
  }

  if (saqTypesQuery.isLoading) {
    return <div className="loading-panel">Cargando tipos de SAQ...</div>;
  }
  if (saqTypesQuery.isError || !saqTypesQuery.data) {
    return <div className="error-panel">No fue posible cargar los tipos de SAQ.</div>;
  }

  return (
    <div className="page-stack admin-saq-preview-page">
      <section className="page-intro admin-saq-preview-intro">
        <div>
          <p className="brand-eyebrow">Administracion SAQ</p>
          <h1>Vista previa del cuestionario</h1>
          <p className="page-subtitle">Revisa la estructura aplicada que reciben los clientes para cada tipo de SAQ.</p>
        </div>

        <div className="admin-saq-download-controls">
          <label className="field">
            <span>SAQ final del cliente</span>
            <select
              value={selectedDocumentId}
              onChange={(event) => setSelectedDocumentId(event.target.value)}
              disabled={finalSaqsQuery.isLoading || !finalSaqsQuery.data?.items.length}
            >
              {!finalSaqsQuery.data?.items.length ? <option value="">No hay SAQ final disponible</option> : null}
              {finalSaqsQuery.data?.items.map((item) => (
                <option key={item.documentId} value={item.documentId}>
                  {item.companyName} - {item.cycleYear}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button icon-text-button"
            disabled={!selectedDocument || isDownloading}
            onClick={handleDownload}
          >
            <Download size={17} aria-hidden="true" />
            {isDownloading ? "Descargando..." : "Descargar SAQ final"}
          </button>
        </div>
      </section>

      <section className="panel admin-saq-preview-toolbar">
        <label className="field">
          <span>Tipo de SAQ</span>
          <select
            value={selectedSaqTypeId}
            onChange={(event) => {
              setSelectedSaqTypeId(event.target.value);
              setSelectedDocumentId("");
              setDownloadError("");
            }}
          >
            {saqTypesQuery.data.items.map((saqType) => (
              <option key={saqType.id} value={saqType.id}>
                {saqType.name} {saqType.templateVersion ? `- ${saqType.templateVersion}` : ""}
              </option>
            ))}
          </select>
        </label>
        {previewQuery.data ? (
          <div className="admin-saq-template-status">
            <span>Documento activo</span>
            <strong>{previewQuery.data.activeDocument.fileName}</strong>
            <small>SHA-256 {previewQuery.data.activeDocument.sha256.slice(0, 12)}</small>
          </div>
        ) : null}
      </section>

      {downloadError ? <div className="error-panel">{downloadError}</div> : null}
      {previewQuery.isLoading ? <div className="loading-panel">Cargando vista previa...</div> : null}
      {previewQuery.isError ? (
        <div className="error-panel">
          {previewQuery.error instanceof Error ? previewQuery.error.message : "No fue posible cargar la vista previa."}
        </div>
      ) : null}
      {previewData ? (
        <SaqQuestionnaireView
          key={previewData.certification.saqTypeCode}
          saqData={previewData}
          mode="admin-preview"
          showIntro={false}
        />
      ) : null}
    </div>
  );
}
