export function RepositoryPage() {
  return (
    <div className="page-stack placeholder-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Repositorio documental</p>
          <h1>Plantillas y documentacion</h1>
          <p className="page-subtitle">Material de apoyo que puedes descargar y editar para completar los requerimientos.</p>
        </div>
      </section>

      <section className="single-page-card wide placeholder-card">
        <p className="brand-eyebrow">Material de descarga</p>
        <h2>Descarga y adapta</h2>
        <p className="subtle-text" style={{ marginTop: "8px" }}>
          Aqui encontraras un listado de formatos y plantillas pre-aprobadas. Podras bajarlas, editarlas con la informacion de tu empresa, y luego utilizarlas para satisfacer la documentacion exigida por PCI DSS.
        </p>
        <div className="placeholder-grid" style={{ marginTop: "16px", display: "grid", gap: "16px" }}>
           <article className="mini-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Políticas de seguridad base</strong>
              <p style={{ marginTop: "4px" }}>Plantilla Word editable para políticas de seguridad de la información.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => alert('Descargando Política...')}>Descargar</button>
          </article>
          <article className="mini-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Formatos CCW (Controles Compensatorios)</strong>
              <p style={{ marginTop: "4px" }}>Documento oficial para la justificación y documentación de controles alternativos.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => alert('Descargando CCW...')}>Descargar</button>
          </article>
          <article className="mini-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Inventario de Activos</strong>
              <p style={{ marginTop: "4px" }}>Plantilla Excel para el registro y gestión de activos tecnológicos.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => alert('Descargando Inventario...')}>Descargar</button>
          </article>
        </div>
      </section>
    </div>
  );
}
