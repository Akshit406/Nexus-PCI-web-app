type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="page-stack placeholder-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Modulo previsto</p>
          <h1>{title}</h1>
          <p className="page-subtitle">{description}</p>
        </div>
      </section>

      <section className="single-page-card wide placeholder-card">
        <p className="brand-eyebrow">Modulo previsto</p>
        <h2>Preparado en la Fase 1</h2>
        <p className="subtle-text" style={{ marginTop: "8px" }}>
          Esta seccion ya existe dentro de la navegacion para que la experiencia del cliente refleje desde ahora la
          estructura final del producto.
        </p>
        <div className="placeholder-grid">
          <article className="mini-card">
            <strong>Por que existe</strong>
            <p>La plataforma necesita esta ruta desde el inicio porque documentos y salidas de certificacion forman parte central del recorrido del usuario.</p>
          </article>
          <article className="mini-card">
            <strong>Siguiente fase</strong>
            <p>La gestion de evidencia, las salidas generadas y las reglas del ciclo documental se completaran en la Fase 2.</p>
          </article>
        </div>
      </section>
    </div>
  );
}
