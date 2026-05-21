import multer from "multer";
import { Request } from "express";

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const name = file.originalname?.toLowerCase() ?? "";
  const ok =
    name.endsWith(".csv") ||
    file.mimetype === "text/csv" ||
    file.mimetype === "application/csv" ||
    file.mimetype === "text/plain";
  if (ok) cb(null, true);
  else cb(new Error("Only CSV files are allowed"));
};

export const csvUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
