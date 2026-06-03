// /// <reference path="./types/express.d.ts" />
// import express, { Application } from "express";
// import cors from "cors";
// import cookieParser from "cookie-parser";
// import helmet from "helmet";
// import compression from "compression";
// import userRoutes from "./routes/user.routes";
// import saleRoute from "./routes/saleType.routes";
// import saleTypeCategoryRoutes from "./routes/saleTypeCategory.routes";
// import leadTypeRoutes from "./routes/leadType.routes";
// import clientRoute from "./routes/client.routes";
// import clientPaymentRoutes from "./routes/clientPayment.routes";
// import clientProductPaymentRoutes from "./routes/clientProductPayment.routes";
// import dashboardRoutes from "./routes/dashboard.routes";
// import activityLogRoutes from "./routes/activityLog.routes";
// import leaderboardRoutes from "./routes/leaderboard.routes";
// import managerTargetsRoutes from "./routes/managerTargets.routes";
// import reportRoutes from "./routes/report.route";
// import messageRoutes from "./routes/message.routes";
// import googleSheetRoutes from "./routes/googleSheet.routes";
// import allFinanceRoutes from "./routes/allFinance.routes";
// import { healthController } from "./controllers/health.controller";
// import { requireCsrf } from "./middlewares/csrf.middleware";


// const app: Application = express();

// const isProduction = process.env.NODE_ENV === "production";

// const parseOrigins = (raw?: string): string[] =>
//   (raw || "")
//     .split(",")
//     .map((s) => s.trim())
//     .filter(Boolean);

// /**
//  * Production CORS allowlist.
//  *
//  * Configure via:
//  * - FRONTEND_URL=https://connect.easyvisa.ai
//  * - CORS_ORIGINS=https://connect.easyvisa.ai,https://other-frontend.com
//  */
// const allowedOrigins = Array.from(
//   new Set(
//     [
//       // Keep existing deployed frontend (safe default if you forget to set env)
//       "https://connect.easyvisa.ai",
//       process.env.FRONTEND_URL,
//       ...parseOrigins(process.env.CORS_ORIGINS),
//     ].filter(Boolean) as string[]
//   )
// );

// // If you run behind Coolify/Traefik/Nginx, trust proxy so req.ip / secure cookies work correctly.
// if (isProduction) {
//   app.set("trust proxy", 1);
// }

// // ✅ CORS MUST be FIRST middleware
// app.use(
//   cors({
//     origin: (origin, callback) => {
//       // Allow requests with no origin (Postman, mobile apps, server-to-server)
//       if (!origin) {
//         return callback(null, true);
//       }

//       // Development: allow all origins for convenience
//       if (!isProduction) {
//         return callback(null, true);
//       }

//       // Production: allowlist only
//       if (allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       }

//       // ❌ Reject if we get here
//       callback(new Error("CORS policy: origin not allowed"));
//     },
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
//     optionsSuccessStatus: 200, // ✅ ADD THIS
//   })
// );

// // Baseline hardening
// app.disable("x-powered-by");
// app.use(helmet());
// app.use(compression());

// app.use(express.json({ limit: "1mb" }));
// app.use(cookieParser());

// // health check
// app.get("/health", healthController);
// // root healthcheck (for Coolify)
// app.get("/", (_req, res) => {
//   res.status(200).send("OK");
// });


// app.use(requireCsrf);

// // lightweight health check
// app.use("/api/users", userRoutes);
// app.use("/api/sale-types", saleRoute);
// app.use("/api/sale-type-categories", saleTypeCategoryRoutes);
// app.use("/api/lead-types", leadTypeRoutes);
// app.use("/api/clients", clientRoute);
// app.use("/api/client-payments", clientPaymentRoutes);
// app.use("/api/client-product-payments", clientProductPaymentRoutes);
// app.use("/api/dashboard", dashboardRoutes);
// app.use("/api/activity-logs", activityLogRoutes);
// app.use("/api/leaderboard", leaderboardRoutes);
// app.use("/api/manager-targets", managerTargetsRoutes);
// app.use("/api/reports", reportRoutes);
// app.use("/api/messages", messageRoutes);
// app.use("/api/google-sheets", googleSheetRoutes);
// app.use("/api/all-finance", allFinanceRoutes);

// // 404
// app.use((_req, res) => {
//   res.status(404).json({ message: "Route not found" });
// });

// // Error handler
// app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
//   const status = Number(err?.status || err?.statusCode || 500);
//   const message =
//     status >= 500
//       ? "Internal server error"
//       : (err?.message || "Request failed");

//   if (!isProduction) {
//     // eslint-disable-next-line no-console
//     console.error(err);
//   }

//   res.status(status).json({ message });
// });

// export default app;


/// <reference path="./types/express.d.ts" />
import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import userRoutes from "./routes/user.routes";
import saleRoute from "./routes/saleType.routes";
import saleTypeCategoryRoutes from "./routes/saleTypeCategory.routes";
import leadTypeRoutes from "./Leads/routes/leadType.routes";
import clientRoute from "./routes/client.routes";
import clientPaymentRoutes from "./routes/clientPayment.routes";
import clientProductPaymentRoutes from "./routes/clientProductPayment.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import activityLogRoutes from "./routes/activityLog.routes";
import leaderboardRoutes from "./routes/leaderboard.routes";
import managerTargetsRoutes from "./routes/managerTargets.routes";
import reportRoutes from "./routes/report.route";
import messageRoutes from "./routes/message.routes";
import googleSheetRoutes from "./routes/googleSheet.routes";
import allFinanceRoutes from "./routes/allFinance.routes";
import teamListRoutes from "./routes/teamList.routes"; // ✅ ADD THIS LINE
import checklistRoutes from "./routes/checklist.routes";
import leadRoutes from "./Leads/routes/lead.routes";
import telecallerTargets  from "./routes/telecallerTarget.routes";
import automationRoutes from "./Leads/facebookautomation/facebook_routes/automation.routes";
import leadRegistrationRoutes from "./Leads/leadregistration/routes/leadRegistration.routes";
import frontDeskRoutes from "./Leads/frontdesk/routes/frontdesk.routes";
import techSupportRoutes from "./routes/techSupport.routes";
import maintenanceRoutes from "./routes/maintenance.routes";
import incentiveRulesRoutes from "./routes/incentiveRules.routes";
import incentiveReportRoutes from "./routes/incentiveReport.routes";
import { healthController } from "./controllers/health.controller";
import { requireCsrf } from "./middlewares/csrf.middleware";
import otherProductsRoutes from "./routes/otherProducts.routes";
import ruleConfigurationRoutes from "./routes/ruleConfiguration.routes";
import notificationRoutes from "./notification/routes/notification.routes";



const app: Application = express();

const isProduction = process.env.NODE_ENV === "production";

const parseOrigins = (raw?: string): string[] =>
  (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * CORS allowlist used when NODE_ENV=production (see cors callback below).
 *
 * - Development: localhost + LAN dev URLs + FRONTEND_URL + CORS_ORIGINS (so local / network dev works).
 * - Production: FRONTEND_URL only — set in env (no hardcoded dev origins).
 */
const devDefaultOrigins = [
  "http://localhost:5000",
  "http://192.168.68.142:5000",
  "http://192.168.29.105:5000",
];

const allowedOrigins = Array.from(
  new Set(
    (
      isProduction
        ? [process.env.FRONTEND_URL]
        : [
            ...devDefaultOrigins,
            process.env.FRONTEND_URL,
            ...parseOrigins(process.env.CORS_ORIGINS),
          ]
    ).filter(Boolean) as string[]
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
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "PATCH","OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "X-Timestamp",
      "X-Signature",
    ],
    optionsSuccessStatus: 200,
  })
);

// Baseline hardening
app.disable("x-powered-by");
app.use(helmet());
app.use(compression());

// Facebook webhook needs raw body for signature verification.
// Keep this isolated to the webhook path so the rest of the app uses JSON parsing normally.
app.use("/api/automation/facebook/webhook", express.raw({ type: "application/json" }));

// Secondary-server lead registration inbound (HMAC over raw JSON body).
app.use(
  "/api/lead-registration/inbound",
  express.raw({ type: "application/json", limit: "64kb" })
);

app.use(
  express.json({
    limit: "1mb",
  })
);


app.use(cookieParser());

// health check
app.get("/health", healthController);
// root healthcheck (for Coolify)
app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

// Serve uploaded ticket images statically
app.use("/uploads", express.static("uploads"));

app.use(requireCsrf);

// lightweight health check
app.use("/api/users", userRoutes);
app.use("/api/sale-types", saleRoute);
app.use("/api/sale-type-categories", saleTypeCategoryRoutes);
app.use("/api/lead-types", leadTypeRoutes);
app.use("/api/clients", clientRoute);
app.use("/api/client-payments", clientPaymentRoutes);
app.use("/api/client-product-payments", clientProductPaymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/activity-logs", activityLogRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/manager-targets", managerTargetsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/google-sheets", googleSheetRoutes);
app.use("/api/all-finance", allFinanceRoutes);
app.use("/api/team", teamListRoutes); // ✅ ADD THIS LINE
app.use("/api/v1", checklistRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/lead-registration", leadRegistrationRoutes);
app.use("/api/front-desk", frontDeskRoutes);
app.use("/api/telecaller-targets", telecallerTargets);
app.use("/api/automation", automationRoutes);
app.use("/api/tech-support", techSupportRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/incentives", incentiveRulesRoutes);
app.use("/api/incentives", incentiveReportRoutes);
app.use("/api/other-products", otherProductsRoutes);
app.use("/api/rule-configurations", ruleConfigurationRoutes);
app.use("/api/notifications", notificationRoutes);


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