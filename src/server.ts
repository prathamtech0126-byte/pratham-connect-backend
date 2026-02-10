import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import app from "./index";
import { checkDbConnection, pool } from "./config/databaseConnection";
import { initializeSocket } from "./config/socket";
import { getRedisClient, initRedis } from "./config/redis";
import { deleteOldMessages } from "./models/message.model";
import * as cron from "node-cron";

/* ================================
   SIMPLE LOGGER (Production-Ready)
================================ */

const isProduction = process.env.NODE_ENV === "production";

const logger = {
  error: (...args: any[]) => console.error(...args),
  warn: (...args: any[]) => console.warn(...args),
  info: (...args: any[]) => {
    // In production, only log important info (startup, success)
    if (!isProduction) {
      console.log(...args);
    } else {
      // In production, only log startup and important events
      console.log(...args);
    }
  },
  debug: (...args: any[]) => {
    // Only log debug in development/testing
    if (!isProduction) {
      console.log(...args);
    }
    // In production, debug logs are silent
  },
};

const PORT = process.env.PORT || 5000;

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket server
initializeSocket(httpServer);

const shutdown = async (signal: string) => {
  try {
    logger.warn(`🛑 Received ${signal}. Shutting down gracefully...`);

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    try {
      await pool.end();
    } catch (e) {
      logger.warn("⚠️ Error closing DB pool:", e);
    }

    try {
      const redis = await getRedisClient();
      await redis?.quit();
    } catch (e) {
      logger.warn("⚠️ Error closing Redis:", e);
    }

    logger.info("✅ Shutdown complete.");
    process.exit(0);
  } catch (e) {
    logger.error("❌ Shutdown error:", e);
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error("❌ Unhandled Promise Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  logger.error("❌ Uncaught Exception:", err);
  void shutdown("uncaughtException");
});

// Start server - listen on all network interfaces (0.0.0.0) to allow network access
httpServer.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Server accessible on network at:`);

  // Get network IP addresses
  const os = require("os");
  const networkInterfaces = os.networkInterfaces();

  Object.keys(networkInterfaces).forEach((interfaceName) => {
    const interfaces = networkInterfaces[interfaceName];
    if (interfaces) {
      interfaces.forEach((iface: any) => {
        if (iface.family === "IPv4" && !iface.internal) {
          console.log(`   http://${iface.address}:${PORT}`);
        }
      });
    }
  });

  console.log(`   http://localhost:${PORT} (local)`);

  // Check database connection asynchronously
  checkDbConnection()
    .then(() => {
      console.log("✅ Database connection verified");

      // Initialize Redis (optional). App continues even if Redis is down.
      initRedis()
        .then((client) =>
          console.log(client ? "✅ Redis initialized (cache enabled)" : "⚠️ Redis not available (cache disabled)")
        )
        .catch(() => console.log("⚠️ Redis not available (cache disabled)"));

      // Initialize message cleanup scheduler
      initializeMessageCleanup();
    })
    .catch((error) => {
      console.error("❌ Database connection failed");
      console.error("   Full error:", error.message);
      console.error("\n💡 Troubleshooting:");
      console.error("   1. Check if PostgreSQL is running");
      console.error("   2. Verify DATABASE_URL in .env file");
      console.error("   3. Ensure database 'demo' exists");
      console.error("   4. Check username/password are correct");
      process.exit(1); // stop app if DB fails
    });
});

/* ================================
   MESSAGE CLEANUP SCHEDULER
================================ */

/**
 * Initialize message cleanup scheduler
 * - Production: Runs daily at midnight (12:00 AM) using cron
 * - Testing: Runs every 10 seconds or 1 minute using setInterval
 */
const initializeMessageCleanup = () => {
  // Configuration from environment variables
  const nodeEnv = process.env.NODE_ENV || "development";
  const cleanupMode = process.env.MESSAGE_CLEANUP_MODE || "";

  // Determine mode:
  // - If NODE_ENV=production, ALWAYS use production mode (ignore MESSAGE_CLEANUP_MODE)
  // - Otherwise, use testing mode if NODE_ENV=development OR MESSAGE_CLEANUP_MODE=testing
  const isTesting = nodeEnv !== "production" && (nodeEnv === "development" || cleanupMode.toLowerCase().trim() === "testing");

  // Retention period: 1 second for testing, 365 days for production
  const retentionPeriodMs = isTesting
    ? (parseInt(process.env.MESSAGE_RETENTION_SECONDS || "1", 10) * 1000) // 1 second default for testing
    : (parseInt(process.env.MESSAGE_RETENTION_DAYS || "365", 10) * 24 * 60 * 60 * 1000); // 365 days default for production

  // Cleanup interval for testing (in seconds)
  const testIntervalSeconds = parseInt(process.env.MESSAGE_CLEANUP_INTERVAL || "10", 10);

  // Cleanup function
  const runCleanup = async () => {
    try {
      const result = await deleteOldMessages(retentionPeriodMs, isTesting);

      if (result.deletedCount > 0) {
        // Always log successful deletions (important for monitoring)
        logger.info(`✅ Deleted ${result.deletedCount} old message(s). IDs: ${result.deletedMessageIds.join(", ")}`);
      }
      // Don't log "No messages to delete" in production (too frequent, not important)
      else if (!isProduction) {
        logger.debug(`ℹ️  No old messages to delete`);
      }
    } catch (error: any) {
      // Always log errors (critical for debugging production issues)
      logger.error("❌ Error during message cleanup:", error.message);
      logger.error("   Stack:", error.stack);
    }
  };

  if (isTesting) {
    // Testing mode: Use setInterval (every 10 seconds or configured interval)
    const intervalMs = testIntervalSeconds * 1000;
    logger.info(`🧹 Message cleanup scheduled (TESTING MODE): Every ${testIntervalSeconds} seconds`);
    logger.debug(`   Retention period: ${retentionPeriodMs / 1000} seconds`);

    // Run immediately on startup
    runCleanup();

    // Then run at intervals
    setInterval(runCleanup, intervalMs);
  } else {
    // Production mode: Use cron (daily at midnight)
    const cronExpression = process.env.MESSAGE_CLEANUP_CRON || "0 0 * * *"; // Daily at midnight
    logger.info(`🧹 Message cleanup scheduled (PRODUCTION MODE): Daily at midnight (cron: ${cronExpression})`);
    logger.info(`   Retention period: ${retentionPeriodMs / (24 * 60 * 60 * 1000)} days`);

    cron.schedule(cronExpression, runCleanup, {
      timezone: process.env.TZ || "UTC",
    });

    logger.info(`✅ Message cleanup cron job started`);
  }
};
