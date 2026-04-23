type RepositoryItem = {
  title: string;
  description: string;
  href: string;
  fileType: string;
};

type RepositoryGroup = {
  eyebrow: string;
  title: string;
  description: string;
  items: RepositoryItem[];
};

const repositoryGroups: RepositoryGroup[] = [
  {
    eyebrow: "Plantillas editables",
    title: "Formatos base para documentacion",
    description:
      "Documentos editables que el cliente puede descargar, adaptar y usar para completar su documentacion operativa de cumplimiento.",
    items: [
      {
        title: "Procedimiento de instalacion y validacion antimalware",
        description:
          "Plantilla operativa para documentar controles de proteccion antimalware y responsables de ejecucion.",
        href: "/templates/editable/antimalware-procedimiento.docx",
        fileType: "DOCX editable",
      },
      {
        title: "R11 pruebas de seguridad de sistemas y redes",
        description:
          "Documento base para registrar revisiones, escaneos, hallazgos y controles periodicos del requisito 11.",
        href: "/templates/editable/r11-pruebas-seguridad.docx",
        fileType: "DOCX editable",
      },
      {
        title: "R12 politica de seguridad de la informacion",
        description:
          "Plantilla de politica de seguridad y responsabilidades para cumplimiento documental del requisito 12.",
        href: "/templates/editable/r12-politica-seguridad.docx",
        fileType: "DOCX editable",
      },
    ],
  },
  {
    eyebrow: "Ejemplos de evidencia",
    title: "Referencias para carga documental",
    description:
      "Archivos de ejemplo que muestran el tipo de evidencia tecnica y operacional que se espera dentro del proceso de certificacion.",
    items: [
      {
        title: "Diagrama Epagos v1",
        description:
          "Referencia de arquitectura, flujo de red y componentes tecnicos del entorno evaluado.",
        href: "/templates/evidence-examples/diagrama-epagos-v1.pdf",
        fileType: "PDF de referencia",
      },
      {
        title: "Entradas y salidas",
        description:
          "Referencia de flujo documental para identificar entradas, salidas y trazabilidad del entorno.",
        href: "/templates/evidence-examples/entradas-y-salidas.pdf",
        fileType: "PDF de referencia",
      },
    ],
  },
  {
    eyebrow: "Formatos oficiales SAQ",
    title: "Biblioteca oficial disponible",
    description:
      "Formatos oficiales usados como referencia para el SAQ asignado y para la futura generacion documental alineada a PCI DSS v4.0.1.",
    items: [
      {
        title: "SAQ A v4.0.1 r1",
        description:
          "Formato oficial para comercios con procesamiento totalmente tercerizado y sin captura local de datos.",
        href: "/templates/official-saq/saq-a-v4-0-1-r1.pdf",
        fileType: "PDF oficial",
      },
      {
        title: "SAQ A-EP v4.0.1",
        description:
          "Formato oficial para entornos ecommerce que impactan la seguridad del flujo de pago.",
        href: "/templates/official-saq/saq-a-ep-v4-0-1.pdf",
        fileType: "PDF oficial",
      },
      {
        title: "SAQ B-IP v4.0.1",
        description:
          "Formato oficial para comercios que usan dispositivos de punto de interaccion autonomos con conexion IP.",
        href: "/templates/official-saq/saq-b-ip-v4-0-1.pdf",
        fileType: "PDF oficial",
      },
      {
        title: "SAQ C v4.0.1",
        description:
          "Formato oficial para comercios con aplicaciones de pago conectadas a internet y segmentacion controlada.",
        href: "/templates/official-saq/saq-c-v4-0-1.pdf",
        fileType: "PDF oficial",
      },
      {
        title: "SAQ C-VT v4.0.1",
        description:
          "Formato oficial para entornos que usan terminal virtual en navegadores aislados del resto del negocio.",
        href: "/templates/official-saq/saq-c-vt-v4-0-1.pdf",
        fileType: "PDF oficial",
      },
      {
        title: "SAQ D Merchant v4.0.1",
        description:
          "Formato oficial completo para comerciantes en alcance total de PCI DSS.",
        href: "/templates/official-saq/saq-d-merchant-v4-0-1.pdf",
        fileType: "PDF oficial",
      },
      {
        title: "SAQ D Merchant v4.0.1 en Word",
        description:
          "Version Word de referencia para planeacion de llenado y futura automatizacion documental.",
        href: "/templates/official-saq/saq-d-merchant-v4-0-1.docx",
        fileType: "DOCX de referencia",
      },
      {
        title: "SAQ D Service Provider v4.0.1 r2",
        description:
          "Formato oficial para proveedores de servicio en alcance PCI DSS version 4.0.1 revision 2.",
        href: "/templates/official-saq/saq-d-service-provider-v4-0-1-r2.pdf",
        fileType: "PDF oficial",
      },
    ],
  },
];

export function RepositoryPage() {
  return (
    <div className="page-stack placeholder-page repository-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Repositorio documental</p>
          <h1>Plantillas y documentacion</h1>
          <p className="page-subtitle">
            Material de apoyo, evidencia de referencia y formatos oficiales que puedes descargar para avanzar en tu proceso PCI DSS.
          </p>
        </div>
      </section>

      {repositoryGroups.map((group) => (
        <section key={group.title} className="single-page-card wide placeholder-card repository-card">
          <p className="brand-eyebrow">{group.eyebrow}</p>
          <h2>{group.title}</h2>
          <p className="subtle-text repository-card-copy">{group.description}</p>

          <div className="repository-download-grid">
            {group.items.map((item) => (
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
      ))}
    </div>
  );
}
