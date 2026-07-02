import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import {
  stageDefinitions,
  type StageDefinitionMetadata,
} from "../schemas/stageDefinition.schema";
import { stagePipelines } from "../schemas/stagePipeline.schema";

export type StagePipelineRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type StageDefinitionRow = {
  id: string;
  pipelineId: string;
  pipelineCode: string;
  parentId: string | null;
  code: string;
  label: string;
  description: string | null;
  kind: string;
  team: string | null;
  sortOrder: number;
  metadata: StageDefinitionMetadata;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type StageListFilters = {
  pipelineCode?: string;
  parentId?: string | null;
  includeInactive?: boolean;
  kind?: string;
};

export type CreateStageInput = {
  pipelineCode: string;
  parentId?: string | null;
  code: string;
  label: string;
  description?: string | null;
  kind?: string;
  team?: string | null;
  sortOrder?: number;
  metadata?: StageDefinitionMetadata;
  isSystem?: boolean;
};

export type UpdateStageInput = {
  label?: string;
  description?: string | null;
  team?: string | null;
  sortOrder?: number;
  metadata?: StageDefinitionMetadata;
  isActive?: boolean;
};

const stageSelect = {
  id: stageDefinitions.id,
  pipelineId: stageDefinitions.pipelineId,
  pipelineCode: stagePipelines.code,
  parentId: stageDefinitions.parentId,
  code: stageDefinitions.code,
  label: stageDefinitions.label,
  description: stageDefinitions.description,
  kind: stageDefinitions.kind,
  team: stageDefinitions.team,
  sortOrder: stageDefinitions.sortOrder,
  metadata: stageDefinitions.metadata,
  isSystem: stageDefinitions.isSystem,
  isActive: stageDefinitions.isActive,
  createdAt: stageDefinitions.createdAt,
  updatedAt: stageDefinitions.updatedAt,
};

export const listStagePipelines = async (
  includeInactive = false
): Promise<StagePipelineRow[]> => {
  const conditions = includeInactive ? undefined : eq(stagePipelines.isActive, true);

  return getDbSecond()
    .select({
      id: stagePipelines.id,
      code: stagePipelines.code,
      name: stagePipelines.name,
      description: stagePipelines.description,
      isActive: stagePipelines.isActive,
      createdAt: stagePipelines.createdAt,
      updatedAt: stagePipelines.updatedAt,
    })
    .from(stagePipelines)
    .where(conditions)
    .orderBy(asc(stagePipelines.code));
};

export const getStagePipelineByCode = async (
  pipelineCode: string
): Promise<StagePipelineRow | null> => {
  const [row] = await getDbSecond()
    .select({
      id: stagePipelines.id,
      code: stagePipelines.code,
      name: stagePipelines.name,
      description: stagePipelines.description,
      isActive: stagePipelines.isActive,
      createdAt: stagePipelines.createdAt,
      updatedAt: stagePipelines.updatedAt,
    })
    .from(stagePipelines)
    .where(eq(stagePipelines.code, pipelineCode))
    .limit(1);

  return row ?? null;
};

export const listStageDefinitions = async (
  filters: StageListFilters = {}
): Promise<StageDefinitionRow[]> => {
  const conditions = [];

  if (!filters.includeInactive) {
    conditions.push(eq(stageDefinitions.isActive, true));
  }

  if (filters.pipelineCode) {
    conditions.push(eq(stagePipelines.code, filters.pipelineCode));
  }

  if (filters.parentId !== undefined) {
    if (filters.parentId === null) {
      conditions.push(isNull(stageDefinitions.parentId));
    } else {
      conditions.push(eq(stageDefinitions.parentId, filters.parentId));
    }
  }

  if (filters.kind) {
    conditions.push(eq(stageDefinitions.kind, filters.kind));
  }

  return getDbSecond()
    .select(stageSelect)
    .from(stageDefinitions)
    .innerJoin(stagePipelines, eq(stageDefinitions.pipelineId, stagePipelines.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(stageDefinitions.sortOrder), asc(stageDefinitions.label));
};

export const getStageDefinitionById = async (
  stageId: string
): Promise<StageDefinitionRow | null> => {
  const [row] = await getDbSecond()
    .select(stageSelect)
    .from(stageDefinitions)
    .innerJoin(stagePipelines, eq(stageDefinitions.pipelineId, stagePipelines.id))
    .where(eq(stageDefinitions.id, stageId))
    .limit(1);

  return row ?? null;
};

export const getStageDefinitionByPipelineAndCode = async (
  pipelineCode: string,
  code: string
): Promise<StageDefinitionRow | null> => {
  const [row] = await getDbSecond()
    .select(stageSelect)
    .from(stageDefinitions)
    .innerJoin(stagePipelines, eq(stageDefinitions.pipelineId, stagePipelines.id))
    .where(and(eq(stagePipelines.code, pipelineCode), eq(stageDefinitions.code, code)))
    .limit(1);

  return row ?? null;
};

export const countChildStages = async (stageId: string): Promise<number> => {
  const rows = await getDbSecond()
    .select({ id: stageDefinitions.id })
    .from(stageDefinitions)
    .where(eq(stageDefinitions.parentId, stageId));

  return rows.length;
};

export const createStageDefinition = async (
  input: CreateStageInput
): Promise<StageDefinitionRow> => {
  const pipeline = await getStagePipelineByCode(input.pipelineCode);
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${input.pipelineCode}`);
  }

  const [created] = await getDbSecond()
    .insert(stageDefinitions)
    .values({
      pipelineId: pipeline.id,
      parentId: input.parentId ?? null,
      code: input.code,
      label: input.label,
      description: input.description ?? null,
      kind: input.kind ?? (input.parentId ? "sub_status" : "macro"),
      team: input.team ?? null,
      sortOrder: input.sortOrder ?? 0,
      metadata: input.metadata ?? {},
      isSystem: input.isSystem ?? false,
      isActive: true,
      updatedAt: new Date(),
    })
    .returning({ id: stageDefinitions.id });

  const row = await getStageDefinitionById(created.id);
  if (!row) {
    throw new Error("Failed to load created stage");
  }

  return row;
};

export const updateStageDefinition = async (
  stageId: string,
  input: UpdateStageInput
): Promise<StageDefinitionRow | null> => {
  const patch: Partial<typeof stageDefinitions.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.label !== undefined) patch.label = input.label;
  if (input.description !== undefined) patch.description = input.description;
  if (input.team !== undefined) patch.team = input.team;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  await getDbSecond()
    .update(stageDefinitions)
    .set(patch)
    .where(eq(stageDefinitions.id, stageId));

  return getStageDefinitionById(stageId);
};

export const deleteStageDefinition = async (stageId: string): Promise<void> => {
  await getDbSecond()
    .delete(stageDefinitions)
    .where(eq(stageDefinitions.id, stageId));
};

export const deactivateStagesByIds = async (stageIds: string[]): Promise<void> => {
  if (stageIds.length === 0) return;

  await getDbSecond()
    .update(stageDefinitions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(inArray(stageDefinitions.id, stageIds));
};
