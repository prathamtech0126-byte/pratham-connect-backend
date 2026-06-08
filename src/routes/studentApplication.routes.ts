import { Router } from "express";
import {
  createStudentApplicationController,
  getStudentApplicationsByClientController,
  updateStudentApplicationStatusController,
  updateStudentApplicationNoteController,
  deleteStudentApplicationController,
} from "../controllers/studentApplication.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

router.post("/", requireAuth, preventDuplicateRequests, createStudentApplicationController);

router.get("/client/:clientId", requireAuth, getStudentApplicationsByClientController);

router.patch(
  "/:applicationId/status",
  requireAuth,
  updateStudentApplicationStatusController,
);

router.patch(
  "/:applicationId/note",
  requireAuth,
  updateStudentApplicationNoteController,
);

router.delete("/:applicationId", requireAuth, deleteStudentApplicationController);

export default router;
