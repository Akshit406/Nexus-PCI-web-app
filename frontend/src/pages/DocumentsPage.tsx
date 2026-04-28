import { ChangeEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "../lib/api";
import { getToken } from "../lib/session";
import { templateLibrary } from "../lib/template-library";
import { ClientDocumentItem, ClientDocumentsResponse, DashboardResponse, SaqResponse } from "../types";

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No fue posible leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function downloadClientDocument(item: ClientDocumentItem) {
  const token = getToken();
  const response = await fetch(`${API_URL}/client/documents/${item.id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error("No fue posible descargar el archivo.");
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = item.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [uploadCategory, setUploadCategory] = useState<"EDITED_TEMPLATE" | "EVIDENCE">("EDITED_TEMPLATE");
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [formError, setFormError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/client/dashboard"),
  });

  const documentsQuery = useQuery({
    queryKey: ["client-documents"],
    queryFn: () => api.get<ClientDocumentsResponse>("/client/documents"),
  });
  const saqQuery = useQuery({
    queryKey: ["saq-current"],
    queryFn: () => api.get<SaqResponse>("/saq/current"),
  });

  const selectedTemplate = useMemo(
    () => templateLibrary.find((item) => item.key === selectedTemplateKey) ?? null,
    [selectedTemplateKey],
  );

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) {
        throw new Error("Selecciona un archivo para subir.");
      }

      const resolvedTitle = documentTitle.trim() || selectedTemplate?.title || selectedFile.name;
      const fileBase64 = await readFileAsDataUrl(selectedFile);
      return api.post<ClientDocumentItem>("/client/documents", {
        title: resolvedTitle,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        fileBase64,
        category: uploadCategory,
        requirementId: uploadCategory === "EVIDENCE" ? selectedRequirementId : undefined,
        sourceTemplateKey: selectedTemplateKey || undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess() {
      setSelectedTemplateKey("");
      setSelectedRequirementId("");
      setUploadCategory("EDITED_TEMPLATE");
      setDocumentTitle("");
      setNotes("");
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      setFormError("");
      queryClient.invalidateQueries({ queryKey: ["client-documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError(error) {
      setFormError(error instanceof Error ? error.message : "No fue posible subir el documento.");
    },
  });

  const assignedSaq = dashboardQuery.data?.certification.saqType ?? "SAQ asignado";
  const requirements = useMemo(
    () => saqQuery.data?.topics.flatMap((topic) => topic.requirements.map((requirement) => ({ ...requirement, topicCode: topic.topicCode, topicName: topic.topicName }))) ?? [],
    [saqQuery.data],
  );
  const evidenceItems = documentsQuery.data?.items.filter((item) => item.category === "EVIDENCE") ?? [];
  const clientDocuments = documentsQuery.data?.items.filter((item) => item.category !== "EVIDENCE" && item.category !== "GENERATED_OUTPUT") ?? [];
  const generatedDocuments = documentsQuery.data?.items.filter((item) => item.category === "GENERATED_OUTPUT") ?? [];

  function handleTemplateChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextKey = event.target.value;
    setSelectedTemplateKey(nextKey);
    const template = templateLibrary.find((item) => item.key === nextKey);
    if (template && !documentTitle.trim()) {
      setDocumentTitle(template.title);
    }
  }

  async function handleDownload(item: ClientDocumentItem) {
    try {
      setDownloadError("");
      await downloadClientDocument(item);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "No fue posible descargar el archivo.");
    }
  }

  return (
    <div className="page-stack documents-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Documentos del cliente</p>
          <h1>Regresa tus documentos editados</h1>
          <p className="page-subtitle">
            Sube aqui las versiones trabajadas de los documentos preparados a partir de las plantillas descargadas para que queden ligadas a tu certificacion actual.
          </p>
        </div>
      </section>

      <section className="documents-grid">
        <article className="single-page-card wide placeholder-card document-upload-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Carga controlada</p>
              <h2>Subir documento o evidencia</h2>
            </div>
            <span className="soft-badge">Flujo {assignedSaq}</span>
          </div>

          <p className="subtle-text">
            Este flujo permite regresar documentos editados o cargar evidencias ligadas a un requisito. Tipos permitidos: DOC, DOCX, PDF, XLS, XLSX, imagenes y TXT. Limite de 25 MB por archivo.
          </p>

          <div className="documents-form-grid">
            <label className="field">
              <span>Tipo de carga</span>
              <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value as "EDITED_TEMPLATE" | "EVIDENCE")}>
                <option value="EDITED_TEMPLATE">Documento editado</option>
                <option value="EVIDENCE">Evidencia de requisito</option>
              </select>
            </label>

            <label className="field">
              <span>Plantilla de origen</span>
              <select value={selectedTemplateKey} onChange={handleTemplateChange} disabled={uploadCategory === "EVIDENCE"}>
                <option value="">Selecciona una plantilla base</option>
                {templateLibrary.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Titulo interno</span>
              <input
                type="text"
                value={documentTitle}
                onChange={(event) => setDocumentTitle(event.target.value)}
                placeholder="Ej. Politica de seguridad actualizada"
              />
            </label>
          </div>

          {uploadCategory === "EVIDENCE" ? (
            <label className="field" style={{ marginTop: "16px" }}>
              <span>Requisito relacionado</span>
              <select value={selectedRequirementId} onChange={(event) => setSelectedRequirementId(event.target.value)}>
                <option value="">Selecciona el requisito que soporta esta evidencia</option>
                {requirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.code} - {requirement.description.slice(0, 90)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field" style={{ marginTop: "16px" }}>
            <span>Notas del cliente</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Describe brevemente que version estas regresando o cualquier observacion relevante."
            />
          </label>

          <label className="field document-file-field">
            <span>Archivo editado</span>
            <input
              key={fileInputKey}
              type="file"
              accept=".doc,.docx,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {selectedFile ? (
            <div className="document-file-chip">
              <strong>{selectedFile.name}</strong>
              <span>{formatFileSize(selectedFile.size)}</span>
            </div>
          ) : null}

          {formError ? <p className="error-text">{formError}</p> : null}

          <div className="documents-action-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending || !selectedFile || (uploadCategory === "EVIDENCE" && !selectedRequirementId)}
            >
              {uploadMutation.isPending ? "Subiendo..." : uploadCategory === "EVIDENCE" ? "Subir evidencia" : "Subir documento"}
            </button>
          </div>
        </article>

        <article className="single-page-card wide placeholder-card documents-list-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Versiones cargadas</p>
              <h2>Evidencias y documentos cargados</h2>
            </div>
            <span className="soft-badge">
              {documentsQuery.data?.items.length ?? 0} archivos
            </span>
          </div>

          <p className="subtle-text">
            Aqui se concentran las evidencias, documentos editados y salidas generadas para esta certificacion.
          </p>

          {downloadError ? <p className="error-text">{downloadError}</p> : null}

          <div className="documents-list-stack">
            {documentsQuery.isLoading ? (
              <div className="loading-panel">Cargando documentos...</div>
            ) : documentsQuery.isError ? (
              <div className="error-panel">No fue posible cargar los documentos del cliente.</div>
            ) : documentsQuery.data && documentsQuery.data.items.length > 0 ? (
              documentsQuery.data.items.map((item) => {
                const templateTitle =
                  templateLibrary.find((template) => template.key === item.sourceTemplateKey)?.title ??
                  (item.category === "EVIDENCE"
                    ? `Evidencia ligada a requisito${item.topicCode ? ` del tema ${item.topicCode}` : ""}`
                    : item.category === "GENERATED_OUTPUT"
                      ? `Salida generada: ${item.generatedType}`
                      : "Documento cargado por el cliente");

                return (
                  <article key={item.id} className="mini-card document-list-item">
                    <div className="document-list-copy">
                      <div className="document-list-header">
                        <strong>{item.title}</strong>
                        <span className="repository-file-type">
                          {item.category === "EVIDENCE" ? "EVIDENCIA" : item.category === "GENERATED_OUTPUT" ? "GENERADO" : formatFileSize(item.fileSizeBytes)}
                        </span>
                      </div>
                      <p className="subtle-text">{templateTitle}</p>
                      <p className="subtle-text">
                        {item.fileName} · {formatDate(item.createdAt)}
                      </p>
                      {item.notes ? <p>{item.notes}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void handleDownload(item)}
                    >
                      Descargar
                    </button>
                  </article>
                );
              })
            ) : (
              <div className="mini-card empty-state-card">
                <strong>Aun no hay documentos cargados</strong>
                <p>
                  Cuando regreses un documento editado, aparecera aqui para consulta y descarga autenticada.
                </p>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="three-column-grid">
        <article className="stat-card">
          <p className="muted-label">Evidencias</p>
          <strong>{evidenceItems.length}</strong>
          <span>Archivos ligados a requisitos del SAQ</span>
        </article>
        <article className="stat-card">
          <p className="muted-label">Documentos editados</p>
          <strong>{clientDocuments.length}</strong>
          <span>Plantillas o documentos regresados por el cliente</span>
        </article>
        <article className="stat-card">
          <p className="muted-label">Salidas generadas</p>
          <strong>{generatedDocuments.length}</strong>
          <span>SAQ, diploma o AOC preparados por el sistema</span>
        </article>
      </section>
    </div>
  );
}
