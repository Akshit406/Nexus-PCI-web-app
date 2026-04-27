import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { RequirementCard } from "../components/RequirementCard";
import { api } from "../lib/api";
import { SaqAutoSection, SaqCaptureSection, SaqResponse, SaqTopic } from "../types";

const PAYMENT_ES: Record<string, string> = {
  UNPAID: "Pendiente",
  PAID: "Pagado",
};

function getSectionValues(section: SaqCaptureSection) {
  return Object.fromEntries(section.fields.map((field) => [field.key, field.value]));
}

function parseCheckboxValue(value: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function stringifyCheckboxValue(values: string[]) {
  return JSON.stringify(values);
}

function CaptureSectionBody({
  section,
  isLocked,
}: {
  section: SaqCaptureSection;
  isLocked: boolean;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => getSectionValues(section));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSubmitted = useRef(JSON.stringify(getSectionValues(section)));
  const sectionSnapshot = JSON.stringify(section.fields.map((field) => [field.key, field.value]));

  useEffect(() => {
    const nextValues = getSectionValues(section);
    setValues(nextValues);
    lastSubmitted.current = JSON.stringify(nextValues);
  }, [section.id, sectionSnapshot]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveState("saving");
      await api.put<{ success: boolean }>(`/saq/sections/${section.id}`, { values });
    },
    onSuccess() {
      lastSubmitted.current = JSON.stringify(values);
      queryClient.setQueryData<SaqResponse>(["saq-current"], (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          captureSections: current.captureSections.map((currentSection) =>
            currentSection.id !== section.id
              ? currentSection
              : {
                  ...currentSection,
                  fields: currentSection.fields.map((field) => ({
                    ...field,
                    value: values[field.key] ?? "",
                  })),
                },
          ),
        };
      });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    },
    onError() {
      setSaveState("error");
    },
  });

  useEffect(() => {
    if (isLocked) {
      return;
    }

    const snapshot = JSON.stringify(values);
    if (snapshot === lastSubmitted.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      saveMutation.mutate();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [isLocked, values]);

  return (
    <div className="saq-part-content-grid">
      <div className="saq-part-save-row">
        <span className={`save-state ${saveState}`}>
          {saveState === "idle"
            ? isLocked
              ? "Bloqueado"
              : "Listo"
            : saveState === "saving"
              ? "Guardando"
              : saveState === "saved"
                ? "Guardado"
                : "Error"}
        </span>
      </div>

      {section.fields.map((field) => {
        const selectedValues = field.inputType === "checkbox-group" ? parseCheckboxValue(values[field.key] ?? "") : [];

        return (
        <label key={field.key} className={`field${field.inputType === "checkbox-group" ? " checkbox-field" : ""}`}>
          <span>
            {field.label}
            {!field.required ? <em>Opcional</em> : null}
          </span>
          {field.inputType === "textarea" ? (
            <textarea
              rows={4}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
              disabled={isLocked}
            />
          ) : field.inputType === "select" ? (
            <select
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              disabled={isLocked}
            >
              <option value="">{field.placeholder}</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.inputType === "checkbox-group" ? (
            <div className="checkbox-group" role="group" aria-label={field.label}>
              {field.options.map((option) => {
                const isChecked = selectedValues.includes(option.value);

                return (
                  <span key={option.value} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isLocked}
                      onChange={(event) => {
                        const nextValues = event.target.checked
                          ? [...selectedValues, option.value]
                          : selectedValues.filter((value) => value !== option.value);
                        setValues((current) => ({
                          ...current,
                          [field.key]: stringifyCheckboxValue(nextValues),
                        }));
                      }}
                    />
                    <span>{option.label}</span>
                  </span>
                );
              })}
            </div>
          ) : (
            <input
              type="text"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
              disabled={isLocked}
            />
          )}
        </label>
        );
      })}

      {saveState === "error" ? (
        <p className="error-text">
          No se pudo guardar esta parte. Revisa los datos e intenta nuevamente.
        </p>
      ) : null}
    </div>
  );
}

function AutoSectionBody({ section }: { section: SaqAutoSection }) {
  return (
    <div className="saq-part-content-grid">
      {section.summaryRows.length > 0 ? (
        <dl className="auto-section-summary">
          {section.summaryRows.map((row) => (
            <div key={`${section.id}-${row.label}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {section.entries.length > 0 ? (
        <div className="auto-section-entry-list">
          {section.entries.map((entry) => (
            <article key={`${section.id}-${entry.title}`} className="auto-section-entry">
              <strong>{entry.title}</strong>
              <div className="auto-section-lines">
                {entry.lines.map((line) => (
                  <p key={`${entry.title}-${line}`}>{line}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : section.emptyMessage ? (
        <p className="auto-section-empty">{section.emptyMessage}</p>
      ) : null}
    </div>
  );
}

export function QuestionnairePage() {
  const queryClient = useQueryClient();
  const requirementsAnchorRef = useRef<HTMLDivElement | null>(null);
  const saqQuery = useQuery({
    queryKey: ["saq-current"],
    queryFn: () => api.get<SaqResponse>("/saq/current"),
  });
  const [activeTopicCode, setActiveTopicCode] = useState("");
  const [openPartId, setOpenPartId] = useState("");

  const saveActiveTopic = useMutation({
    mutationFn: (topicCode: string) =>
      api.patch<{ success: boolean }>("/saq/active-topic", { topicCode }),
  });

  useEffect(() => {
    if (!saqQuery.data || activeTopicCode) {
      return;
    }

    setActiveTopicCode(
      saqQuery.data.certification.lastViewedTopicCode ?? saqQuery.data.topics[0]?.topicCode ?? "",
    );
  }, [saqQuery.data, activeTopicCode]);

  useEffect(() => {
    if (!saqQuery.data || openPartId) {
      return;
    }

    setOpenPartId(saqQuery.data.sectionPlan[0]?.id ?? "");
  }, [saqQuery.data, openPartId]);

  const activeTopic = useMemo(
    () =>
      saqQuery.data?.topics.find((topic) => topic.topicCode === activeTopicCode) ??
      saqQuery.data?.topics[0],
    [activeTopicCode, saqQuery.data],
  );
  const activeTopicIndex =
    saqQuery.data?.topics.findIndex((topic) => topic.topicCode === activeTopic?.topicCode) ?? -1;

  const captureSectionsById = useMemo(
    () => new Map((saqQuery.data?.captureSections ?? []).map((section) => [section.id, section])),
    [saqQuery.data?.captureSections],
  );
  const autoSectionsById = useMemo(
    () => new Map((saqQuery.data?.autoSections ?? []).map((section) => [section.id, section])),
    [saqQuery.data?.autoSections],
  );

  if (saqQuery.isLoading) {
    return <div className="loading-panel">Cargando cuestionario...</div>;
  }

  if (saqQuery.isError || !saqQuery.data) {
    return <div className="error-panel">No fue posible cargar el SAQ asignado.</div>;
  }

  const answeredCount = saqQuery.data.topics.reduce(
    (total, topic) =>
      total + topic.requirements.filter((requirement) => Boolean(requirement.answerValue)).length,
    0,
  );
  const totalRequirements = saqQuery.data.topics.reduce(
    (total, topic) => total + topic.requirements.length,
    0,
  );
  const progressPct = totalRequirements ? Math.round((answeredCount / totalRequirements) * 100) : 0;

  const saqParts = saqQuery.data.sectionPlan.map((section) => {
    const captureSection = captureSectionsById.get(section.id) ?? null;
    const autoSection = autoSectionsById.get(section.id) ?? null;
    const kind: "capture" | "auto" | "questionnaire" = captureSection
      ? "capture"
      : autoSection
        ? "auto"
        : "questionnaire";

    return {
      ...section,
      kind,
      captureSection,
      autoSection,
    };
  });

  function replaceRequirement(
    topicCode: string,
    requirementId: string,
    nextRequirement: SaqTopic["requirements"][number],
  ) {
    queryClient.setQueryData<SaqResponse>(["saq-current"], (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        topics: current.topics.map((topic) =>
          topic.topicCode !== topicCode
            ? topic
            : {
                ...topic,
                requirements: topic.requirements.map((requirement) =>
                  requirement.id === requirementId ? nextRequirement : requirement,
                ),
              },
        ),
      };
    });

    queryClient.invalidateQueries({ queryKey: ["saq-current"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  function goToTopic(nextTopicCode: string | undefined) {
    if (!nextTopicCode) {
      return;
    }

    setActiveTopicCode(nextTopicCode);
    saveActiveTopic.mutate(nextTopicCode);
  }

  function handlePartToggle(partId: string) {
    setOpenPartId((current) => (current === partId ? "" : partId));
  }

  return (
    <div className="questionnaire-layout">
      <section className="questionnaire-main">
        <section className="page-intro questionnaire-intro">
          <div>
            <p className="brand-eyebrow">Cuestionario</p>
            <h1>{saqQuery.data.certification.saqTypeName}</h1>
            <p className="page-subtitle">
              Responde cada requisito del cuestionario asignado.
              {saqQuery.data.certification.templateVersion
                ? ` Plantilla ${saqQuery.data.certification.templateVersion}.`
                : ""}
            </p>
          </div>
          <span className="status-chip">
            {saqQuery.data.certification.isLocked ? "Bloqueado" : "En progreso"}
          </span>
        </section>

        <div className="panel saq-parts-panel">
          <div className="panel-header">
            <div>
              <p className="muted-label">Partes del SAQ</p>
              <h3>Completa y revisa las partes en el orden del documento</h3>
            </div>
          </div>

          <div className="saq-parts-list">
            {saqParts.map((part) => {
              const isOpen = openPartId === part.id;

              return (
                <article
                  key={part.id}
                  className={`saq-part-item${isOpen ? " open" : ""}`}
                >
                  <button
                    type="button"
                    className="saq-part-toggle"
                    onClick={() => handlePartToggle(part.id)}
                  >
                    <div className="saq-part-title-group">
                      <span className="saq-part-index">{part.displayOrder}</span>
                      <div>
                        <strong>{part.title}</strong>
                      </div>
                    </div>
                    <ChevronDown aria-hidden="true" />
                  </button>

                  {isOpen ? (
                    <div className="saq-part-body">
                      {part.captureSection ? (
                        <CaptureSectionBody
                          section={part.captureSection}
                          isLocked={saqQuery.data.certification.isLocked}
                        />
                      ) : part.autoSection ? (
                        <AutoSectionBody section={part.autoSection} />
                      ) : (
                        <div className="saq-part-content-grid questionnaire-part-callout">
                          <p className="subtle-text">
                            Esta parte corresponde al cuestionario de requisitos. Responde los temas
                            del SAQ en el bloque que se muestra debajo.
                          </p>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() =>
                              requirementsAnchorRef.current?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                            }
                          >
                            Ir al cuestionario
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="panel progress-overview-card">
          <div className="panel-header">
            <div>
              <p className="muted-label">Progreso general</p>
              <h3>
                {answeredCount} de {totalRequirements} requisitos respondidos
              </h3>
            </div>
            <strong className="progress-highlight">{progressPct}%</strong>
          </div>
          <div className="progress-bar large" style={{ marginTop: "12px" }}>
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-field search-field">
            <span className="filter-icon">SR</span>
            <input placeholder="Buscar requisitos..." disabled />
          </div>
          <div className="filter-field">
            <select disabled defaultValue="all-categories">
              <option value="all-categories">Todas las categorias</option>
            </select>
          </div>
          <div className="filter-field compact-select">
            <select disabled defaultValue="all-status">
              <option value="all-status">Todos</option>
            </select>
          </div>
        </div>

        <div className="questionnaire-content-grid" ref={requirementsAnchorRef}>
          <aside className="questionnaire-sidebar">
            <div className="panel compact topic-summary-panel">
              <p className="muted-label">SAQ asignado</p>
              <h3>{saqQuery.data.certification.saqTypeName}</h3>
              <p className="subtle-text">
                {answeredCount} de {totalRequirements} requisitos respondidos
              </p>
              <div className="progress-bar" style={{ marginTop: "8px" }}>
                <span style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <div className="topic-nav">
              {saqQuery.data.topics.map((topic) => {
                const answered = topic.requirements.filter((requirement) =>
                  Boolean(requirement.answerValue),
                ).length;
                const percentage = topic.requirements.length
                  ? Math.round((answered / topic.requirements.length) * 100)
                  : 0;

                return (
                  <button
                    key={topic.topicCode}
                    type="button"
                    className={`topic-nav-item${activeTopic?.topicCode === topic.topicCode ? " active" : ""}`}
                    onClick={() => {
                      setActiveTopicCode(topic.topicCode);
                      saveActiveTopic.mutate(topic.topicCode);
                    }}
                  >
                    <div>
                      <strong>{topic.topicCode}</strong>
                      <span>{topic.topicName}</span>
                    </div>
                    <em>{percentage}%</em>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="requirements-column">
            <div className="panel current-topic-card">
              <div className="panel-header">
                <div>
                  <p className="muted-label">Seccion actual</p>
                  <h2>{activeTopic?.topicName}</h2>
                </div>
                <div className="questionnaire-meta">
                  <span className="soft-badge">
                    {PAYMENT_ES[saqQuery.data.certification.paymentState] ||
                      saqQuery.data.certification.paymentState}
                  </span>
                  <span className="soft-badge">
                    {saqQuery.data.certification.isLocked ? "Bloqueado" : "Editable"}
                  </span>
                </div>
              </div>
              <p className="subtle-text" style={{ marginTop: "8px" }}>
                El guardado automatico esta activo. Las respuestas con CCW, No Aplicable y No
                Probado actualizan las partes automaticas del SAQ.
              </p>
            </div>

            <div className="requirements-stack">
              {activeTopic?.requirements.map((requirement) => (
                <RequirementCard
                  key={requirement.id}
                  requirement={requirement}
                  activeTopicCode={activeTopic.topicCode}
                  onSaved={(nextRequirement) =>
                    replaceRequirement(activeTopic.topicCode, requirement.id, nextRequirement)
                  }
                />
              ))}
            </div>

            <div className="topic-stepper">
              <button
                type="button"
                className="ghost-button"
                disabled={activeTopicIndex <= 0}
                onClick={() => goToTopic(saqQuery.data.topics[activeTopicIndex - 1]?.topicCode)}
              >
                Tema anterior
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={
                  activeTopicIndex < 0 || activeTopicIndex >= saqQuery.data.topics.length - 1
                }
                onClick={() => goToTopic(saqQuery.data.topics[activeTopicIndex + 1]?.topicCode)}
              >
                Guardar y continuar
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
