import { bigint, index, pgTable, timestamp } from "drizzle-orm/pg-core";
import { clientInformation } from "../../../schemas/clientInformation.schema";

export const clientDocumentStorageUsage = pgTable(
  "client_portal_storage_usage",
  {
    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .primaryKey(),
    quotaBytes: bigint("quota_bytes", { mode: "number" }).notNull(),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    quotaIdx: index("idx_client_portal_storage_usage_quota").on(table.quotaBytes),
  })
);
