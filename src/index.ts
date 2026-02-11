/// <reference path="./types/express.d.ts" />
import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import userRoutes from "./routes/user.routes";
import saleRoute from "./routes/saleType.routes";
import leadTypeRoutes from "./routes/leadType.routes";
import clientRoute from "./routes/client.routes";
import clientPaymentRoutes from "./routes/clientPayment.routes";
import clientProductPaymentRoutes from "./routes/clientProductPayment.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import activityLogRoutes from "./routes/activityLog.routes";
import leaderboardRoutes from "./routes/leaderboard.routes";
import messageRoutes from "./routes/message.routes";
import googleSheetRoutes from "./routes/googleSheet.routes";
import allFinanceRoutes from "./routes/allFinance.routes";
import { healthController } from "./controllers/health.controller";
import { requireCsrf } from "./middlewares/csrf.middleware";

const app: Application = express();

const isProduction = process.env.NODE_ENV === "production";

const parseOrigins = (raw?: string): string[] =>
  (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Production CORS allowlist.
 *
 * Configure via:
 * - FRONTEND_URL=https://connect.easyvisa.ai
 * - CORS_ORIGINS=https://connect.easyvisa.ai,https://other-frontend.com
 */
const allowedOrigins = Array.from(
  new Set(
    [
      // Keep existing deployed frontend (safe default if you forget to set env)
      "https://connect.easyvisa.ai",
      process.env.FRONTEND_URL,
      ...parseOrigins(process.env.CORS_ORIGINS),
    ].filter(Boolean) as string[]
  )
);

// If you run behind Coolify/Traefik/Nginx, trust proxy so req.ip / secure cookies work correctly.
if (isProduction) {
  app.set("trust proxy", 1);
}

// ✅ CORS MUST be FIRST middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, mobile apps, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      // Development: allow all origins for convenience
      if (!isProduction) {
        return callback(null, true);
      }

      // Production: allowlist only
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // ❌ Reject if we get here
      callback(new Error("CORS policy: origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    optionsSuccessStatus: 200, // ✅ ADD THIS
  })
);

// Baseline hardening
app.disable("x-powered-by");
app.use(helmet());
app.use(compression());

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// health check
app.get("/health", healthController);

app.use(requireCsrf);

// lightweight health check
app.use("/api/users", userRoutes);
app.use("/api/sale-types", saleRoute);
app.use("/api/lead-types", leadTypeRoutes);
app.use("/api/clients", clientRoute);
app.use("/api/client-payments", clientPaymentRoutes);
app.use("/api/client-product-payments", clientProductPaymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/activity-logs", activityLogRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/google-sheets", googleSheetRoutes);
app.use("/api/all-finance", allFinanceRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode || 500);
  const message =
    status >= 500
      ? "Internal server error"
      : (err?.message || "Request failed");

  if (!isProduction) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(status).json({ message });
});

export default app;
