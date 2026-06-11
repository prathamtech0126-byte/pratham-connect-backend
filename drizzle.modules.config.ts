import type { Config } from "drizzle-kit";
import "dotenv/config";

const url = process.env.DATABASE_URL_SECOND?.trim();

if (!url) {
  throw new Error(
    "DATABASE_URL_SECOND is required for modules migrations (payment-database)"
  );
}

/** Drizzle Kit config for `src/modules/**` → payment-database */
export default {
  schema: "./src/modules/**/*.schema.ts",
  out: "./src/modules/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
