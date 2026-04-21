import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { SaqRequirement } from "../types";

const answerOptions = [
  { value: "IMPLEMENTED", label: "Implementado" },
  { value: "CCW", label: "Implementado con CCW" },
  { value: "NOT_APPLICABLE", label: "No Aplicable" },
  { value: "NOT_IMPLEMENTED", label: "No Implementado" },
  { value: "NOT_TESTED", label: "No Probado" },
] as const;

type RequirementCardProps = {
  requirement: SaqRequirement;
  activeTopicCode: string;
  onSaved: (nextRequirement: SaqRequirement) => void;
};

function needsExplanation(answerValue: string | null) {
  return answerValue === "CCW" || answerValue === "NOT_APPLICABLE" || answerValue === "NOT_TESTED";
}

function getCcwData(exp: string) {
  try {
    const parsed = JSON.parse(exp);
    if (parsed && typeof parsed === "object") {
      return {
        restrictions: parsed.restrictions || "",
        definition: parsed.definition || "",
        objective: parsed.objective || "",
        risk: parsed.risk || "",
        validation: parsed.validation || "",
        maintenance: parsed.maintenance || "",
      };
    }
  } catch {}
  return {
    restrictions: exp || "",
    definition: "",
    objective: "",
    risk: "",
    validation: "",
    maintenance: "",
  };
}

export function RequirementCard({ requirement, activeTopicCode, onSaved }: RequirementCardProps) {
  const [answerValue, setAnswerValue] = useState<string>(requirement.answerValue ?? "");
  const [explanation, setExplanation] = useState(requirement.explanation ?? "");
  const [ccwData, setCcwData] = useState(() => getCcwData(requirement.explanation ?? ""));
  const [resolutionDate, setResolutionDate] = useState(requirement.resolutionDate?.slice(0, 10) ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSubmitted = useRef("");

  useEffect(() => {
    setAnswerValue(requirement.answerValue ?? "");
    setExplanation(requirement.explanation ?? "");
    setCcwData(getCcwData(requirement.explanation ?? ""));
    setResolutionDate(requirement.resolutionDate?.slice(0, 10) ?? "");
    lastSubmitted.current = JSON.stringify({
      answerValue: requirement.answerValue ?? "",
      explanation: requirement.explanation ?? "",
      resolutionDate: requirement.resolutionDate?.slice(0, 10) ?? "",
    });
  }, [requirement.answerValue, requirement.explanation, requirement.resolutionDate]);

  function updateCcw(key: string, value: string) {
    const nextCcw = { ...ccwData, [key]: value };
    setCcwData(nextCcw);
    setExplanation(JSON.stringify(nextCcw));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!answerValue) {
        return null;
      }

      setSaveState("saving");
      await api.put<{ success: boolean }>(`/saq/answers/${requirement.id}`, {
        answerValue,
        explanation: explanation.trim() || undefined,
        resolutionDate: resolutionDate ? new Date(`${resolutionDate}T00:00:00.000Z`).toISOString() : null,
        activeTopicCode,
      });

      return {
        ...requirement,
        answerValue,
        explanation,
        resolutionDate: resolutionDate ? `${resolutionDate}T00:00:00.000Z` : null,
        isPreloaded: false,
        justificationType:
          answerValue === "CCW"
            ? "CCW_ANNEX_B"
            : answerValue === "NOT_APPLICABLE"
              ? "NA_ANNEX_C"
              : answerValue === "NOT_TESTED"
                ? "NOT_TESTED_ANNEX_D"
                : null,
      } satisfies SaqRequirement;
    },
    onSuccess(result) {
      if (!result) {
        return;
      }

      lastSubmitted.current = JSON.stringify({
        answerValue,
        explanation,
        resolutionDate,
      });
      setSaveState("saved");
      onSaved(result);
      window.setTimeout(() => setSaveState("idle"), 1400);
    },
    onError() {
      setSaveState("error");
    },
  });

  useEffect(() => {
    if (!answerValue) {
      return;
    }

    const snapshot = JSON.stringify({ answerValue, explanation, resolutionDate });
    if (snapshot === lastSubmitted.current) {
      return;
    }

    if (needsExplanation(answerValue) && !explanation.trim()) {
      // NOTE: For CCW we might store empty JSON like '{"restrictions":""}', which is trimmed to not empty, but it's okay to save.
      if (answerValue !== "CCW") return;
    }

    const timeout = window.setTimeout(() => {
      saveMutation.mutate();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [answerValue, explanation, resolutionDate]);

  const showExplanation = needsExplanation(answerValue);
  const showResolutionDate = answerValue === "NOT_TESTED" || answerValue === "NOT_IMPLEMENTED";
  const availableOptions = answerOptions.filter((option) => option.value !== "NOT_TESTED" || requirement.allowNotTested);

  return (
    <article className="requirement-card">
      <div className="requirement-header">
        <div>
          <div className="requirement-code-row">
            <strong className="requirement-code">{requirement.code}</strong>
            {requirement.isPreloaded ? <span className="soft-badge">Precargado</span> : null}
            {requirement.requiresEvidence ? <span className="soft-badge accent">Evidencia</span> : null}
          </div>
          <p className="requirement-text">{requirement.description}</p>
        </div>
        <span className={`save-state ${saveState}`}>
          {saveState === "idle" ? "Listo" : saveState === "saving" ? "Guardando" : saveState === "saved" ? "Guardado" : "Error"}
        </span>
      </div>

      {requirement.testingProcedures ? (
        <div className="testing-block">
          <p className="muted-label">Procedimientos de prueba</p>
          <p>{requirement.testingProcedures}</p>
        </div>
      ) : null}

      <div className="field-grid" style={{ marginTop: "16px" }}>
        <label className="field">
          <span>Respuesta</span>
          <select value={answerValue} onChange={(event) => setAnswerValue(event.target.value)}>
            <option value="">Selecciona una respuesta</option>
            {availableOptions.map((option) => (
               <option key={option.value} value={option.value}>
                 {option.label}
               </option>
            ))}
          </select>
        </label>
      </div>

      {showExplanation && answerValue === "CCW" ? (
        <div style={{ marginTop: "12px", display: "grid", gap: "10px", padding: "12px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)" }}>
          <p className="muted-label" style={{ marginBottom: "4px", color: "var(--blue-600)" }}>Anexo CCW: Ficha de Control Compensatorio</p>
          <label className="field">
            <span>1. Restricciones</span>
            <textarea rows={2} value={ccwData.restrictions} onChange={(e) => updateCcw("restrictions", e.target.value)} placeholder="Documente las limitaciones..."></textarea>
          </label>
          <label className="field">
            <span>2. Definición de los Controles Compensatorios</span>
            <textarea rows={2} value={ccwData.definition} onChange={(e) => updateCcw("definition", e.target.value)} placeholder="Defina los controles compensatorios..."></textarea>
          </label>
          <label className="field">
            <span>3. Objetivo</span>
            <textarea rows={2} value={ccwData.objective} onChange={(e) => updateCcw("objective", e.target.value)} placeholder="Defina el objetivo del control original..."></textarea>
          </label>
          <label className="field">
            <span>4. Riesgo Identificado</span>
            <textarea rows={2} value={ccwData.risk} onChange={(e) => updateCcw("risk", e.target.value)} placeholder="Identifique cualquier riesgo adicional..."></textarea>
          </label>
          <label className="field">
            <span>5. Validación de los Controles Compensatorios</span>
            <textarea rows={2} value={ccwData.validation} onChange={(e) => updateCcw("validation", e.target.value)} placeholder="Defina cómo se validaron..."></textarea>
          </label>
          <label className="field">
            <span>6. Mantenimiento</span>
            <textarea rows={2} value={ccwData.maintenance} onChange={(e) => updateCcw("maintenance", e.target.value)} placeholder="Defina los procesos y controles..."></textarea>
          </label>
        </div>
      ) : showExplanation ? (
        <div style={{ marginTop: "12px", display: "grid", gap: "4px" }}>
          <label className="field">
            <span>
              {answerValue === "NOT_APPLICABLE" ? "Justificacion de no aplicabilidad (Anexo C)" :
               "Explicacion (Anexo D)"}
            </span>
            <textarea
              rows={3}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              placeholder="Proporciona la justificacion requerida para integrarla al anexo correspondiente."
            />
          </label>
        </div>
      ) : null}

      {showResolutionDate ? (
        <div style={{ marginTop: "12px", display: "grid", gap: "4px" }}>
          {answerValue === "NOT_IMPLEMENTED" && <p className="muted-label" style={{ marginBottom: "2px", color: "var(--danger)" }}>Ver anexo No Implementado</p>}
          <label className="field">
            <span>
              {answerValue === "NOT_IMPLEMENTED" ? "Fecha compromiso para implementar los requisitos" : "Fecha de resolucion"}
            </span>
            <input type="date" value={resolutionDate} onChange={(event) => setResolutionDate(event.target.value)} />
          </label>
        </div>
      ) : null}

      {saveState === "error" ? <p className="error-text" style={{ marginTop: "8px" }}>El guardado automatico fallo. Revisa los campos e intenta de nuevo.</p> : null}
    </article>
  );
}
