import {
  CLIENT_JOURNEY_STAGE_SEED,
  normalizeStageCode,
  PAYMENT_STAGE_SEED,
  STAGE_KINDS,
  STAGE_PIPELINE_CODES,
  STAGE_PIPELINE_LABELS,
  VISA_CASE_MACRO_STAGE_SEED,
  VISA_CASE_SUB_STATUS_SEED,
  type StagePipelineCode,
} from "../constants/stage.constants";
import { StageError } from "../errors/stage.errors";
import {
  countChildStages,
  createStageDefinition,
  deleteStageDefinition,
  getStageDefinitionById,
  getStageDefinitionByPipelineAndCode,
  getStagePipelineByCode,
  listStageDefinitions,
  listStagePipelines,
  updateStageDefinition,
  type CreateStageInput,
  type StageDefinitionRow,
  type StageListFilters,
  type UpdateStageInput,
} from "../models/stage.model";

export type StageWithChildren = StageDefinitionRow & {
  subStatuses: StageDefinitionRow[];
};

const assertPipelineCode = (value: string): StagePipelineCode => {
  const normalized = value.trim().toUpperCase();
  if (!(STAGE_PIPELINE_CODES as readonly string[]).includes(normalized)) {
    throw new StageError(
      `Invalid pipeline. Allowed: ${STAGE_PIPELINE_CODES.join(", ")}`
    );
  }
  return normalized as StagePipelineCode;
};

const assertStageKind = (value?: string) => {
  if (!value) return;
  if (!(STAGE_KINDS as readonly string[]).includes(value)) {
    throw new StageError(`Invalid kind. Allowed: ${STAGE_KINDS.join(", ")}`);
  }
};

const validateCreateInput = async (input: CreateStageInput) => {
  const pipelineCode = assertPipelineCode(input.pipelineCode);
  const code = normalizeStageCode(input.code);

  if (!code) {
    throw new StageError("Stage code is required");
  }

  if (!input.label?.trim()) {
    throw new StageError("Stage label is required");
  }

  assertStageKind(input.kind);

  const existing = await getStageDefinitionByPipelineAndCode(pipelineCode, code);
  if (existing) {
    throw new StageError(`Stage code already exists in ${pipelineCode}`, 409);
  }

  if (input.parentId) {
    const parent = await getStageDefinitionById(input.parentId);
    if (!parent) {
      throw new StageError("Parent stage not found", 404);
    }
    if (parent.pipelineCode !== pipelineCode) {
      throw new StageError("Parent stage must belong to the same pipeline");
    }
    if (parent.kind !== "macro") {
      throw new StageError("Parent stage must be a macro stage");
    }
  }

  return {
    ...input,
    pipelineCode,
    code,
    label: input.label.trim(),
    kind: input.kind ?? (input.parentId ? "sub_status" : "macro"),
  };
};

const nestSubStatuses = (
  stages: StageDefinitionRow[]
): StageWithChildren[] => {
  const macros = stages.filter((stage) => stage.kind === "macro");
  const childrenByParent = new Map<string, StageDefinitionRow[]>();

  for (const stage of stages) {
    if (!stage.parentId) continue;
    const bucket = childrenByParent.get(stage.parentId) ?? [];
    bucket.push(stage);
    childrenByParent.set(stage.parentId, bucket);
  }

  return macros.map((stage) => ({
    ...stage,
    subStatuses: (childrenByParent.get(stage.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
    ),
  }));
};

export const getStagePipelines = async (includeInactive = false) => {
  return listStagePipelines(includeInactive);
};

export const getStagePipeline = async (pipelineCode: string) => {
  const code = assertPipelineCode(pipelineCode);
  const pipeline = await getStagePipelineByCode(code);
  if (!pipeline) {
    throw new StageError("Pipeline not found", 404);
  }
  return pipeline;
};

export const getStages = async (filters: StageListFilters = {}) => {
  if (filters.pipelineCode) {
    assertPipelineCode(filters.pipelineCode);
  }

  return listStageDefinitions(filters);
};

export const getPipelineStagesTree = async (
  pipelineCode: string,
  includeInactive = false
) => {
  const code = assertPipelineCode(pipelineCode);
  const pipeline = await getStagePipeline(code);
  const stages = await listStageDefinitions({
    pipelineCode: code,
    includeInactive,
  });

  return {
    pipeline,
    stages: nestSubStatuses(stages),
  };
};

export const getStage = async (stageId: string) => {
  const stage = await getStageDefinitionById(stageId);
  if (!stage) {
    throw new StageError("Stage not found", 404);
  }

  if (stage.kind !== "macro") {
    return stage;
  }

  const subStatuses = await listStageDefinitions({
    pipelineCode: stage.pipelineCode,
    parentId: stage.id,
    includeInactive: true,
  });

  return {
    ...stage,
    subStatuses,
  };
};

export const createStage = async (input: CreateStageInput) => {
  const validated = await validateCreateInput(input);
  return createStageDefinition(validated);
};

export const updateStage = async (stageId: string, input: UpdateStageInput) => {
  const existing = await getStageDefinitionById(stageId);
  if (!existing) {
    throw new StageError("Stage not found", 404);
  }

  if (input.label !== undefined && !input.label.trim()) {
    throw new StageError("Stage label cannot be empty");
  }

  const updated = await updateStageDefinition(stageId, {
    ...input,
    label: input.label?.trim(),
  });

  if (!updated) {
    throw new StageError("Failed to update stage");
  }

  return updated;
};

export const removeStage = async (
  stageId: string,
  options: { hard?: boolean } = {}
) => {
  const existing = await getStageDefinitionById(stageId);
  if (!existing) {
    throw new StageError("Stage not found", 404);
  }

  if (existing.isSystem) {
    throw new StageError("System stages cannot be deleted", 403);
  }

  const childCount = await countChildStages(stageId);
  if (childCount > 0) {
    throw new StageError(
      "Cannot delete a macro stage that still has sub-statuses. Remove or reassign them first."
    );
  }

  if (!options.hard && existing.isActive) {
    return updateStageDefinition(stageId, { isActive: false });
  }

  await deleteStageDefinition(stageId);
  return null;
};

export const buildDefaultPipelineSeed = () =>
  STAGE_PIPELINE_CODES.map((code) => ({
    code,
    name: STAGE_PIPELINE_LABELS[code],
    description: `Default ${STAGE_PIPELINE_LABELS[code]} pipeline`,
  }));

export {
  CLIENT_JOURNEY_STAGE_SEED,
  PAYMENT_STAGE_SEED,
  VISA_CASE_MACRO_STAGE_SEED,
  VISA_CASE_SUB_STATUS_SEED,
};
