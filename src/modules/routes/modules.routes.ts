import { Router } from "express";
import countryRoutes from "../countries/routes/country.routes";
import journeyRoutes from "../journey/routes/journey.routes";
import paymentRoutes from "../payments/routes/payment.routes";
import reportsRoutes from "../reports/routes/reports.routes";
import visaCaseRoutes from "../visaCase/routes/visaCase.routes";

/**
 * Aggregated modules API (DATABASE_URL_SECOND).
 */
const router = Router();

router.use("/countries", countryRoutes);
router.use("/payments", paymentRoutes);
router.use("/reports", reportsRoutes);
router.use("/visa-cases", visaCaseRoutes);
router.use("/clients", journeyRoutes);

export default router;
