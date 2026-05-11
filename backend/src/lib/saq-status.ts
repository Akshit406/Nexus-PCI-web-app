import { AnswerValue } from "@prisma/client";

export type SaqValidationStatus = "CONFORMING" | "NON_CONFORMING" | "LEGAL_EXCEPTION" | "PENDING";

export function getSaqValidationStatusText(status: SaqValidationStatus) {
  if (status === "CONFORMING") {
    return "Todas las secciones del PCI DSS SAQ estan completas y todos los requisitos estan marcados como: Implementado, Implementado con CCW, o No aplicable.";
  }

  if (status === "LEGAL_EXCEPTION") {
    return "Uno o mas de los requisitos evaluados en el PCI DSS SAQ estan marcados como No Implementado debido a una restriccion legal, por lo tanto, el SAQ esta conforme con una excepcion legal. Llene el siguiente recuadro donde especifique el requisito No Implementado y describa como la restriccion legal impide el cumplimiento del requisito.";
  }

  if (status === "NON_CONFORMING") {
    return "No se han completado todas las secciones del PCI DSS SAQ o uno o mas requisitos estan marcados como No Implementado, lo que resulta como una calificacion general de No Conformidad. En este caso se completa la Parte 4 del SAQ.";
  }

  return "El estado se calculara automaticamente cuando las partes del SAQ y los requisitos requeridos esten completos.";
}

export function getSaqValidationStatusLabel(status: SaqValidationStatus) {
  if (status === "CONFORMING") return "En Conformidad";
  if (status === "LEGAL_EXCEPTION") return "Conforme con excepcion legal";
  if (status === "NON_CONFORMING") return "No Conformidad";
  return "Pendiente";
}

export function calculateSaqValidationStatus(input: {
  mappedRequirementIds: string[];
  answers: Array<{ requirementId: string; answerValue: AnswerValue }>;
  hasLegalException: boolean;
}) {
  const answersByRequirement = new Map(input.answers.map((answer) => [answer.requirementId, answer.answerValue]));
  const allRequirementsAnswered =
    input.mappedRequirementIds.length > 0 &&
    input.mappedRequirementIds.every((requirementId) => Boolean(answersByRequirement.get(requirementId)));
  const hasNotImplemented = input.answers.some((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
  const allConforming =
    allRequirementsAnswered &&
    input.mappedRequirementIds.every((requirementId) => {
      const answerValue = answersByRequirement.get(requirementId);
      return (
        answerValue === AnswerValue.IMPLEMENTED ||
        answerValue === AnswerValue.CCW ||
        answerValue === AnswerValue.NOT_APPLICABLE
      );
    });

  if (allConforming) return "CONFORMING";
  if (hasNotImplemented && input.hasLegalException) return "LEGAL_EXCEPTION";
  if (!allRequirementsAnswered || hasNotImplemented) return "NON_CONFORMING";
  return "PENDING";
}
