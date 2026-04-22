import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RequirementCard } from "../components/RequirementCard";
import { api } from "../lib/api";
import { SaqResponse, SaqTopic } from "../types";

const PAYMENT_ES: Record<string, string> = {
  UNPAID: "Pendiente",
  PAID: "Pagado",
};

const SECTION_SCOPE_ES: Record<SaqResponse["sectionPlan"][number]["scope"], string> = {
  FIXED_ALL_SAQS: "Fijo en todos los SAQ",
  VARIABLE_ALL_SAQS: "Variable en todos los SAQ",
  VARIABLE_BY_SAQ: "Variable segun el SAQ",
  VARIABLE_P2PE_ONLY: "Solo para P2PE",
};

const SECTION_FILLED_BY_ES: Record<SaqResponse["sectionPlan"][number]["filledBy"], string> = {
  EXECUTIVE_SETUP: "Ejecutivo y registro del cliente",
  CLIENT_DURING_SAQ: "Cliente durante el SAQ",
  CLIENT_AT_COMPLETION: "Cliente al cierre",
  SYSTEM_FROM_ANSWERS: "Sistema segun respuestas",
  SYSTEM_FROM_SAQ_SELECTION: "Sistema segun SAQ asignado",
};

export function QuestionnairePage() {
  const queryClient = useQueryClient();
  const saqQuery = useQuery({
    queryKey: ["saq-current"],
    queryFn: () => api.get<SaqResponse>("/saq/current"),
  });
  const [activeTopicCode, setActiveTopicCode] = useState("");

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

  const activeTopic = useMemo(
    () =>
      saqQuery.data?.topics.find((topic) => topic.topicCode === activeTopicCode) ??
      saqQuery.data?.topics[0],
    [activeTopicCode, saqQuery.data],
  );
  const activeTopicIndex =
    saqQuery.data?.topics.findIndex((topic) => topic.topicCode === activeTopic?.topicCode) ?? -1;

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

    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  function goToTopic(nextTopicCode: string | undefined) {
    if (!nextTopicCode) {
      return;
    }

    setActiveTopicCode(nextTopicCode);
    saveActiveTopic.mutate(nextTopicCode);
  }

  return (
    <div className="questionnaire-layout">
      <section className="questionnaire-main">
        {/* ── Header ── */}
        <section className="page-intro questionnaire-intro">
          <div>
            <p className="brand-eyebrow">Cuestionario</p>
            <h1>{saqQuery.data.certification.saqTypeName}</h1>
            <p className="page-subtitle">
              Responde cada requisito del cuestionario asignado.
              {saqQuery.data.certification.templateVersion ? ` Plantilla ${saqQuery.data.certification.templateVersion}.` : ""}
            </p>
          </div>
          <span className="status-chip">
            {saqQuery.data.certification.isLocked ? "Bloqueado" : "En progreso"}
          </span>
        </section>

        {/* ── Progress overview ── */}
        <div className="panel saq-structure-panel">
          <div className="panel-header">
            <div>
              <p className="muted-label">Estructura del SAQ</p>
              <h3>Secciones adicionales contempladas</h3>
            </div>
            <span className="soft-badge">{saqQuery.data.sectionPlan.length} bloques</span>
          </div>

          <div className="saq-structure-note-list">
            {saqQuery.data.structuralNotes.map((note) => (
              <p key={note} className="subtle-text">
                {note}
              </p>
            ))}
          </div>

          <div className="saq-structure-list">
            {saqQuery.data.sectionPlan.map((section) => (
              <article key={section.id} className="saq-structure-item">
                <div className="saq-structure-item-header">
                  <strong>{section.displayOrder}. {section.title}</strong>
                  <span className="soft-badge">{SECTION_SCOPE_ES[section.scope]}</span>
                </div>
                <p>{section.details}</p>
                <div className="saq-structure-meta-row">
                  <span className="muted-label">Se llena por</span>
                  <strong>{SECTION_FILLED_BY_ES[section.filledBy]}</strong>
                </div>
                {section.condition ? <p className="saq-structure-condition">{section.condition}</p> : null}
              </article>
            ))}
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

        {/* ── Filter row ── */}
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

        {/* ── Sidebar + requirements ── */}
        <div className="questionnaire-content-grid">
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
            {/* Current topic header */}
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
                Probado requieren informacion adicional y alimentan la estructura de anexos del SAQ.
              </p>
            </div>

            {/* Requirement cards */}
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

            {/* Stepper */}
            <div className="topic-stepper">
              <button
                type="button"
                className="ghost-button"
                disabled={activeTopicIndex <= 0}
                onClick={() => goToTopic(saqQuery.data.topics[activeTopicIndex - 1]?.topicCode)}
              >
                ← Tema anterior
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={
                  activeTopicIndex < 0 || activeTopicIndex >= saqQuery.data.topics.length - 1
                }
                onClick={() => goToTopic(saqQuery.data.topics[activeTopicIndex + 1]?.topicCode)}
              >
                Guardar y continuar →
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
