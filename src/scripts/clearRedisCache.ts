import "dotenv/config";
import { getRedisClient } from "../config/redis";

async function clearRedisCache() {
  try {
    console.log("🔄 Clearing Redis cache...\n");

    const redisClient = await getRedisClient();
    
    if (!redisClient) {
      console.log("⚠️  Redis is not configured or not connected");
      process.exit(0);
    }

    // Clear all keys matching dashboard pattern
    const dashboardKeys = await redisClient.keys("dashboard:*");
    const saleTypeKeys = await redisClient.keys("sale-types*");
    const allKeys = [...dashboardKeys, ...saleTypeKeys];

    if (allKeys.length > 0) {
      for (const key of allKeys) {
        await redisClient.del(key);
        console.log(`✅ Deleted cache key: ${key}`);
      }
    } else {
      console.log("ℹ️  No cache keys found to delete");
    }

    console.log("\n✅ Redis cache cleared successfully!");
    console.log("📊 Dashboard will recalculate on next request");

    await redisClient.quit();
    process.exit(0);
  } catch (error: any) {
    console.error("❌ Error clearing Redis cache:", error.message);
    process.exit(1);
  }
}

clearRedisCache();
