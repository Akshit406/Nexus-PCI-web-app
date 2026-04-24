import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ClientDocumentsResponse, DashboardResponse, SaqResponse } from "../types";

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export function OutputsPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/client/dashboard"),
  });

  const saqQuery = useQuery({
    queryKey: ["saq-current"],
    queryFn: () => api.get<SaqResponse>("/saq/current"),
  });

  const documentsQuery = useQuery({
    queryKey: ["client-documents"],
    queryFn: () => api.get<ClientDocumentsResponse>("/client/documents"),
  });

  const generationData = useMemo(() => {
    if (!dashboardQuery.data || !saqQuery.data) {
      return null;
    }

    const allRequirements = saqQuery.data.topics.flatMap((topic) => topic.requirements);
    const allAnswered = allRequirements.every((requirement) => Boolean(requirement.answerValue));
    const blockingRequirements = allRequirements.filter(
      (requirement) =>
        requirement.answerValue === "NOT_IMPLEMENTED" ||
        requirement.answerValue === "NOT_TESTED",
    );
    const incompleteCaptureSections = saqQuery.data.captureSections.filter((section) =>
      section.fields.some((field) => !field.value.trim()),
    );
    const signatureReady = dashboardQuery.data.certification.hasSignature;
    const paymentReady = dashboardQuery.data.certification.paymentState === "PAID";
    const readyForGeneration =
      allAnswered &&
      blockingRequirements.length === 0 &&
      incompleteCaptureSections.length === 0 &&
      signatureReady &&
      paymentReady;

    const pendingItems = [
      !allAnswered ? "Responder todos los requisitos del SAQ." : null,
      blockingRequirements.length > 0
        ? "Resolver respuestas No Implementado / No Probado antes de generar."
        : null,
      incompleteCaptureSections.length > 0
        ? "Completar todas las fichas editables obligatorias del SAQ."
        : null,
      !signatureReady ? "Registrar la firma del cliente." : null,
      !paymentReady ? "Marcar el pago como realizado para habilitar generacion final." : null,
    ].filter(Boolean) as string[];

    return {
      allRequirements,
      allAnswered,
      blockingRequirements,
      incompleteCaptureSections,
      signatureReady,
      paymentReady,
      readyForGeneration,
      pendingItems,
    };
  }, [dashboardQuery.data, saqQuery.data]);

  function handleDraftDownload() {
    if (!dashboardQuery.data || !saqQuery.data || !generationData) {
      return;
    }

    const lines = [
      "BORRADOR INTERNO DE SALIDA PCI NEXUS",
      "",
      `Empresa: ${dashboardQuery.data.client.companyName}`,
      `SAQ asignado: ${dashboardQuery.data.certification.saqType}`,
      `Ciclo: ${dashboardQuery.data.certification.cycleYear}`,
      `Estado de pago: ${dashboardQuery.data.certification.paymentState}`,
      `Firma presente: ${generationData.signatureReady ? "Si" : "No"}`,
      `Listo para generacion final: ${generationData.readyForGeneration ? "Si" : "No"}`,
      "",
      "PENDIENTES",
      ...(generationData.pendingItems.length > 0
        ? generationData.pendingItems.map((item) => `- ${item}`)
        : ["- Sin pendientes de generacion"]),
      "",
      "FICHAS DE CAPTURA",
      ...saqQuery.data.captureSections.flatMap((section) => [
        `${section.title}`,
        ...section.fields.map((field) => `  - ${field.label}: ${field.value || "Pendiente"}`),
      ]),
      "",
      "SECCIONES AUTOMATICAS",
      ...saqQuery.data.autoSections.flatMap((section) => [
        `${section.title}`,
        ...section.summaryRows.map((row) => `  - ${row.label}: ${row.value}`),
        ...section.entries.flatMap((entry) => [
          `  * ${entry.title}`,
          ...entry.lines.map((line) => `    ${line}`),
        ]),
      ]),
      "",
      `Documentos regresados al sistema: ${documentsQuery.data?.items.length ?? 0}`,
    ];

    downloadTextFile("pci-nexus-borrador-salida.txt", lines.join("\n"));
  }

  if (dashboardQuery.isLoading || saqQuery.isLoading || documentsQuery.isLoading) {
    return <div className="loading-panel">Preparando salida generada...</div>;
  }

  if (dashboardQuery.isError || saqQuery.isError || documentsQuery.isError || !dashboardQuery.data || !saqQuery.data || !generationData) {
    return <div className="error-panel">No fue posible preparar las salidas de certificacion.</div>;
  }

  return (
    <div className="page-stack outputs-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Salidas generadas</p>
          <h1>Documentos construidos desde los datos capturados</h1>
          <p className="page-subtitle">
            Esta vista usa la informacion del registro del cliente, las fichas del SAQ y las respuestas del cuestionario para preparar los borradores de salida.
          </p>
        </div>
      </section>

      <section className="outputs-summary-grid">
        <article className="stat-card">
          <p className="muted-label">SAQ estructurado</p>
          <strong>{generationData.readyForGeneration ? "Listo" : "En preparacion"}</strong>
          <span>
            El borrador del SAQ se arma con datos capturados y bloques automaticos, no desde una edicion manual del documento final.
          </span>
        </article>
        <article className="stat-card">
          <p className="muted-label">Diploma</p>
          <strong>{generationData.readyForGeneration ? "Preparado" : "Pendiente"}</strong>
          <span>
            Se alimenta de la empresa, ciclo y estado global de certificacion cuando la generacion quede habilitada.
          </span>
        </article>
        <article className="stat-card">
          <p className="muted-label">AOC</p>
          <strong>Pendiente</strong>
          <span>
            La plantilla oficial del AOC sigue faltando, asi que solo dejamos lista la estructura de datos y el estado del flujo.
          </span>
        </article>
      </section>

      <section className="single-page-card wide placeholder-card outputs-status-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Estado de generacion</p>
            <h2>{generationData.readyForGeneration ? "Salida lista para generacion final" : "Faltan elementos para la generacion final"}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={handleDraftDownload}>
            Descargar resumen borrador
          </button>
        </div>

        <div className="outputs-checklist">
          {generationData.pendingItems.length > 0 ? (
            generationData.pendingItems.map((item) => (
              <article key={item} className="mini-card output-check-item">
                <strong>Pendiente</strong>
                <p>{item}</p>
              </article>
            ))
          ) : (
            <article className="mini-card output-check-item success">
              <strong>Sin bloqueos</strong>
              <p>La informacion principal para generacion final ya esta capturada en el sistema.</p>
            </article>
          )}
        </div>
      </section>

      <section className="outputs-panels-grid">
        <article className="single-page-card wide placeholder-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Fuente estructurada</p>
              <h2>Fichas capturadas dentro del sistema</h2>
            </div>
            <span className="soft-badge">{saqQuery.data.captureSections.length} fichas</span>
          </div>
          <div className="outputs-list-stack">
            {saqQuery.data.captureSections.map((section) => (
              <article key={section.id} className="mini-card output-section-card">
                <strong>{section.title}</strong>
                <div className="output-section-lines">
                  {section.fields.map((field) => (
                    <p key={field.key}>
                      {field.label}: <strong>{field.value || "Pendiente"}</strong>
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="single-page-card wide placeholder-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Fuente automatica</p>
              <h2>Bloques que arma el sistema</h2>
            </div>
            <span className="soft-badge">{saqQuery.data.autoSections.length} bloques</span>
          </div>
          <div className="outputs-list-stack">
            {saqQuery.data.autoSections.map((section) => (
              <article key={section.id} className="mini-card output-section-card">
                <strong>{section.title}</strong>
                {section.summaryRows.map((row) => (
                  <p key={`${section.id}-${row.label}`}>
                    {row.label}: <strong>{row.value}</strong>
                  </p>
                ))}
                {section.entries.length > 0 ? (
                  <p className="subtle-text">{section.entries.length} registros alimentan este bloque.</p>
                ) : section.emptyMessage ? (
                  <p className="subtle-text">{section.emptyMessage}</p>
                ) : null}
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="single-page-card wide placeholder-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Apoyo documental</p>
              <h2>Documentos regresados al sistema</h2>
            </div>
            <span className="soft-badge">{documentsQuery.data?.items.length ?? 0} archivos</span>
          </div>
        <p className="subtle-text">
          Los documentos editados ya cargados al sistema pueden complementar la revision y la preparacion documental, pero no sustituyen la generacion automatica de SAQ, AOC o diploma.
        </p>
      </section>
    </div>
  );
}
