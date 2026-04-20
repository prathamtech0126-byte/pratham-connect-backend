import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";
import { AuthenticatedRequest } from "../types/express-auth";

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads", "tickets");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadsDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    // @ts-ignore - user is attached by auth middleware
    const userId = req.user?.id || "unknown";
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const uniqueName = `ticket-${userId}-${timestamp}${ext}`;
    cb(null, uniqueName);
  },
});

// File filter - only images
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (JPEG, PNG, WebP, GIF) are allowed"));
  }
};

// Multer configuration
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
    files: 2, // Max 2 files per upload
  },
});

// Helper to delete ticket images
export const deleteTicketImages = (imagePaths: string[]) => {
  imagePaths.forEach((imagePath) => {
    try {
      const fullPath = path.join(process.cwd(), imagePath.replace(/^\/uploads\//, "uploads/"));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Upload] Deleted image: ${fullPath}`);
      }
    } catch (err) {
      console.error(`[Upload] Failed to delete image: ${imagePath}`, err);
    }
  });
};
