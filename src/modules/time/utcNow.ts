/**
 * Current instant for `timestamptz` columns.
 * PostgreSQL stores this as UTC; node-pg returns a real Date instant.
 */
export function getUtcNow(): Date {
  return new Date();
}
