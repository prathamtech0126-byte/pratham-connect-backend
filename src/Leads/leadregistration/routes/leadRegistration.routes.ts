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

// Public — HMAC-verified server-to-server only (no JWT)
router.post(
  "/inbound",
  inboundRateLimit,
  verifySecondaryServerHmac,
  receiveLeadRegistrationController
);

export default router;
