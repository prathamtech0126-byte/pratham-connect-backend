import { timestamp } from "drizzle-orm/pg-core";

/** `timestamptz` column defaulting to the current UTC instant at insert. */
export function utcCreatedAt(columnName = "created_at") {
  return timestamp(columnName, { withTimezone: true }).defaultNow().notNull();
}

/** `timestamptz` column defaulting to the current UTC instant at insert/update. */
export function utcUpdatedAt(columnName = "updated_at") {
  return timestamp(columnName, { withTimezone: true }).defaultNow().notNull();
}

/** Standard `created_at` / `updated_at` pair as UTC `timestamptz` columns. */
export function utcTimestampColumns() {
  return {
    createdAt: utcCreatedAt(),
    updatedAt: utcUpdatedAt(),
  };
}
