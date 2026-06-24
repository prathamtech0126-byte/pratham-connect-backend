import type { Pool } from "pg";
import { DB_SESSION_TIMEZONE } from "../constants";

/** Ensure every pooled connection reads/writes timestamps in UTC. */
export function configurePoolUtcTimezone(pool: Pool): void {
  pool.on("connect", (client) => {
    void client.query(`SET timezone = '${DB_SESSION_TIMEZONE}'`);
  });
}
