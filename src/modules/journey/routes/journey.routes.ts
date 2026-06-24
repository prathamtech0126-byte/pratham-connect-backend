import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import {
  getJourneySummaryController,
  getJourneyTimelineController,
} from "../controllers/journey.controller";

const router = Router();

/**
 * Client journey APIs — mounted at /api/modules/clients/:clientId
 *
 *   clientId — modules UUID or legacy CRM client_information.id
 *
 *   Roles: counsellor (own clients), telecaller (converted leads they handled),
 *          cx / binding / application / admin / manager / developer (any client).
 *
 *   GET  /api/modules/clients/:clientId/journey-timeline
 *   GET  /api/modules/clients/:clientId/journey-summary
 */
router.get("/:clientId/journey-timeline", requireAuth, getJourneyTimelineController);
router.get("/:clientId/journey-summary", requireAuth, getJourneySummaryController);

export default router;
