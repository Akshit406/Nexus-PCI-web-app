import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { API_URL, api } from "../lib/api";
import { getToken } from "../lib/session";
import { useSession } from "../context/session-context";
import { DashboardResponse, DocumentTemplateItem, DocumentTemplatesResponse } from "../types";

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

export function RepositoryPage() {
  const { user } = useSession();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/client/dashboard"),
    enabled: user?.role === "CLIENT",
  });
  const templatesQuery = useQuery({
    queryKey: ["document-templates"],
    queryFn: () => api.get<DocumentTemplatesResponse>("/templates"),
  });

  const assignedSaq = dashboardQuery.data?.certification.saqType ?? "SAQ asignado";

  return (
    <div className="page-stack placeholder-page repository-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Repositorio de plantillas</p>
          <h1>Plantillas editables</h1>
          <p className="page-subtitle">
            Material que puedes descargar, editar y usar para formalizar tu documentacion dentro del proceso PCI DSS.
          </p>
        </div>
      </section>

      <section className="single-page-card wide placeholder-card repository-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Material de apoyo</p>
            <h2>Plantillas para completar tu documentacion</h2>
          </div>
          <span className="soft-badge">Flujo {assignedSaq}</span>
        </div>

        <p className="subtle-text repository-card-copy">
          Este espacio muestra plantillas editables administradas desde la plataforma. No concentra evidencias cargadas ni los formatos SAQ, resumen AOC o diploma que el sistema usa para la generacion documental final.
        </p>

        <div className="repository-context-note">
          <p className="muted-label">Criterio actual</p>
          <p className="subtle-text">
            Descarga la plantilla correspondiente, editala fuera de la plataforma y despues regresa la version trabajada en la seccion Documentos.
          </p>
        </div>

        {user?.role === "ADMIN" ? (
          <div className="repository-actions-row">
            <Link className="primary-button repository-action-link" to="/admin/templates">
              Administrar plantillas
            </Link>
          </div>
        ) : (
          <div className="repository-actions-row">
            <Link className="primary-button repository-action-link" to="/documents">
              Ir a Documentos
            </Link>
          </div>
        )}

        <div className="repository-download-grid">
          {templatesQuery.isLoading ? (
            <div className="loading-panel">Cargando plantillas...</div>
          ) : templatesQuery.isError ? (
            <div className="error-panel">No fue posible cargar las plantillas.</div>
          ) : templatesQuery.data?.items.length ? (
            templatesQuery.data.items.map((item) => (
              <article key={item.id} className="mini-card repository-download-card">
                <div className="repository-download-copy">
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <span className="repository-file-type">{item.fileType}</span>
                </div>
                <button className="ghost-button repository-download-link" type="button" onClick={() => void downloadTemplate(item)}>
                  Descargar
                </button>
              </article>
            ))
          ) : (
            <div className="mini-card empty-state-card">
              <strong>No hay plantillas activas</strong>
              <p>Un administrador puede agregar plantillas desde Administrar plantillas.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
