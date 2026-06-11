import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import {
  getClientPaymentDetailsController,
  getClientPaymentSummaryController,
  getClientProductEntitiesController,
  getCurrentMonthRevenueController,
  getLastMonthRevenueController,
} from "../controllers/payment.controller";

const router = Router();

/**
 * Modules payment APIs (DATABASE_URL_SECOND).
 * clientId — modules UUID or legacy CRM client_information.id
 */

/** Full profile: personal details, sales, core/product amounts, payments, entities */
router.get(
  "/client/:clientId",
  requireAuth,
  getClientPaymentDetailsController
);

/** Lightweight: personal basics + payment summary + per-sale core totals */
router.get(
  "/client/:clientId/summary",
  requireAuth,
  getClientPaymentSummaryController
);

/** Typed product entity tables only (air_ticket, loan, sim_card, …) */
router.get(
  "/client/:clientId/entities",
  requireAuth,
  getClientProductEntitiesController
);

/**
 * Current month revenue from amounts + dates (dates.date filter only).
 * Grouped: counsellor → clients → payments (amount, date).
 */
router.get(
  "/revenue/current-month",
  requireAuth,
  getCurrentMonthRevenueController
);

/** Last calendar month — same shape as current-month */
router.get(
  "/revenue/last-month",
  requireAuth,
  getLastMonthRevenueController
);

export default router;
