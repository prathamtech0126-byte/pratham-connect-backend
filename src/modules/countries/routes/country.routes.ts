import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import {
  getCountryController,
  listCountriesController,
} from "../controllers/country.controller";

const router = Router();

/**
 * Modules countries API (DATABASE_URL_SECOND).
 * Used for visa case destination filters and dropdowns.
 */

router.get("/", requireAuth, listCountriesController);
router.get("/:countryId", requireAuth, getCountryController);

export default router;
