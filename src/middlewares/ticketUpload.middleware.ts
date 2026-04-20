import multer, { MulterError } from "multer";
import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";

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
    cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, WebP, and GIF are allowed.`));
  }
};

// Multer configuration
export const ticketUploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
    files: 2, // Max 2 files per upload
  },
});

// Multer error handler middleware
export const handleMulterError = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File size too large",
        description: "Each image file must be less than 5MB. Please compress your images and try again.",
      });
    } else if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files",
        description: "You can upload a maximum of 2 images per ticket.",
      });
    } else if (err.code === "LIMIT_PART_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many form fields",
        description: "The request contains too many parts.",
      });
    }
  } else if (err && err.message) {
    // Custom error from fileFilter
    return res.status(400).json({
      success: false,
      message: "Invalid file type",
      description: err.message,
    });
  }
  next(err);
};

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
