import { ChangeEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "../lib/api";
import { getToken } from "../lib/session";
import { DocumentTemplateItem, DocumentTemplatesResponse } from "../types";

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No fue posible leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(sizeBytes: number) {
  if (!sizeBytes) return "Sin archivo";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadTemplate(template: DocumentTemplateItem) {
  const token = getToken();
  const response = await fetch(`${API_URL}${template.downloadUrl}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error("No fue posible descargar la plantilla.");
  }
  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = template.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

type TemplateDraft = {
  title: string;
  description: string;
  fileType: string;
};

export function AdminTemplatesPage() {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newFileType, setNewFileType] = useState("DOCX editable");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TemplateDraft>>({});
  const [replaceFiles, setReplaceFiles] = useState<Record<string, File | null>>({});
  const [error, setError] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["admin-document-templates"],
    queryFn: () => api.get<DocumentTemplatesResponse>("/templates/admin"),
  });

  const draftsWithDefaults = useMemo(() => {
    const next: Record<string, TemplateDraft> = {};
    for (const template of templatesQuery.data?.items ?? []) {
      next[template.id] = drafts[template.id] ?? {
        title: template.title,
        description: template.description,
        fileType: template.fileType,
      };
    }
    return next;
  }, [drafts, templatesQuery.data]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newFile) {
        throw new Error("Selecciona un archivo de plantilla.");
      }
      const fileBase64 = await readFileAsDataUrl(newFile);
      return api.post<DocumentTemplateItem>("/templates", {
        title: newTitle,
        description: newDescription,
        fileType: newFileType,
        fileName: newFile.name,
        fileBase64,
      });
    },
    onSuccess() {
      setNewTitle("");
      setNewDescription("");
      setNewFileType("DOCX editable");
      setNewFile(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
    onError(error) {
      setError(error instanceof Error ? error.message : "No fue posible crear la plantilla.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ templateId, draft }: { templateId: string; draft: TemplateDraft }) =>
      api.patch<DocumentTemplateItem>(`/templates/${templateId}`, draft),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["admin-document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
  });

  const replaceFileMutation = useMutation({
    mutationFn: async ({ templateId, file, fileType }: { templateId: string; file: File; fileType: string }) => {
      const fileBase64 = await readFileAsDataUrl(file);
      return api.post<DocumentTemplateItem>(`/templates/${templateId}/file`, {
        fileName: file.name,
        fileType,
        fileBase64,
      });
    },
    onSuccess() {
      setReplaceFiles({});
      queryClient.invalidateQueries({ queryKey: ["admin-document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ templateId, isActive }: { templateId: string; isActive: boolean }) =>
      api.patch<DocumentTemplateItem>(`/templates/${templateId}/status`, { isActive }),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["admin-document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (templateId: string) => api.delete<{ success: boolean }>(`/templates/${templateId}`),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["admin-document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
  });

  function updateDraft(templateId: string, key: keyof TemplateDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [templateId]: {
        ...draftsWithDefaults[templateId],
        [key]: value,
      },
    }));
  }

  function handleNewFile(event: ChangeEvent<HTMLInputElement>) {
    setNewFile(event.target.files?.[0] ?? null);
  }

  return (
    <div className="page-stack admin-templates-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administrador</p>
          <h1>Administrar plantillas</h1>
          <p className="page-subtitle">
            Agrega, actualiza, activa o archiva las plantillas que veran los clientes en el repositorio.
          </p>
        </div>
      </section>

      <section className="documents-grid">
        <article className="single-page-card wide placeholder-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Nueva plantilla</p>
              <h2>Agregar plantilla editable</h2>
            </div>
          </div>
          <div className="documents-form-grid">
            <label className="field">
              <span>Titulo</span>
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Ej. Politica de seguridad" />
            </label>
            <label className="field">
              <span>Tipo de archivo</span>
              <input value={newFileType} onChange={(event) => setNewFileType(event.target.value)} placeholder="DOCX editable" />
            </label>
          </div>
          <label className="field" style={{ marginTop: "16px" }}>
            <span>Descripcion</span>
            <textarea rows={3} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
          </label>
          <label className="field document-file-field">
            <span>Archivo de plantilla</span>
            <input type="file" accept=".doc,.docx,.pdf,.xls,.xlsx,.txt" onChange={handleNewFile} />
          </label>
          {newFile ? <div className="document-file-chip"><strong>{newFile.name}</strong><span>{formatFileSize(newFile.size)}</span></div> : null}
          {error ? <p className="error-text">{error}</p> : null}
          <button type="button" className="primary-button" disabled={createMutation.isPending || !newTitle || !newDescription || !newFile} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Guardando..." : "Agregar plantilla"}
          </button>
        </article>

        <article className="single-page-card wide placeholder-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Catalogo</p>
              <h2>Plantillas activas e inactivas</h2>
            </div>
            <span className="soft-badge">{templatesQuery.data?.items.length ?? 0} plantillas</span>
          </div>

          <div className="documents-list-stack">
            {templatesQuery.isLoading ? (
              <div className="loading-panel">Cargando plantillas...</div>
            ) : templatesQuery.isError ? (
              <div className="error-panel">No fue posible cargar el catalogo.</div>
            ) : (
              templatesQuery.data?.items.map((template) => {
                const draft = draftsWithDefaults[template.id];
                const replacement = replaceFiles[template.id];
                return (
                  <article key={template.id} className="mini-card admin-template-card">
                    <div className="documents-form-grid">
                      <label className="field">
                        <span>Titulo</span>
                        <input value={draft.title} onChange={(event) => updateDraft(template.id, "title", event.target.value)} />
                      </label>
                      <label className="field">
                        <span>Tipo</span>
                        <input value={draft.fileType} onChange={(event) => updateDraft(template.id, "fileType", event.target.value)} />
                      </label>
                    </div>
                    <label className="field">
                      <span>Descripcion</span>
                      <textarea rows={2} value={draft.description} onChange={(event) => updateDraft(template.id, "description", event.target.value)} />
                    </label>
                    <div className="document-file-chip">
                      <strong>{template.fileName}</strong>
                      <span>{template.isActive ? "Activa" : "Inactiva"} · {formatFileSize(template.fileSizeBytes)}</span>
                    </div>
                    <label className="field document-file-field">
                      <span>Reemplazar archivo</span>
                      <input
                        type="file"
                        accept=".doc,.docx,.pdf,.xls,.xlsx,.txt"
                        onChange={(event) => setReplaceFiles((current) => ({ ...current, [template.id]: event.target.files?.[0] ?? null }))}
                      />
                    </label>
                    <div className="documents-action-row admin-template-actions">
                      <button type="button" className="ghost-button" onClick={() => updateMutation.mutate({ templateId: template.id, draft })}>
                        Guardar datos
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={!replacement}
                        onClick={() => replacement && replaceFileMutation.mutate({ templateId: template.id, file: replacement, fileType: draft.fileType })}
                      >
                        Reemplazar archivo
                      </button>
                      <button type="button" className="ghost-button" onClick={() => statusMutation.mutate({ templateId: template.id, isActive: !template.isActive })}>
                        {template.isActive ? "Desactivar" : "Activar"}
                      </button>
                      <button type="button" className="ghost-button" onClick={() => void downloadTemplate(template)}>
                        Descargar
                      </button>
                      <button type="button" className="ghost-button danger-ghost" onClick={() => archiveMutation.mutate(template.id)}>
                        Archivar
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
