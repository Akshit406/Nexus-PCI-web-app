import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "../lib/api";
import { getToken } from "../lib/session";
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

function formatCaptureValue(field: SaqResponse["captureSections"][number]["fields"][number]) {
  if (!field.value) {
    return field.required ? "Pendiente" : "No aplica";
  }

  if (field.inputType === "checkbox-group") {
    try {
      const selectedValues = JSON.parse(field.value);
      if (Array.isArray(selectedValues)) {
        const labels = selectedValues
          .map((value) => field.options.find((option) => option.value === value)?.label)
          .filter(Boolean);
        return labels.length > 0 ? labels.join(", ") : field.required ? "Pendiente" : "No aplica";
      }
    } catch {}
  }

  if (field.inputType === "select" || field.inputType === "radio-group") {
    return field.options.find((option) => option.value === field.value)?.label ?? field.value;
  }

  return field.value;
}

function shouldIncludeCaptureField(
  section: SaqResponse["captureSections"][number],
  field: SaqResponse["captureSections"][number]["fields"][number],
) {
  const legalExceptionClaimed =
    section.id === "section-3-validation-certification" &&
    section.fields.find((item) => item.key === "legal_exception_claimed")?.value === "YES";

  if (section.id === "section-3-validation-certification" && field.key.startsWith("legal_exception_")) {
    return legalExceptionClaimed;
  }

  return field.required || Boolean(field.value?.trim());
}

function getVisibleCaptureFields(section: SaqResponse["captureSections"][number]) {
  return section.fields.filter((field) => shouldIncludeCaptureField(section, field));
}

function isCaptureFieldComplete(field: SaqResponse["captureSections"][number]["fields"][number]) {
  if (!field.required) {
    return true;
  }

  if (field.inputType === "checkbox-group") {
    try {
      const selectedValues = JSON.parse(field.value);
      return Array.isArray(selectedValues) && selectedValues.length > 0;
    } catch {
      return field.value.trim().length > 0;
    }
  }

  return field.value.trim().length > 0;
}

function getAutoSummaryValue(section: SaqResponse["autoSections"][number], label: string) {
  return section.summaryRows.find((row) => row.label === label)?.value ?? "";
}

function getGeneratedTypeLabel(type?: string | null) {
  if (type === "AOC_RESUMEN") {
    return "Resumen AOC preliminar";
  }
  if (type === "DIPLOMA") {
    return "Diploma";
  }
  if (type === "SAQ") {
    return "SAQ";
  }
  return type ?? "Documento generado";
}

export function OutputsPage() {
  const queryClient = useQueryClient();
  const [generationError, setGenerationError] = useState("");
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

  const generateMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean }>("/client/generation/generate"),
    onSuccess: async () => {
      setGenerationError("");
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["client-documents"] });
      await queryClient.invalidateQueries({ queryKey: ["saq-current"] });
    },
    onError(error) {
      setGenerationError(error instanceof Error ? error.message : "No fue posible generar los documentos.");
    },
  });

  const generationData = useMemo(() => {
    if (!dashboardQuery.data || !saqQuery.data) {
      return null;
    }

    const allRequirements = saqQuery.data.topics.flatMap((topic) => topic.requirements);
    const allAnswered = allRequirements.every((requirement) => Boolean(requirement.answerValue));
    const incompleteExceptionRequirements = allRequirements.filter((requirement) => {
      if (requirement.answerValue === "NOT_IMPLEMENTED") {
        return !requirement.explanation?.trim() || !requirement.resolutionDate;
      }
      if (requirement.answerValue === "NOT_TESTED") {
        return !requirement.explanation?.trim() || !requirement.resolutionDate;
      }
      return false;
    });
    const incompleteCaptureSections = saqQuery.data.captureSections.filter((section) =>
      section.fields.some((field) => !isCaptureFieldComplete(field)),
    );
    const signatureReady = dashboardQuery.data.certification.hasSignature;
    const paymentReady = dashboardQuery.data.certification.paymentState === "PAID";
    const readyForGeneration =
      allAnswered &&
      incompleteExceptionRequirements.length === 0 &&
      incompleteCaptureSections.length === 0 &&
      signatureReady &&
      paymentReady &&
      dashboardQuery.data.generation.ready;

    const pendingItems = Array.from(new Set([
      !allAnswered ? "Responder todos los requisitos del SAQ." : null,
      incompleteExceptionRequirements.length > 0
        ? "Completar explicacion y fecha para respuestas No Implementado / No Probado."
        : null,
      incompleteCaptureSections.length > 0
        ? "Completar todas las partes editables obligatorias del SAQ."
        : null,
      !signatureReady ? "Registrar la firma del cliente." : null,
      !paymentReady ? "Marcar el pago como realizado para habilitar generacion final." : null,
      ...dashboardQuery.data.generation.blockers,
    ].filter(Boolean) as string[]));

    return {
      allRequirements,
      allAnswered,
      incompleteExceptionRequirements,
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

    const captureSectionLines = saqQuery.data.captureSections.flatMap((section) => {
      const fields = getVisibleCaptureFields(section);
      return [
        `${section.title}`,
        ...(fields.length > 0
          ? fields.map((field) => `  - ${field.label}: ${formatCaptureValue(field)}`)
          : ["  - Sin campos requeridos pendientes o aplicables"]),
      ];
    });

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
      ...captureSectionLines,
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

  async function handleOutputDownload(itemId: string, fileName: string) {
    const token = getToken();
    const response = await fetch(`${API_URL}/client/documents/${itemId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      setGenerationError("No fue posible descargar el documento generado.");
      return;
    }
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
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
            Esta vista usa la informacion del registro del cliente, las partes completadas del SAQ y las respuestas del cuestionario para preparar los borradores de salida.
          </p>
        </div>
      </section>

      <section className="outputs-summary-grid">
        <article className="stat-card">
          <p className="muted-label">SAQ estructurado</p>
          <strong>{generationData.readyForGeneration ? "Listo" : "En preparacion"}</strong>
          <span>
            El borrador del SAQ se arma con datos capturados y secciones calculadas por la plataforma.
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
          <p className="muted-label">Resumen AOC</p>
          <strong>{generationData.readyForGeneration ? "Preparado" : "En preparacion"}</strong>
          <span>
            Se genera como resumen preliminar junto con el SAQ y el diploma cuando la informacion requerida queda completa.
          </span>
        </article>
      </section>

      <section className="single-page-card wide outputs-status-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Estado de generacion</p>
            <h2>{generationData.readyForGeneration ? "Salida lista para generacion final" : "Faltan elementos para la generacion final"}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={handleDraftDownload}>
            Descargar resumen borrador
          </button>
        </div>

        <div className="documents-action-row" style={{ marginTop: "16px" }}>
          <button
            type="button"
            className="primary-button"
            disabled={!generationData.readyForGeneration || generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
            title={generationData.readyForGeneration ? "Generar documentos finales" : "Completa los pendientes listados abajo para habilitar la generacion."}
          >
            {generateMutation.isPending ? "Generando..." : "Generar SAQ, diploma y resumen AOC"}
          </button>
        </div>

        {!generationData.readyForGeneration ? (
          <p className="info-text" style={{ marginTop: "10px" }}>
            El boton se habilitara cuando no existan pendientes de cuestionario, partes obligatorias, firma, pago ni evidencia aplicable.
          </p>
        ) : null}

        {generationError ? <p className="error-text">{generationError}</p> : null}

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
        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Fuente estructurada</p>
              <h2>Partes completadas dentro del SAQ</h2>
            </div>
            <span className="soft-badge">{saqQuery.data.captureSections.length} partes</span>
          </div>
          <div className="outputs-list-stack">
            {saqQuery.data.captureSections.map((section) => (
              <article key={section.id} className="mini-card output-section-card">
                <strong>{section.title}</strong>
                <div className="output-section-lines">
                  {getVisibleCaptureFields(section).length > 0 ? (
                    getVisibleCaptureFields(section).map((field) => (
                      <p key={field.key}>
                        {field.label}: <strong>{formatCaptureValue(field)}</strong>
                      </p>
                    ))
                  ) : (
                    <p className="subtle-text">Sin campos requeridos pendientes o aplicables.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Fuente automatica</p>
              <h2>Secciones calculadas por la plataforma</h2>
            </div>
            <span className="soft-badge">{saqQuery.data.autoSections.length} secciones</span>
          </div>
          <div className="outputs-list-stack">
            {saqQuery.data.autoSections.map((section) => {
              if (section.id === "section-3-validation-certification") {
                const status = getAutoSummaryValue(section, "Estado calculado");
                const text = getAutoSummaryValue(section, "Texto explicativo");
                const rows = section.summaryRows.filter((row) => !["Estado calculado", "Texto explicativo"].includes(row.label));
                return (
                  <article key={section.id} className="mini-card output-section-card output-validation-card">
                    <strong>{section.title}</strong>
                    <div className="validation-status-card compact">
                      <p className="muted-label">Estado calculado</p>
                      <strong>{status}</strong>
                      <p>{text}</p>
                    </div>
                    {rows.map((row) => (
                      <p key={`${section.id}-${row.label}`}>
                        {row.label}: <strong>{row.value || "No aplica"}</strong>
                      </p>
                    ))}
                    {section.entries.length > 0 ? (
                      <p className="subtle-text">{section.entries.length} requisitos alimentan esta seccion.</p>
                    ) : null}
                  </article>
                );
              }

              return (
                <article key={section.id} className="mini-card output-section-card">
                  <strong>{section.title}</strong>
                  {section.summaryRows.map((row) => (
                    <p key={`${section.id}-${row.label}`}>
                      {row.label}: <strong>{row.value || "No aplica"}</strong>
                    </p>
                  ))}
                  {section.entries.length > 0 ? (
                    <p className="subtle-text">{section.entries.length} registros alimentan esta seccion.</p>
                  ) : section.emptyMessage ? (
                    <p className="subtle-text">{section.emptyMessage}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </article>
      </section>

      <section className="single-page-card wide">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Apoyo documental</p>
              <h2>Documentos regresados al sistema</h2>
            </div>
            <span className="soft-badge">{documentsQuery.data?.items.length ?? 0} archivos</span>
          </div>
        <p className="subtle-text">
          Los documentos editados ya cargados al sistema pueden complementar la revision y la preparacion documental, pero no sustituyen la generacion automatica de SAQ, resumen AOC o diploma.
        </p>
      </section>

      <section className="single-page-card wide">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Documentos finales</p>
            <h2>Descargas generadas</h2>
          </div>
          <span className="soft-badge">
            {documentsQuery.data?.items.filter((item) => item.category === "GENERATED_OUTPUT").length ?? 0} archivos
          </span>
        </div>
        <div className="outputs-list-stack">
          {documentsQuery.data?.items.filter((item) => item.category === "GENERATED_OUTPUT").map((item) => (
            <article key={item.id} className="mini-card document-list-item">
              <div className="document-list-copy">
                <strong>{item.title}</strong>
                <p className="subtle-text">{getGeneratedTypeLabel(item.generatedType)} · {item.fileName}</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => void handleOutputDownload(item.id, item.fileName)}>
                Descargar
              </button>
            </article>
          ))}
          {documentsQuery.data?.items.filter((item) => item.category === "GENERATED_OUTPUT").length === 0 ? (
            <article className="mini-card empty-state-card">
              <strong>No hay documentos finales generados</strong>
              <p>Cuando el flujo este completo y pagado, se podran generar el SAQ, el diploma y el resumen AOC preliminar aqui.</p>
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}
