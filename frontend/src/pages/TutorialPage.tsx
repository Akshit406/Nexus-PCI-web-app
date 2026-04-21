export function TutorialPage() {
  return (
    <div className="page-stack placeholder-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Ayuda y guias</p>
          <h1>Tutorial de uso</h1>
          <p className="page-subtitle">Aprende a navegar y completar tu certificacion PCI DSS.</p>
        </div>
      </section>

      <section className="single-page-card wide placeholder-card">
        <p className="brand-eyebrow">Video y manuales</p>
        <h2>Como usar la plataforma</h2>
        <p className="subtle-text" style={{ marginTop: "8px" }}>
          Revisa nuestro video interactivo y descarga el manual de uso para familiarizarte con las secciones, anexos y controles compensatorios.
        </p>
        <div className="placeholder-grid" style={{ marginTop: "16px", display: "grid", gap: "24px" }}>
          <article className="mini-card" style={{ padding: 0, overflow: "hidden" }}>
             <div style={{ background: "#000", aspectRatio: "16/9", display: "grid", placeItems: "center" }}>
               <span style={{ color: "#fff", opacity: 0.7 }}>[ Reproductor de Video ]</span>
             </div>
             <div style={{ padding: "16px" }}>
               <strong>Video de introduccion</strong>
               <p style={{ marginTop: "4px" }}>Visualiza este video guiado para conocer el proceso paso a paso.</p>
             </div>
          </article>
          <article className="mini-card">
            <strong>Manual de Usuario PDF</strong>
            <p style={{ marginTop: "8px", marginBottom: "16px" }}>Descarga el manual oficial para resolver tus dudas y conocer el marco normativo completo.</p>
            <button type="button" className="primary-button" onClick={() => alert('Descarga de manual iniciada')}>Descargar Documento</button>
          </article>
        </div>
      </section>
    </div>
  );
}
