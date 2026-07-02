import multer from "multer";
import { Request } from "express";

const MAX_FILE_SIZE_BYTES = Math.max(
  1,
  Number(process.env.CLIENT_PORTAL_FILE_MAX_BYTES || 100 * 1024 * 1024)
);

const uploadStorage = multer.memoryStorage();

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (!file.originalname) {
    cb(new Error("Invalid file"));
    return;
  }
  cb(null, true);
};

export const clientDocumentUploadMiddleware = multer({
  storage: uploadStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
});
