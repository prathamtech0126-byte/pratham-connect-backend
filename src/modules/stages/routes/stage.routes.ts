import { Router } from "express";
import { requireAuth, requireRole } from "../../../middlewares/auth.middleware";
import {
  STAGE_ADMIN_ROLES,
  STAGE_READ_ROLES,
} from "../constants/stage.constants";
import {
  createStageController,
  deleteStageController,
  getPipelineStagesTreeController,
  getStageController,
  getStagePipelineController,
  listStagePipelinesController,
  listStagesController,
  updateStageController,
} from "../controllers/stage.controller";

const router = Router();

/**
 * Admin-managed stage registry (DATABASE_URL_SECOND).
 * Pipelines: CLIENT_JOURNEY, VISA_CASE_PROCESSING, PAYMENT.
 */

router.get(
  "/pipelines",
  requireAuth,
  requireRole(...STAGE_READ_ROLES),
  listStagePipelinesController
);

router.get(
  "/pipelines/:pipelineCode",
  requireAuth,
  requireRole(...STAGE_READ_ROLES),
  getStagePipelineController
);

router.get(
  "/pipelines/:pipelineCode/tree",
  requireAuth,
  requireRole(...STAGE_READ_ROLES),
  getPipelineStagesTreeController
);

router.get(
  "/",
  requireAuth,
  requireRole(...STAGE_READ_ROLES),
  listStagesController
);

router.get(
  "/:stageId",
  requireAuth,
  requireRole(...STAGE_READ_ROLES),
  getStageController
);

router.post(
  "/",
  requireAuth,
  requireRole(...STAGE_ADMIN_ROLES),
  createStageController
);

router.patch(
  "/:stageId",
  requireAuth,
  requireRole(...STAGE_ADMIN_ROLES),
  updateStageController
);

router.delete(
  "/:stageId",
  requireAuth,
  requireRole(...STAGE_ADMIN_ROLES),
  deleteStageController
);

export default router;
