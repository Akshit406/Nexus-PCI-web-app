ALTER TABLE "PciRequirement" ADD COLUMN "applicabilityNotes" TEXT;

ALTER TABLE "SaqRequirementMap" ADD COLUMN "titleOverride" TEXT;
ALTER TABLE "SaqRequirementMap" ADD COLUMN "descriptionOverride" TEXT;
ALTER TABLE "SaqRequirementMap" ADD COLUMN "testingProceduresOverride" TEXT;
ALTER TABLE "SaqRequirementMap" ADD COLUMN "applicabilityNotesOverride" TEXT;
ALTER TABLE "SaqRequirementMap" ADD COLUMN "topicTitleOverride" TEXT;
