/**
 * Counsellor client visibility — current owner/shared plus full transfer chain
 * from modules `client_transfer_modules`.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../../../config/databaseConnectionSecond";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";

export type ClientAccessLevel = "none" | "read" | "write";

const ADMIN_WRITE_ROLES = new Set([
  "admin",
  "developer",
  "superadmin",
]);

const toNumber = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Legacy CRM client ids where user appears in transfer history (modules DB). */
export async function getLegacyClientIdsFromTransferHistory(
  userId: number
): Promise<number[]> {
  if (!isModulesDbConfigured()) return [];

  const { rows } = await getPoolSecond().query<{ legacy_client_id: number }>(
    `SELECT DISTINCT c.legacy_client_id
       FROM client_transfer_modules ct
       JOIN clients c ON c.id = ct.client_id
      WHERE c.legacy_client_id IS NOT NULL
        AND (ct.from_user_id = $1 OR ct.to_user_id = $1)`,
    [userId]
  );

  return rows
    .map((r) => toNumber(r.legacy_client_id))
    .filter((id): id is number => id != null);
}

/** All counsellor user ids ever tied to this client (owner, shared, transfer chain). */
export async function getCounsellorIdsInvolvedWithClient(
  clientId: number
): Promise<number[]> {
  const [client] = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      transferStatus: clientInformation.transferStatus,
      transferedToCounsellorId: clientInformation.transferedToCounsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return [];

  const ids = new Set<number>();
  const ownerId = toNumber(client.counsellorId);
  if (ownerId != null) ids.add(ownerId);

  if (client.transferStatus) {
    const sharedId = toNumber(client.transferedToCounsellorId);
    if (sharedId != null) ids.add(sharedId);
  }

  if (isModulesDbConfigured()) {
    const { rows } = await getPoolSecond().query<{
      from_user_id: number | null;
      to_user_id: number | null;
    }>(
      `SELECT ct.from_user_id, ct.to_user_id
         FROM client_transfer_modules ct
         JOIN clients c ON c.id = ct.client_id
        WHERE c.legacy_client_id = $1`,
      [clientId]
    );

    for (const row of rows) {
      const fromId = toNumber(row.from_user_id);
      const toId = toNumber(row.to_user_id);
      if (fromId != null) ids.add(fromId);
      if (toId != null) ids.add(toId);
    }
  }

  return [...ids];
}

/** Legacy client ids a counsellor may view (owner, shared, or past transfer chain). */
export async function getAccessibleLegacyClientIdsForCounsellor(
  counsellorId: number
): Promise<number[]> {
  const [owned, shared, history] = await Promise.all([
    db
      .select({ clientId: clientInformation.clientId })
      .from(clientInformation)
      .where(eq(clientInformation.counsellorId, counsellorId)),
    db
      .select({ clientId: clientInformation.clientId })
      .from(clientInformation)
      .where(
        and(
          eq(clientInformation.transferStatus, true),
          eq(clientInformation.transferedToCounsellorId, counsellorId)
        )
      ),
    getLegacyClientIdsFromTransferHistory(counsellorId),
  ]);

  return [
    ...new Set([
      ...owned.map((r) => r.clientId),
      ...shared.map((r) => r.clientId),
      ...history,
    ]),
  ];
}

export async function resolveClientAccess(
  clientId: number,
  userId: number,
  role: string
): Promise<ClientAccessLevel> {
  if (ADMIN_WRITE_ROLES.has(role)) return "write";

  const [client] = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      transferStatus: clientInformation.transferStatus,
      transferedToCounsellorId: clientInformation.transferedToCounsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return "none";

  if (role === "manager" || role === "branchmanager") {
    const involvedIds = await getCounsellorIdsInvolvedWithClient(clientId);
    if (!involvedIds.length) return "none";

    const counsellors = await db
      .select({ id: users.id, managerId: users.managerId })
      .from(users)
      .where(inArray(users.id, involvedIds));

    return counsellors.some((c) => c.managerId === userId) ? "write" : "none";
  }

  if (role === "counsellor") {
    const ownerId = toNumber(client.counsellorId);
    const isOwner = ownerId === userId;
    const isSharedTo =
      client.transferStatus === true &&
      toNumber(client.transferedToCounsellorId) === userId;

    if (isOwner || isSharedTo) return "write";

    const historyIds = await getLegacyClientIdsFromTransferHistory(userId);
    if (historyIds.includes(clientId)) return "read";

    return "none";
  }

  if (role === "cx" || role === "binding" || role === "application") {
    return "read";
  }

  return "none";
}

export async function canUserViewClient(
  clientId: number,
  userId: number,
  role: string
): Promise<boolean> {
  return (await resolveClientAccess(clientId, userId, role)) !== "none";
}

export async function canUserModifyClient(
  clientId: number,
  userId: number,
  role: string
): Promise<boolean> {
  return (await resolveClientAccess(clientId, userId, role)) === "write";
}

/** Drizzle OR condition for counsellor client lists (active or archived). */
export async function buildCounsellorClientVisibilityCondition(
  counsellorId: number
) {
  const historyIds = await getLegacyClientIdsFromTransferHistory(counsellorId);

  const conditions = [
    eq(clientInformation.counsellorId, counsellorId),
    and(
      eq(clientInformation.transferStatus, true),
      eq(clientInformation.transferedToCounsellorId, counsellorId)
    ),
  ];

  if (historyIds.length > 0) {
    conditions.push(inArray(clientInformation.clientId, historyIds));
  }

  return or(...conditions);
}
