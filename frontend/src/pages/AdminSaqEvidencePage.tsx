import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  AdminAvailableRequirementItem,
  AdminPciRequirementItem,
  AdminPciTopic,
  AdminSaqEvidenceRequirement,
  AdminSaqEvidenceResponse,
  AdminSaqEvidenceType,
} from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type RequirementEditDraft = {
  id: string;
  requirementCode: string;
  title: string;
  description: string;
  testingProcedures: string;
  topicCode: string;
};

type NewRequirementDraft = {
  requirementCode: string;
  topicCode: string;
  title: string;
  description: string;
  testingProcedures: string;
  requirementVersion: string;
};

const emptyNewRequirement: NewRequirementDraft = {
  requirementCode: "",
  topicCode: "",
  title: "",
  description: "",
  testingProcedures: "",
  requirementVersion: "",
};

export function AdminSaqEvidencePage() {
  const queryClient = useQueryClient();
  const [selectedSaqId, setSelectedSaqId] = useState("");
  const [error, setError] = useState("");
  const [editingDraft, setEditingDraft] = useState<RequirementEditDraft | null>(null);
  const [newRequirement, setNewRequirement] = useState<NewRequirementDraft>(emptyNewRequirement);
  const [attachSearch, setAttachSearch] = useState("");
  const [creatingRequirement, setCreatingRequirement] = useState(false);

  const saqEvidenceQuery = useQuery({
    queryKey: ["admin-saq-evidence-requirements"],
    queryFn: () => api.get<AdminSaqEvidenceResponse>("/admin/saq/evidence-requirements"),
  });

  const topicsQuery = useQuery({
    queryKey: ["admin-pci-topics"],
    queryFn: () => api.get<{ items: AdminPciTopic[] }>("/admin/saq/topics"),
  });

  const selectedSaq = useMemo<AdminSaqEvidenceType | null>(() => {
    const items = saqEvidenceQuery.data?.items ?? [];
    return items.find((item) => item.id === selectedSaqId) ?? items[0] ?? null;
  }, [saqEvidenceQuery.data, selectedSaqId]);

  const availableRequirementsQuery = useQuery({
    queryKey: ["admin-saq-available-requirements", selectedSaq?.id, attachSearch],
    queryFn: () => {
      if (!selectedSaq) return Promise.resolve({ items: [] });
      const params = new URLSearchParams();
      if (attachSearch.trim()) params.set("search", attachSearch.trim());
      return api.get<{ items: AdminAvailableRequirementItem[] }>(
        `/admin/saq/types/${selectedSaq.id}/available-requirements${params.toString() ? `?${params.toString()}` : ""}`,
      );
    },
    enabled: Boolean(selectedSaq),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["admin-saq-evidence-requirements"] });
    queryClient.invalidateQueries({ queryKey: ["admin-saq-available-requirements"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["saq-current"] });
  }

  const flagsMutation = useMutation({
    mutationFn: ({
      mappingId,
      payload,
    }: {
      mappingId: string;
      payload: Partial<
        Pick<
          AdminSaqEvidenceRequirement,
          "requiresEvidence" | "requiresCcwJustification" | "requiresNaJustification" | "allowNotTested"
        >
      >;
    }) => api.patch<{ id: string }>(`/admin/saq/mappings/${mappingId}`, payload),
    onSuccess() {
      setError("");
      invalidateAll();
    },
    onError(err) {
      setError(getErrorMessage(err, "No fue posible actualizar el mapping."));
    },
  });

  const detachMutation = useMutation({
    mutationFn: (mappingId: string) => api.delete<{ success: boolean }>(`/admin/saq/mappings/${mappingId}`),
    onSuccess() {
      setError("");
      invalidateAll();
    },
    onError(err) {
      setError(getErrorMessage(err, "No fue posible quitar el requisito del SAQ."));
    },
  });

  const attachMutation = useMutation({
    mutationFn: ({ saqTypeId, requirementId }: { saqTypeId: string; requirementId: string }) =>
      api.post<{ id: string }>(`/admin/saq/types/${saqTypeId}/mappings`, { requirementId }),
    onSuccess() {
      setError("");
      setAttachSearch("");
      invalidateAll();
    },
    onError(err) {
      setError(getErrorMessage(err, "No fue posible agregar el requisito al SAQ."));
    },
  });

  const updateRequirementMutation = useMutation({
    mutationFn: ({ requirementId, payload }: { requirementId: string; payload: Partial<RequirementEditDraft> }) =>
      api.patch<AdminPciRequirementItem>(`/admin/saq/requirements/${requirementId}`, payload),
    onSuccess() {
      setError("");
      setEditingDraft(null);
      invalidateAll();
    },
    onError(err) {
      setError(getErrorMessage(err, "No fue posible actualizar el requisito."));
    },
  });

  const createRequirementMutation = useMutation({
    mutationFn: (payload: NewRequirementDraft) =>
      api.post<AdminPciRequirementItem>("/admin/saq/requirements", {
        ...payload,
        testingProcedures: payload.testingProcedures || null,
        requirementVersion: payload.requirementVersion || null,
      }),
    onSuccess(created) {
      setError("");
      setCreatingRequirement(false);
      setNewRequirement(emptyNewRequirement);
      // Auto-attach the new requirement to the currently selected SAQ.
      if (selectedSaq) {
        attachMutation.mutate({ saqTypeId: selectedSaq.id, requirementId: created.id });
      } else {
        invalidateAll();
      }
    },
    onError(err) {
      setError(getErrorMessage(err, "No fue posible crear el requisito."));
    },
  });

  if (saqEvidenceQuery.isLoading) {
    return <div className="loading-panel">Cargando configuracion de SAQ...</div>;
  }

  if (saqEvidenceQuery.isError || !saqEvidenceQuery.data) {
    return (
      <div className="error-panel">
        No fue posible cargar la configuracion de SAQ. {getErrorMessage(saqEvidenceQuery.error, "Revisa la sesion, permisos de administrador o datos SAQ cargados.")}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administracion SAQ</p>
          <h1>Requisitos PCI y mapeo por SAQ</h1>
          <p className="page-subtitle">
            Actualiza la redaccion de los requisitos publicados por el PCI SSC y administra
            que requisitos forman parte de cada tipo de SAQ. Los cambios quedan registrados en
            la bitacora de auditoria.
          </p>
        </div>
      </section>

      <section className="single-page-card wide placeholder-card">
        <div className="field-grid">
          <label className="field">
            <span>Tipo de SAQ</span>
            <select value={selectedSaq?.id ?? ""} onChange={(event) => setSelectedSaqId(event.target.value)}>
              {saqEvidenceQuery.data.items.map((saqType) => (
                <option key={saqType.id} value={saqType.id}>
                  {saqType.name} {saqType.templateVersion ? `- ${saqType.templateVersion}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {selectedSaq ? (
          <>
            <div
              className="panel-header"
              style={{ marginTop: "18px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}
            >
              <div>
                <p className="brand-eyebrow">Agregar requisitos</p>
                <h3 className="compact-heading">Mapeo del SAQ {selectedSaq.code}</h3>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setCreatingRequirement((value) => !value);
                    setNewRequirement(emptyNewRequirement);
                  }}
                >
                  {creatingRequirement ? "Cancelar nuevo requisito" : "Crear requisito nuevo"}
                </button>
              </div>
            </div>

            {creatingRequirement ? (
              <div
                className="warning-panel"
                style={{ background: "#f8fafc", borderColor: "var(--border)", color: "inherit" }}
              >
                <p className="subtle-text" style={{ marginTop: 0 }}>
                  Crea un requisito nuevo (cuando el PCI SSC publica una version nueva del estandar).
                  Se asignara automaticamente al SAQ {selectedSaq.code} despues de crearlo.
                </p>
                <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  <label className="field">
                    <span>Codigo de requisito</span>
                    <input
                      type="text"
                      value={newRequirement.requirementCode}
                      onChange={(event) =>
                        setNewRequirement((draft) => ({ ...draft, requirementCode: event.target.value }))
                      }
                      placeholder="Ej. 12.10.7"
                    />
                  </label>
                  <label className="field">
                    <span>Topico PCI</span>
                    <select
                      value={newRequirement.topicCode}
                      onChange={(event) =>
                        setNewRequirement((draft) => ({ ...draft, topicCode: event.target.value }))
                      }
                    >
                      <option value="">Selecciona topico...</option>
                      {(topicsQuery.data?.items ?? []).map((topic) => (
                        <option key={topic.code} value={topic.code}>
                          {topic.code} - {topic.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Titulo (resumen)</span>
                    <input
                      type="text"
                      value={newRequirement.title}
                      onChange={(event) =>
                        setNewRequirement((draft) => ({ ...draft, title: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Descripcion completa del requisito</span>
                    <textarea
                      rows={4}
                      value={newRequirement.description}
                      onChange={(event) =>
                        setNewRequirement((draft) => ({ ...draft, description: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Procedimientos de prueba (opcional)</span>
                    <textarea
                      rows={3}
                      value={newRequirement.testingProcedures}
                      onChange={(event) =>
                        setNewRequirement((draft) => ({ ...draft, testingProcedures: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Version PCI DSS (opcional)</span>
                    <input
                      type="text"
                      value={newRequirement.requirementVersion}
                      onChange={(event) =>
                        setNewRequirement((draft) => ({ ...draft, requirementVersion: event.target.value }))
                      }
                      placeholder="Ej. 4.0.1"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  style={{ marginTop: "12px" }}
                  disabled={
                    createRequirementMutation.isPending ||
                    !newRequirement.requirementCode.trim() ||
                    !newRequirement.topicCode ||
                    !newRequirement.title.trim() ||
                    !newRequirement.description.trim()
                  }
                  onClick={() => createRequirementMutation.mutate(newRequirement)}
                >
                  {createRequirementMutation.isPending ? "Creando..." : "Crear y agregar al SAQ"}
                </button>
              </div>
            ) : null}

            <div className="field-grid" style={{ gridTemplateColumns: "2fr 1fr", marginTop: "12px" }}>
              <label className="field">
                <span>Buscar requisito ya existente para agregar al SAQ</span>
                <input
                  type="text"
                  placeholder="Codigo (12.8.7), titulo o descripcion..."
                  value={attachSearch}
                  onChange={(event) => setAttachSearch(event.target.value)}
                />
              </label>
              <div style={{ alignSelf: "end" }}>
                <span className="soft-badge">
                  {availableRequirementsQuery.data?.items.length ?? 0} disponible(s)
                </span>
              </div>
            </div>

            {attachSearch.trim().length > 0 && availableRequirementsQuery.data ? (
              <div className="outputs-list-stack" style={{ marginBottom: "16px" }}>
                {availableRequirementsQuery.data.items.length === 0 ? (
                  <p className="subtle-text">Sin coincidencias para agregar.</p>
                ) : (
                  availableRequirementsQuery.data.items.slice(0, 15).map((available) => (
                    <article key={available.id} className="mini-card document-list-item">
                      <div className="document-list-copy">
                        <strong>{available.requirementCode} - {available.title}</strong>
                        <p className="subtle-text">{available.topicCode}: {available.topicName}</p>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={attachMutation.isPending}
                        onClick={() =>
                          attachMutation.mutate({
                            saqTypeId: selectedSaq.id,
                            requirementId: available.id,
                          })
                        }
                      >
                        Agregar al SAQ
                      </button>
                    </article>
                  ))
                )}
              </div>
            ) : null}

            <div className="outputs-list-stack" style={{ marginTop: "18px" }}>
              <p className="subtle-text" style={{ marginBottom: 0 }}>
                {selectedSaq.mappings.length} requisito(s) activos en SAQ {selectedSaq.code}.
                Click en "Editar" para actualizar la redaccion oficial o ajustar las casillas de
                obligatoriedad.
              </p>
              {selectedSaq.mappings.map((mapping) => {
                const isEditing = editingDraft?.id === mapping.requirementId;
                return (
                  <article key={mapping.id} className="mini-card document-list-item" style={{ flexDirection: "column" }}>
                    <div className="document-list-item" style={{ width: "100%", alignItems: "flex-start" }}>
                      <div className="document-list-copy">
                        <strong>
                          {mapping.requirementCode} - {mapping.title}
                        </strong>
                        <p className="subtle-text">
                          Topico {mapping.topicCode}: {mapping.topicName} - Orden {mapping.displayOrder}
                        </p>
                        <p className="subtle-text" style={{ whiteSpace: "pre-wrap" }}>
                          {mapping.description.slice(0, 240)}
                          {mapping.description.length > 240 ? "..." : ""}
                        </p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            setEditingDraft(
                              isEditing
                                ? null
                                : {
                                    id: mapping.requirementId,
                                    requirementCode: mapping.requirementCode,
                                    title: mapping.title,
                                    description: mapping.description,
                                    testingProcedures: mapping.testingProcedures ?? "",
                                    topicCode: mapping.topicCode,
                                  },
                            )
                          }
                        >
                          {isEditing ? "Cancelar" : "Editar texto"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          style={{ color: "var(--warning)", borderColor: "var(--warning)" }}
                          disabled={detachMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Quitar el requisito ${mapping.requirementCode} del SAQ ${selectedSaq.code}? El requisito seguira existiendo en el catalogo y podra volver a agregarse.`,
                              )
                            ) {
                              detachMutation.mutate(mapping.id);
                            }
                          }}
                        >
                          Quitar del SAQ
                        </button>
                      </div>
                    </div>

                    <div
                      className="field-grid"
                      style={{
                        width: "100%",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        marginTop: "10px",
                      }}
                    >
                      <label className="checkbox-option">
                        <input
                          type="checkbox"
                          checked={mapping.requiresEvidence}
                          disabled={flagsMutation.isPending}
                          onChange={(event) =>
                            flagsMutation.mutate({
                              mappingId: mapping.id,
                              payload: { requiresEvidence: event.target.checked },
                            })
                          }
                        />
                        <span>Evidencia obligatoria</span>
                      </label>
                      <label className="checkbox-option">
                        <input
                          type="checkbox"
                          checked={mapping.requiresCcwJustification}
                          disabled={flagsMutation.isPending}
                          onChange={(event) =>
                            flagsMutation.mutate({
                              mappingId: mapping.id,
                              payload: { requiresCcwJustification: event.target.checked },
                            })
                          }
                        />
                        <span>Pedir ficha CCW</span>
                      </label>
                      <label className="checkbox-option">
                        <input
                          type="checkbox"
                          checked={mapping.requiresNaJustification}
                          disabled={flagsMutation.isPending}
                          onChange={(event) =>
                            flagsMutation.mutate({
                              mappingId: mapping.id,
                              payload: { requiresNaJustification: event.target.checked },
                            })
                          }
                        />
                        <span>Pedir justificacion N/A</span>
                      </label>
                      <label className="checkbox-option">
                        <input
                          type="checkbox"
                          checked={mapping.allowNotTested}
                          disabled={flagsMutation.isPending}
                          onChange={(event) =>
                            flagsMutation.mutate({
                              mappingId: mapping.id,
                              payload: { allowNotTested: event.target.checked },
                            })
                          }
                        />
                        <span>Permitir "No probado"</span>
                      </label>
                    </div>

                    {isEditing && editingDraft ? (
                      <div
                        className="field-grid"
                        style={{
                          width: "100%",
                          gridTemplateColumns: "1fr",
                          marginTop: "10px",
                          borderTop: "1px solid var(--border)",
                          paddingTop: "10px",
                        }}
                      >
                        <label className="field">
                          <span>Titulo (resumen)</span>
                          <input
                            type="text"
                            value={editingDraft.title}
                            onChange={(event) =>
                              setEditingDraft((draft) => (draft ? { ...draft, title: event.target.value } : draft))
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Descripcion oficial</span>
                          <textarea
                            rows={6}
                            value={editingDraft.description}
                            onChange={(event) =>
                              setEditingDraft((draft) =>
                                draft ? { ...draft, description: event.target.value } : draft,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Procedimientos de prueba</span>
                          <textarea
                            rows={4}
                            value={editingDraft.testingProcedures}
                            onChange={(event) =>
                              setEditingDraft((draft) =>
                                draft ? { ...draft, testingProcedures: event.target.value } : draft,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Topico PCI</span>
                          <select
                            value={editingDraft.topicCode}
                            onChange={(event) =>
                              setEditingDraft((draft) =>
                                draft ? { ...draft, topicCode: event.target.value } : draft,
                              )
                            }
                          >
                            {(topicsQuery.data?.items ?? []).map((topic) => (
                              <option key={topic.code} value={topic.code}>
                                {topic.code} - {topic.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={updateRequirementMutation.isPending}
                            onClick={() =>
                              updateRequirementMutation.mutate({
                                requirementId: editingDraft.id,
                                payload: {
                                  title: editingDraft.title,
                                  description: editingDraft.description,
                                  testingProcedures: editingDraft.testingProcedures,
                                  topicCode: editingDraft.topicCode,
                                },
                              })
                            }
                          >
                            {updateRequirementMutation.isPending ? "Guardando..." : "Guardar cambios del requisito"}
                          </button>
                          <button type="button" className="ghost-button" onClick={() => setEditingDraft(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
