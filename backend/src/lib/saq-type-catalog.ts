import { Prisma } from "@prisma/client";

// These codes remain supported for historical certifications, but each points
// to the same official documents and questionnaire as its canonical code.
export const HIDDEN_LEGACY_SAQ_TYPE_CODES = ["D_P2PE", "SPoC"] as const;

export const selectableSaqTypeWhere = {
  isActive: true,
  code: { notIn: [...HIDDEN_LEGACY_SAQ_TYPE_CODES] },
} satisfies Prisma.SaqTypeWhereInput;
