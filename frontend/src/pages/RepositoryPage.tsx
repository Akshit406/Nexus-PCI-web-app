import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DashboardResponse } from "../types";

type RepositoryItem = {
  title: string;
  description: string;
  href: string;
  fileType: string;
};

const repositoryItems: RepositoryItem[] = [
  {
    title: "Procedimiento de instalacion y validacion antimalware",
    description:
      "Machote editable para documentar controles antimalware, alcance operativo y responsables del proceso.",
    href: "/templates/editable/antimalware-procedimiento.docx",
    fileType: "DOCX editable",
  },
  {
    title: "R11 pruebas de seguridad de sistemas y redes",
    description:
      "Machote base para formalizar escaneos, revisiones periodicas, hallazgos y seguimiento del requisito 11.",
    href: "/templates/editable/r11-pruebas-seguridad.docx",
    fileType: "DOCX editable",
  },
  {
    title: "R12 politica de seguridad de la informacion",
    description:
      "Machote editable para registrar politica de seguridad, responsabilidades y ciclo de actualizacion documental.",
    href: "/templates/editable/r12-politica-seguridad.docx",
    fileType: "DOCX editable",
  },
];

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
          <p className="brand-eyebrow">Repositorio de machotes</p>
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
            <h2>Machotes para completar tu documentacion</h2>
          </div>
          <span className="soft-badge">Flujo {assignedSaq}</span>
        </div>

        <p className="subtle-text repository-card-copy">
          Este espacio muestra machotes editables para el cliente. No concentra evidencias cargadas ni los formatos oficiales SAQ, AOC o diploma que el sistema usa para la generacion documental final.
        </p>

        <div className="repository-context-note">
          <p className="muted-label">Criterio actual</p>
          <p className="subtle-text">
            La administracion podra asociar material especifico por tipo de SAQ en la siguiente fase. Por ahora se muestra el bloque base de apoyo documental para el cliente.
          </p>
        </div>

        <div className="repository-download-grid">
          {repositoryItems.map((item) => (
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
