import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { templateLibrary } from "../lib/template-library";
import { DashboardResponse } from "../types";

export function RepositoryPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/client/dashboard"),
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
          Este espacio muestra plantillas editables para el cliente. No concentra evidencias cargadas ni los formatos oficiales SAQ, AOC o diploma que el sistema usa para la generacion documental final.
        </p>

        <div className="repository-context-note">
          <p className="muted-label">Criterio actual</p>
          <p className="subtle-text">
            Descarga la plantilla correspondiente, editala fuera de la plataforma y despues regresa la version trabajada en la seccion Documentos.
          </p>
        </div>

        <div className="repository-actions-row">
          <Link className="primary-button repository-action-link" to="/documents">
            Ir a Documentos
          </Link>
        </div>

        <div className="repository-download-grid">
          {templateLibrary.map((item) => (
            <article key={item.href} className="mini-card repository-download-card">
              <div className="repository-download-copy">
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <span className="repository-file-type">{item.fileType}</span>
              </div>
              <a className="ghost-button repository-download-link" href={item.href} download>
                Descargar
              </a>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
