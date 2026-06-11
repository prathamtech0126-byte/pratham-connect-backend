import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verifySecondaryServerHmac } from "../../../middlewares/secondaryServerHmac.middleware";
import { receiveLeadRegistrationController } from "../controllers/leadRegistration.controller";

const router = Router();

const WINDOW_MS = 15 * 60 * 1000;
const inboundMax = Math.max(
  1,
  parseInt(process.env.LEAD_REGISTRATION_RATE_LIMIT_MAX ?? "120", 10)
);

const inboundRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: inboundMax,
  message: { success: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @openapi
 * /api/lead-registration/inbound:
 *   post:
 *     tags: [LeadRegistration]
 *     summary: Receive an inbound lead from a secondary server (HMAC-verified, no JWT)
 *     description: Server-to-server endpoint. Requires a valid HMAC signature in the X-Signature header. Rate-limited.
 *     security: []
 *     responses:
 *       200:
 *         description: Lead received
 *       401:
 *         description: Invalid HMAC signature
 *       429:
 *         description: Too many requests
 */
router.post(
  "/inbound",
  inboundRateLimit,
  verifySecondaryServerHmac,
  receiveLeadRegistrationController
);

export default router;
