import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AdminSaqEvidenceResponse, AdminSaqEvidenceType } from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AdminSaqEvidencePage() {
  const queryClient = useQueryClient();
  const [selectedSaqId, setSelectedSaqId] = useState("");
  const [error, setError] = useState("");

  const saqEvidenceQuery = useQuery({
    queryKey: ["admin-saq-evidence-requirements"],
    queryFn: () => api.get<AdminSaqEvidenceResponse>("/admin/saq/evidence-requirements"),
  });

  const selectedSaq = useMemo<AdminSaqEvidenceType | null>(() => {
    const items = saqEvidenceQuery.data?.items ?? [];
    return items.find((item) => item.id === selectedSaqId) ?? items[0] ?? null;
  }, [saqEvidenceQuery.data, selectedSaqId]);

  const updateMutation = useMutation({
    mutationFn: ({ mappingId, requiresEvidence }: { mappingId: string; requiresEvidence: boolean }) =>
      api.patch<{ id: string; requiresEvidence: boolean }>(`/admin/saq/evidence-requirements/${mappingId}`, {
        requiresEvidence,
      }),
    onSuccess() {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-saq-evidence-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["saq-current"] });
    },
    onError(error) {
      setError(error instanceof Error ? error.message : "No fue posible actualizar el requisito.");
    },
  });

  if (saqEvidenceQuery.isLoading) {
    return <div className="loading-panel">Cargando configuracion de SAQ...</div>;
  }

  if (saqEvidenceQuery.isError || !saqEvidenceQuery.data) {
    return (
      <div className="error-panel">
        No fue posible cargar la configuracion de evidencia. {getErrorMessage(saqEvidenceQuery.error, "Revisa la sesion, permisos de administrador o datos SAQ cargados.")}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administracion SAQ</p>
          <h1>Evidencia obligatoria por requisito</h1>
          <p className="page-subtitle">
            Define que requisitos del SAQ deben bloquear la generacion cuando no tengan evidencia cargada.
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
          <div className="outputs-list-stack" style={{ marginTop: "18px" }}>
            {selectedSaq.mappings.map((mapping) => (
              <article key={mapping.id} className="mini-card document-list-item">
                <div className="document-list-copy">
                  <strong>
                    {mapping.requirementCode} - {mapping.title}
                  </strong>
                  <p className="subtle-text">
                    Requisito {mapping.topicCode}: {mapping.topicName}
                  </p>
                </div>
                <label className="checkbox-option" style={{ flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={mapping.requiresEvidence}
                    disabled={updateMutation.isPending}
                    onChange={(event) =>
                      updateMutation.mutate({
                        mappingId: mapping.id,
                        requiresEvidence: event.target.checked,
                      })
                    }
                  />
                  <span>Evidencia obligatoria</span>
                </label>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
