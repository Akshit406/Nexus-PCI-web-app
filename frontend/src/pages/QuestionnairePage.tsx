import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { RequirementCard } from "../components/RequirementCard";
import { useSession } from "../context/session-context";
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

type LinkedPaymentChannel = {
  value: string;
  label: string;
};

type NotImplementedRequirement = {
  code: string;
  description: string;
};

function CaptureSectionBody({
  section,
  isLocked,
  finalAcknowledgementEnabled = true,
  linkedPaymentChannels = [],
  notImplementedRequirements = [],
}: {
  section: SaqCaptureSection;
  isLocked: boolean;
  finalAcknowledgementEnabled?: boolean;
  linkedPaymentChannels?: LinkedPaymentChannel[];
  notImplementedRequirements?: NotImplementedRequirement[];
}) {
  const { user } = useSession();
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
  const changeRequestMutation = useMutation({
    mutationFn: (reason: string) => api.post<{ success: boolean }>("/saq/change-request", { reason }),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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

  useEffect(() => {
    if (isLocked || section.id !== "part-2b-cardholder-function") {
      return;
    }

    setValues((current) => {
      const next = { ...current };
      let changed = false;
      for (let row = 1; row <= 3; row += 1) {
        const channel = linkedPaymentChannels[row - 1]?.label ?? "";
        const key = `card_function_${row}_channel`;
        if ((next[key] ?? "") !== channel) {
          next[key] = channel;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [isLocked, section.id, JSON.stringify(linkedPaymentChannels)]);

  useEffect(() => {
    if (isLocked || section.id !== "section-3-validation-certification") {
      return;
    }

    setValues((current) => {
      const next = { ...current };
      let changed = false;
      if (notImplementedRequirements.length === 0 && next.legal_exception_claimed !== "NO") {
        next.legal_exception_claimed = "NO";
        changed = true;
      }
      for (let row = 1; row <= 12; row += 1) {
        const requirement = notImplementedRequirements[row - 1];
        const key = `legal_exception_${row}_requirement`;
        const value = requirement ? `${requirement.code} - ${requirement.description}` : "";
        if ((next[key] ?? "") !== value) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [isLocked, section.id, JSON.stringify(notImplementedRequirements)]);

  const fieldByKey = new Map(section.fields.map((field) => [field.key, field]));
  const updateField = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  function renderField(field: SaqCaptureSection["fields"][number], options: { compact?: boolean } = {}) {
    const selectedValues = field.inputType === "checkbox-group" ? parseCheckboxValue(values[field.key] ?? "") : [];
    const fieldDisabled =
      isLocked ||
      (section.id === "section-3a-merchant-recognition" && !finalAcknowledgementEnabled) ||
      (section.id === "section-3-validation-certification" &&
        field.key.startsWith("legal_exception") &&
        notImplementedRequirements.length === 0);

    return (
      <label key={field.key} className={`field${field.inputType === "checkbox-group" ? " checkbox-field" : ""}${options.compact ? " compact-field" : ""}`}>
        <span>
          {field.label}
          {!field.required ? <em>Opcional</em> : null}
        </span>
        {field.inputType === "textarea" ? (
          <textarea
            rows={options.compact ? 2 : 4}
            value={values[field.key] ?? ""}
            onChange={(event) => updateField(field.key, event.target.value)}
            placeholder={field.placeholder}
            disabled={fieldDisabled}
          />
        ) : field.inputType === "select" ? (
          <select value={values[field.key] ?? ""} onChange={(event) => updateField(field.key, event.target.value)} disabled={fieldDisabled}>
            <option value="">{field.placeholder}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.inputType === "radio-group" ? (
          <div className="checkbox-group radio-group" role="radiogroup" aria-label={field.label}>
            {field.options.map((option) => (
              <span key={option.value} className="checkbox-option">
                <input
                  type="radio"
                  name={`${section.id}-${field.key}`}
                  checked={(values[field.key] ?? "") === option.value}
                  disabled={fieldDisabled}
                  onChange={() => updateField(field.key, option.value)}
                />
                <span>{option.label}</span>
              </span>
            ))}
          </div>
        ) : field.inputType === "checkbox-group" ? (
          <div className="checkbox-group" role="group" aria-label={field.label}>
            {field.options.map((option) => {
              const isChecked = selectedValues.includes(option.value);

              return (
                <span key={option.value} className="checkbox-option">
                  <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={fieldDisabled}
                    onChange={(event) => {
                      const nextValues = event.target.checked
                        ? [...selectedValues, option.value]
                        : selectedValues.filter((value) => value !== option.value);
                      updateField(field.key, stringifyCheckboxValue(nextValues));
                    }}
                  />
                  <span>{option.label}</span>
                </span>
              );
            })}
          </div>
        ) : (
          <input
            type={field.inputType === "number" || field.inputType === "date" ? field.inputType : "text"}
            value={values[field.key] ?? ""}
            onChange={(event) => updateField(field.key, event.target.value)}
            placeholder={field.placeholder}
            disabled={fieldDisabled}
          />
        )}
      </label>
    );
  }

  function requireField(key: string) {
    const field = fieldByKey.get(key);
    if (!field) {
      throw new Error(`Missing capture field ${key}`);
    }
    return field;
  }

  function renderOfficialSectionFields() {
    if (section.id === "part-2a-payment-channels") {
      return (
        <div className="official-saq-block">
          {renderField(requireField("included_payment_channels"))}
          <div className="official-question-row">
            {renderField(requireField("has_excluded_payment_channels"))}
            {renderField(requireField("excluded_payment_channels_explanation"))}
          </div>
          <p className="official-note">
            Nota: Si el comerciante tiene un canal de pago no cubierto por esta SAQ, consulte con la entidad a la que se presentara esta AOC acerca de la validacion para los otros canales.
          </p>
        </div>
      );
    }

    if (section.id === "part-2b-cardholder-function") {
      return (
        <div className="official-table-wrap">
          <table className="official-capture-table two-column">
            <thead>
              <tr>
                <th>Canal</th>
                <th>Como la Empresa Almacena, Procesa y/o Transmite los Datos del Titular de la Tarjeta</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((row) => (
                <tr key={row}>
                  <td>
                    <div className="readonly-table-value">
                      {values[`card_function_${row}_channel`] || linkedPaymentChannels[row - 1]?.label || "Selecciona el canal en la Parte 2a"}
                    </div>
                  </td>
                  <td>{renderField(requireField(`card_function_${row}_description`), { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (section.id === "part-2d-scope-facilities") {
      return (
        <div className="official-table-wrap">
          <table className="official-capture-table facilities-table">
            <thead>
              <tr>
                <th>Tipo de Instalacion</th>
                <th>Numero total de Instalaciones</th>
                <th>Ubicacion(es) de las Instalaciones</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((row) => (
                <tr key={row}>
                  <td>{renderField(requireField(`facility_${row}_type`), { compact: true })}</td>
                  <td>{renderField(requireField(`facility_${row}_count`), { compact: true })}</td>
                  <td>{renderField(requireField(`facility_${row}_locations`), { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (section.id === "part-2e-validated-products") {
      return (
        <div className="official-saq-block">
          {renderField(requireField("uses_pci_validated_products"))}
          <p className="official-note">Provea la siguiente informacion sobre cada elemento que el comerciante utiliza de las Listas de Productos y Soluciones Validados por PCI SSC.</p>
          <div className="official-table-wrap">
            <table className="official-capture-table products-table">
              <thead>
                <tr>
                  <th>Nombre del Producto o Solucion validado por PCI SSC</th>
                  <th>Version</th>
                  <th>Estandar PCI SSC</th>
                  <th>Numero de Referencia</th>
                  <th>Fecha de Expiracion</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4].map((row) => (
                  <tr key={row}>
                    <td>{renderField(requireField(`validated_product_${row}_name`), { compact: true })}</td>
                    <td>{renderField(requireField(`validated_product_${row}_version`), { compact: true })}</td>
                    <td>{renderField(requireField(`validated_product_${row}_standard`), { compact: true })}</td>
                    <td>{renderField(requireField(`validated_product_${row}_reference`), { compact: true })}</td>
                    <td>{renderField(requireField(`validated_product_${row}_expiration`), { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (section.id === "part-2f-service-providers") {
      return (
        <div className="official-saq-block">
          {renderField(requireField("providers_store_process_transmit"))}
          {renderField(requireField("providers_manage_system_components"))}
          {renderField(requireField("providers_affect_cde_security"))}
          <p className="official-note">En caso afirmativo, capture nombre del proveedor de servicio y descripcion del servicio prestado.</p>
          <div className="official-table-wrap">
            <table className="official-capture-table two-column">
              <thead>
                <tr>
                  <th>Nombre del proveedor de servicio</th>
                  <th>Descripcion del servicio prestado</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => (
                  <tr key={row}>
                    <td>{renderField(requireField(`service_provider_${row}_name`), { compact: true })}</td>
                    <td>{renderField(requireField(`service_provider_${row}_description`), { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="official-note">Nota: El Requisito 12.8 aplica a todas las entidades que aparecen en la lista.</p>
        </div>
      );
    }

    if (section.id === "part-2h-saq-eligibility") {
      const eligibilityField = requireField("eligibility_confirmations");
      const selected = parseCheckboxValue(values.eligibility_confirmations ?? eligibilityField.value);
      const allSelected = selected.length >= eligibilityField.options.length;
      const reason = values.eligibility_change_notes?.trim() || "El cliente indica que los criterios de elegibilidad del SAQ asignado requieren revision.";

      return (
        <div className="official-saq-block">
          {renderField(eligibilityField)}
          {!allSelected ? (
            <div className="eligibility-warning">
              <strong>Esto puede indicar que el SAQ asignado no corresponde.</strong>
              <p>Agrega una nota y solicita revision a tu ejecutivo.</p>
            </div>
          ) : null}
          {renderField(requireField("eligibility_change_notes"))}
          <button
            type="button"
            className="ghost-button"
            disabled={isLocked || changeRequestMutation.isPending}
            onClick={() => changeRequestMutation.mutate(reason)}
          >
            {changeRequestMutation.isPending ? "Solicitando..." : "Solicitar cambio de SAQ"}
          </button>
          {changeRequestMutation.isSuccess ? <p className="info-text">Solicitud enviada al ejecutivo.</p> : null}
        </div>
      );
    }

    if (section.id === "section-3-validation-certification") {
      const legalExceptionClaimed = values.legal_exception_claimed === "YES";
      return (
        <div className="official-saq-block">
          <p className="official-note">
            El estado final se calcula automaticamente segun las respuestas del cuestionario. Si existe No Implementado, el estado base es No Conformidad.
          </p>
          {notImplementedRequirements.length === 0 ? (
            <div className="auto-section-empty">
              No hay requisitos marcados como No Implementado. La excepcion legal no aplica.
            </div>
          ) : (
            <div className="eligibility-warning">
              <strong>Existen requisitos No Implementado.</strong>
              <p>Solo selecciona excepcion legal si una restriccion legal impide cumplir esos requisitos.</p>
            </div>
          )}
          {renderField(requireField("legal_exception_claimed"))}
          {legalExceptionClaimed ? (
            <div className="official-table-wrap">
              <table className="official-capture-table legal-exception-table">
                <thead>
                  <tr>
                    <th>Requisito Concerniente</th>
                    <th>Detalles de como la restriccion legal impide que se cumpla con el requisito</th>
                  </tr>
                </thead>
                <tbody>
                  {notImplementedRequirements.slice(0, 12).map((requirement, index) => {
                    const row = index + 1;
                    return (
                      <tr key={requirement.code}>
                        <td>
                          <div className="readonly-table-value">
                            {values[`legal_exception_${row}_requirement`] || `${requirement.code} - ${requirement.description}`}
                          </div>
                        </td>
                        <td>{renderField(requireField(`legal_exception_${row}_restriction`), { compact: true })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      );
    }

    if (section.id === "section-3a-merchant-recognition") {
      const today = new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "short", day: "numeric" }).format(new Date());
      return (
        <div className="official-saq-block">
          <div className="auto-section-summary">
            <div>
              <dt>Nombre tomado del sistema</dt>
              <dd>{user ? `${user.firstName} ${user.lastName}` : "Usuario cliente"}</dd>
            </div>
            <div>
              <dt>Fecha de reconocimiento</dt>
              <dd>{today}</dd>
            </div>
            <div>
              <dt>Firma</dt>
              <dd>Se utiliza la firma capturada previamente.</dd>
            </div>
          </div>
          {!finalAcknowledgementEnabled ? (
            <div className="eligibility-warning">
              <strong>Reconocimiento pendiente de habilitar</strong>
              <p>Esta parte se activa cuando el cuestionario esta completo, existe firma capturada y el pago esta marcado como pagado.</p>
            </div>
          ) : null}
          {renderField(requireField("merchant_acknowledgements"))}
        </div>
      );
    }

    return section.fields.map((field) => renderField(field));
  }

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

      {renderOfficialSectionFields()}

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

    setOpenPartId(saqQuery.data.sectionPlan.find((section) => section.id !== "part-2g-assessment-summary")?.id ?? "");
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
  const finalAcknowledgementEnabled =
    answeredCount === totalRequirements &&
    saqQuery.data.certification.hasSignature &&
    saqQuery.data.certification.paymentState === "PAID";

  const paymentChannelSection = captureSectionsById.get("part-2a-payment-channels");
  const paymentChannelField = paymentChannelSection?.fields.find((field) => field.key === "included_payment_channels");
  const selectedPaymentChannelValues = parseCheckboxValue(paymentChannelField?.value ?? "");
  const linkedPaymentChannels =
    paymentChannelField?.options.filter((option) => selectedPaymentChannelValues.includes(option.value)) ?? [];
  const notImplementedRequirements = saqQuery.data.topics.flatMap((topic) =>
    topic.requirements
      .filter((requirement) => requirement.answerValue === "NOT_IMPLEMENTED")
      .map((requirement) => ({ code: requirement.code, description: requirement.description })),
  );
  const visibleSectionPlan = saqQuery.data.sectionPlan.filter((section) => section.id !== "part-2g-assessment-summary");

  const saqParts = visibleSectionPlan.map((section) => {
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

  const saqData = saqQuery.data;

  function renderQuestionnaireFlow() {
    return (
      <div className="questionnaire-content-grid embedded" ref={requirementsAnchorRef}>
        <aside className="questionnaire-sidebar">
          <div className="panel compact topic-summary-panel">
            <p className="muted-label">Seccion 2</p>
            <h3>Cuestionario de Autoevaluacion</h3>
            <p className="subtle-text">
              {answeredCount} de {totalRequirements} requisitos respondidos
            </p>
            <div className="progress-bar" style={{ marginTop: "8px" }}>
              <span style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="topic-nav">
            {saqData.topics.map((topic) => {
              const answered = topic.requirements.filter((requirement) => Boolean(requirement.answerValue)).length;
              const percentage = topic.requirements.length ? Math.round((answered / topic.requirements.length) * 100) : 0;

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
                <p className="muted-label">Requisito actual</p>
                <h2>{activeTopic?.topicName}</h2>
              </div>
              <div className="questionnaire-meta">
                <span className="soft-badge">
                  {PAYMENT_ES[saqData.certification.paymentState] || saqData.certification.paymentState}
                </span>
                <span className="soft-badge">
                  {saqData.certification.isLocked ? "Bloqueado" : "Editable"}
                </span>
              </div>
            </div>
            <p className="subtle-text" style={{ marginTop: "8px" }}>
              Las respuestas actualizan automaticamente el Resumen Ejecutivo, Anexos y Seccion 3 del SAQ.
            </p>
          </div>

          <div className="requirements-stack">
            {activeTopic?.requirements.map((requirement) => (
              <RequirementCard
                key={requirement.id}
                requirement={requirement}
                activeTopicCode={activeTopic.topicCode}
                isLocked={saqData.certification.isLocked}
                onSaved={(nextRequirement) => replaceRequirement(activeTopic.topicCode, requirement.id, nextRequirement)}
              />
            ))}
          </div>

          <div className="topic-stepper">
            <button
              type="button"
              className="ghost-button"
              disabled={activeTopicIndex <= 0}
              onClick={() => goToTopic(saqData.topics[activeTopicIndex - 1]?.topicCode)}
            >
              Tema anterior
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={activeTopicIndex < 0 || activeTopicIndex >= saqData.topics.length - 1}
              onClick={() => goToTopic(saqData.topics[activeTopicIndex + 1]?.topicCode)}
            >
              Guardar y continuar
            </button>
          </div>
        </section>
      </div>
    );
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

          <div className="saq-document-shell">
            <nav className="saq-document-nav" aria-label="Flujo del SAQ">
              {saqParts.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  className={openPartId === part.id ? "active" : ""}
                  onClick={() => setOpenPartId(part.id)}
                >
                  <span>{part.displayOrder}</span>
                  {part.title}
                </button>
              ))}
            </nav>

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
                          <p>{part.details}</p>
                        </div>
                      </div>
                      <ChevronDown aria-hidden="true" />
                    </button>

                    {isOpen ? (
                      <div className="saq-part-body">
                        {part.autoSection ? <AutoSectionBody section={part.autoSection} /> : null}
                        {part.captureSection ? (
                          <CaptureSectionBody
                            section={part.captureSection}
                            isLocked={saqQuery.data.certification.isLocked}
                            finalAcknowledgementEnabled={finalAcknowledgementEnabled}
                            linkedPaymentChannels={linkedPaymentChannels}
                            notImplementedRequirements={notImplementedRequirements}
                          />
                        ) : part.kind === "questionnaire" ? (
                          renderQuestionnaireFlow()
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
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

      </section>
    </div>
  );
}
