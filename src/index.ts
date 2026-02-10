/// <reference path="./types/express.d.ts" />
import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
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

const app: Application = express();

const allowedOrigins = [
  // 'https://demo.easyvisa.ai',           // ✅ Deployed frontend
  // 'https://demo-canada.easyvisa.ai',    // Alternative frontend
  'https://connect.easyvisa.ai',
  process.env.FRONTEND_URL ?? "http://localhost:5173",
  // "http://localhost:4173"
].filter(Boolean); // Remove any undefined values

// Get network IP addresses for CORS
const os = require("os");
const networkInterfaces = os.networkInterfaces();
const networkIPs: string[] = [];

Object.keys(networkInterfaces).forEach((interfaceName) => {
  networkInterfaces[interfaceName]?.forEach((iface: any) => {
    if (iface.family === "IPv4" && !iface.internal) {
      networkIPs.push(`http://${iface.address}:5173`); // Frontend port
    }
  });
});

// ✅ CORS MUST be FIRST middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, mobile apps, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      console.log('[CORS] Checking origin:', origin);

      // ✅ Allow localhost in any environment
      if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {

        return callback(null, true);
      }

      // ✅ Allow your deployed frontend
      if (origin === 'https://demo.easyvisa.ai' || origin === 'https://demo-canada.easyvisa.ai') {

        return callback(null, true);
      }

      // ✅ Allow in development mode (more permissive)
      if (process.env.NODE_ENV !== "production") {
        // Allow network IPs in development
        if (networkIPs.some(ip => origin.startsWith(ip.replace(":5173", "")))) {

          return callback(null, true);
        }

        // Allow any local network IP in development (for testing)
        const localNetworkPattern = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
        if (localNetworkPattern.test(origin)) {
          return callback(null, true);
        }

        return callback(null, true); // Allow all in development
      }

      // TEMPORARY: Allow all origins if ALLOW_ALL_ORIGINS is set (for testing only)
      if (process.env.ALLOW_ALL_ORIGINS === "true") {
        console.warn("⚠️  WARNING: CORS is allowing ALL origins. This should only be used for testing!");
        return callback(null, true);
      }

      // ✅ Check explicit allowlist for production
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // ✅ Allow Replit host patterns (sisko.replit.dev) used by frontends
      if (origin.includes("sisko.replit.dev")) {
        return callback(null, true);
      }

      // ❌ Reject if we get here
      console.error(`[CORS] ❌ Origin "${origin}" not allowed. Allowed origins:`, allowedOrigins);
      callback(new Error("CORS policy: origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200, // ✅ ADD THIS
  })
);


app.use(express.json());
app.use(cookieParser());

//"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:5000


// lightweight health check
app.get("/health", healthController);
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

export default app;
