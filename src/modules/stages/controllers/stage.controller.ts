import { Request, Response } from "express";
import { invalidateStagesCaches } from "../../cache/invalidate";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import { StageError } from "../errors/stage.errors";
import {
  getCachedPipelineStagesTree,
  getCachedStage,
  getCachedStagePipeline,
  getCachedStagePipelines,
  getCachedStages,
} from "../cache/stage.cache.service";
import {
  createStage,
  removeStage,
  updateStage,
} from "../services/stage.service";

const parseBooleanQuery = (
  value: unknown,
  defaultValue = false
): boolean => {
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
};

const handleStageError = (res: Response, error: unknown) => {
  if (error instanceof StageError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }

  const message = error instanceof Error ? error.message : "Stage request failed";
  console.error("stage controller error:", error);
  return res.status(500).json({ success: false, message });
};

export const listStagePipelinesController = async (
  req: Request,
  res: Response
) => {
  try {
    const includeInactive = parseBooleanQuery(req.query.includeInactive);
    const result = await getCachedStagePipelines(includeInactive);

    return res.status(200).json({
      success: true,
      data: result.data,
      count: result.data.length,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const getStagePipelineController = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await getCachedStagePipeline(req.params.pipelineCode);

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const getPipelineStagesTreeController = async (
  req: Request,
  res: Response
) => {
  try {
    const includeInactive = parseBooleanQuery(req.query.includeInactive);
    const result = await getCachedPipelineStagesTree(
      req.params.pipelineCode,
      includeInactive
    );

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const listStagesController = async (req: Request, res: Response) => {
  try {
    const parentIdRaw = req.query.parentId as string | undefined;
    const parentId =
      parentIdRaw === undefined
        ? undefined
        : parentIdRaw === "null"
          ? null
          : parentIdRaw;

    const filters = {
      pipelineCode: req.query.pipeline as string | undefined,
      parentId,
      kind: req.query.kind as string | undefined,
      includeInactive: parseBooleanQuery(req.query.includeInactive),
    };

    const result = await getCachedStages(filters);

    return res.status(200).json({
      success: true,
      data: result.data,
      count: result.data.length,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const getStageController = async (req: Request, res: Response) => {
  try {
    const result = await getCachedStage(req.params.stageId);

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const createStageController = async (req: Request, res: Response) => {
  try {
    const data = await createStage({
      pipelineCode: req.body.pipelineCode,
      parentId: req.body.parentId ?? null,
      code: req.body.code,
      label: req.body.label,
      description: req.body.description ?? null,
      kind: req.body.kind,
      team: req.body.team ?? null,
      sortOrder: req.body.sortOrder,
      metadata: req.body.metadata,
    });

    await invalidateStagesCaches();

    return res.status(201).json({
      success: true,
      message: "Stage created",
      data,
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const updateStageController = async (req: Request, res: Response) => {
  try {
    const data = await updateStage(req.params.stageId, {
      label: req.body.label,
      description: req.body.description,
      team: req.body.team,
      sortOrder: req.body.sortOrder,
      metadata: req.body.metadata,
      isActive: req.body.isActive,
    });

    await invalidateStagesCaches();

    return res.status(200).json({
      success: true,
      message: "Stage updated",
      data,
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};

export const deleteStageController = async (req: Request, res: Response) => {
  try {
    const hard = parseBooleanQuery(req.query.hard);
    const data = await removeStage(req.params.stageId, { hard });

    await invalidateStagesCaches();

    return res.status(200).json({
      success: true,
      message: data ? "Stage deactivated" : "Stage deleted",
      data,
    });
  } catch (error) {
    return handleStageError(res, error);
  }
};
