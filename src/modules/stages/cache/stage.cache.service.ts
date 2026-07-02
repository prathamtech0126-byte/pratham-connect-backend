import { getOrSetCache } from "../../cache/getOrSetCache";
import { MODULE_CACHE_KEYS, MODULE_CACHE_TTL } from "../../cache/keys";
import {
  getStage,
  getStagePipeline,
  getStagePipelines,
  getPipelineStagesTree,
  getStages,
} from "../services/stage.service";
import type { StageListFilters } from "../models/stage.model";

const listKey = (filters: StageListFilters) =>
  `${MODULE_CACHE_KEYS.STAGES_LIST}${JSON.stringify(filters)}`;

const treeKey = (pipelineCode: string, includeInactive: boolean) =>
  `${MODULE_CACHE_KEYS.STAGES_TREE}${pipelineCode}:${includeInactive}`;

export const getCachedStagePipelines = (includeInactive = false) =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.STAGES_PIPELINES}${includeInactive}`,
    MODULE_CACHE_TTL.STAGES,
    () => getStagePipelines(includeInactive)
  );

export const getCachedStagePipeline = (pipelineCode: string) =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.STAGES_PIPELINE}${pipelineCode}`,
    MODULE_CACHE_TTL.STAGES,
    () => getStagePipeline(pipelineCode)
  );

export const getCachedStages = (filters: StageListFilters = {}) =>
  getOrSetCache(listKey(filters), MODULE_CACHE_TTL.STAGES, () =>
    getStages(filters)
  );

export const getCachedPipelineStagesTree = (
  pipelineCode: string,
  includeInactive = false
) =>
  getOrSetCache(treeKey(pipelineCode, includeInactive), MODULE_CACHE_TTL.STAGES, () =>
    getPipelineStagesTree(pipelineCode, includeInactive)
  );

export const getCachedStage = (stageId: string) =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.STAGES_DETAIL}${stageId}`,
    MODULE_CACHE_TTL.STAGES,
    () => getStage(stageId)
  );
