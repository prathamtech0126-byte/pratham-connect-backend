import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import { invalidateModulesCachesOnWrite } from "../../cache/invalidate";
import { clients } from "../../clients/schemas/client_convert.schema";
import { personModule } from "../../clients/schemas/person.schema";
import { visaCases } from "../schemas/visaCase.schema";
import { visaCaseDocumentRequests } from "../schemas/visaCaseDocumentRequest.schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ResolvedDocumentRequestClient = {
  id: string;
  fullName: string;
  legacyClientId: number | null;
};

const mapResolvedClient = (row: {
  id: string;
  fullName: string | null;
  legacyClientId: number | null;
}): ResolvedDocumentRequestClient | null => {
  const fullName = row.fullName?.trim();
  if (!row.id || !fullName) return null;

  return {
    id: row.id,
    fullName,
    legacyClientId: row.legacyClientId,
  };
};

export const resolveClientByLegacyId = async (
  legacyClientId: number
): Promise<ResolvedDocumentRequestClient | null> => {
  if (!Number.isFinite(legacyClientId) || legacyClientId <= 0) return null;

  const [row] = await getDbSecond()
    .select({
      id: clients.id,
      fullName: personModule.fullName,
      legacyClientId: clients.legacyClientId,
    })
    .from(clients)
    .innerJoin(personModule, eq(clients.personId, personModule.id))
    .where(eq(clients.legacyClientId, legacyClientId))
    .limit(1);

  return row ? mapResolvedClient(row) : null;
};

export const resolveClientByModulesId = async (
  clientId: string
): Promise<ResolvedDocumentRequestClient | null> => {
  const trimmed = clientId.trim();
  if (!trimmed || !UUID_RE.test(trimmed)) return null;

  const [row] = await getDbSecond()
    .select({
      id: clients.id,
      fullName: personModule.fullName,
      legacyClientId: clients.legacyClientId,
    })
    .from(clients)
    .innerJoin(personModule, eq(clients.personId, personModule.id))
    .where(eq(clients.id, trimmed))
    .limit(1);

  return row ? mapResolvedClient(row) : null;
};

export type ResolveClientForDocumentRequestInput = {
  /** Modules DB client UUID */
  clientId?: string | number | null;
  /** Main CRM client_information.id */
  legacyClientId?: string | number | null;
};

/**
 * Resolve modules client from either field:
 * - legacyClientId (e.g. 960)
 * - clientId as modules UUID
 * - clientId as legacy id (backward compatible when only clientId is sent)
 */
export const resolveClientForDocumentRequest = async (
  input: string | ResolveClientForDocumentRequestInput
): Promise<ResolvedDocumentRequestClient | null> => {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (UUID_RE.test(trimmed)) {
      return resolveClientByModulesId(trimmed);
    }

    const legacyClientId = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(legacyClientId) || legacyClientId <= 0) return null;
    return resolveClientByLegacyId(legacyClientId);
  }

  const legacyRaw = input.legacyClientId;
  if (legacyRaw != null && String(legacyRaw).trim() !== "") {
    const legacyClientId = Number(legacyRaw);
    const byLegacy = await resolveClientByLegacyId(legacyClientId);
    if (byLegacy) return byLegacy;
  }

  const clientRaw = input.clientId;
  if (clientRaw == null || String(clientRaw).trim() === "") return null;

  const clientId = String(clientRaw).trim();
  if (UUID_RE.test(clientId)) {
    return resolveClientByModulesId(clientId);
  }

  const legacyFromClientId = Number.parseInt(clientId, 10);
  if (!Number.isFinite(legacyFromClientId) || legacyFromClientId <= 0) return null;
  return resolveClientByLegacyId(legacyFromClientId);
};

/** @deprecated Use resolveClientForDocumentRequest */
export const getClientDisplayNameById = async (
  clientId: string
): Promise<string | null> => {
  const resolved = await resolveClientForDocumentRequest(clientId);
  return resolved?.fullName ?? null;
};

export type DocumentRequestHistoryFilters = {
  status?: (typeof visaCaseDocumentRequests.$inferSelect)["requestStatus"];
  sourceTeam?: string;
  targetTeam?: string;
  raisedByRole?: string;
  raisedBy?: number;
  visaCaseId?: string;
  fromDate?: string;
  toDate?: string;
  /** Current assignee or assignment history (ops visibility). */
  involvedUserId?: number;
  legacyClientIds?: number[];
  limit: number;
  offset: number;
};

const buildDocumentRequestHistoryConditions = (
  filters: DocumentRequestHistoryFilters
): SQL[] => {
  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(eq(visaCaseDocumentRequests.requestStatus, filters.status));
  }
  if (filters.sourceTeam) {
    conditions.push(
      eq(
        visaCaseDocumentRequests.sourceTeam,
        filters.sourceTeam as (typeof visaCaseDocumentRequests.$inferSelect)["sourceTeam"]
      )
    );
  }
  if (filters.targetTeam) {
    conditions.push(
      eq(
        visaCaseDocumentRequests.targetTeam,
        filters.targetTeam as (typeof visaCaseDocumentRequests.$inferSelect)["targetTeam"]
      )
    );
  }
  if (filters.raisedByRole) {
    conditions.push(eq(visaCaseDocumentRequests.raisedByRole, filters.raisedByRole));
  }
  if (filters.raisedBy != null) {
    conditions.push(eq(visaCaseDocumentRequests.raisedBy, filters.raisedBy));
  }
  if (filters.visaCaseId) {
    conditions.push(eq(visaCaseDocumentRequests.visaCaseId, filters.visaCaseId));
  }
  if (filters.fromDate) {
    conditions.push(gte(visaCaseDocumentRequests.createdAt, new Date(filters.fromDate)));
  }
  if (filters.toDate) {
    conditions.push(
      lte(
        visaCaseDocumentRequests.createdAt,
        new Date(`${filters.toDate}T23:59:59.999Z`)
      )
    );
  }
  if (filters.involvedUserId != null) {
    conditions.push(sql`(
      ${visaCases.assignedUserId} = ${filters.involvedUserId}
      OR EXISTS (
        SELECT 1 FROM visa_case_assignments a
        WHERE a.visa_case_id = ${visaCases.id}
          AND (
            a.assigned_user_id = ${filters.involvedUserId}
            OR a.previous_user_id = ${filters.involvedUserId}
          )
      )
    )`);
  }
  if (filters.legacyClientIds?.length) {
    conditions.push(inArray(clients.legacyClientId, filters.legacyClientIds));
  }

  return conditions;
};

const documentRequestHistoryBaseQuery = () =>
  getDbSecond()
    .select({ count: sql<number>`count(*)::int` })
    .from(visaCaseDocumentRequests)
    .innerJoin(visaCases, eq(visaCaseDocumentRequests.visaCaseId, visaCases.id))
    .innerJoin(clients, eq(visaCases.clientId, clients.id))
    .innerJoin(personModule, eq(clients.personId, personModule.id));

export const createVisaCaseDocumentRequest = async (
  values: typeof visaCaseDocumentRequests.$inferInsert
) => {
  const [row] = await getDbSecond()
    .insert(visaCaseDocumentRequests)
    .values(values)
    .returning();
  if (row) {
    await invalidateModulesCachesOnWrite({
      clientId: row.clientId ?? undefined,
      reason: "visa-case:document-requested",
      visaCase: {
        id: row.visaCaseId,
        clientId: row.clientId,
      },
    });
  }
  return row;
};

export const fulfillVisaCaseDocumentRequest = async (input: {
  id: string;
  fulfilledBy: number;
  fulfilmentNotes?: string | null;
}) => {
  const [row] = await getDbSecond()
    .update(visaCaseDocumentRequests)
    .set({
      requestStatus: "FULFILLED",
      fulfilledBy: input.fulfilledBy,
      fulfilledAt: new Date(),
      fulfilmentNotes: input.fulfilmentNotes ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(visaCaseDocumentRequests.id, input.id),
        eq(visaCaseDocumentRequests.requestStatus, "OPEN")
      )
    )
    .returning();
  if (row) {
    await invalidateModulesCachesOnWrite({
      clientId: row.clientId ?? undefined,
      reason: "visa-case:document-fulfilled",
      visaCase: {
        id: row.visaCaseId,
        clientId: row.clientId,
      },
    });
  }
  return row ?? null;
};

export const cancelVisaCaseDocumentRequest = async (input: {
  id: string;
  cancelledBy: number;
}) => {
  const [row] = await getDbSecond()
    .update(visaCaseDocumentRequests)
    .set({
      requestStatus: "CANCELLED",
      cancelledBy: input.cancelledBy,
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(visaCaseDocumentRequests.id, input.id),
        eq(visaCaseDocumentRequests.requestStatus, "OPEN")
      )
    )
    .returning();
  if (row) {
    await invalidateModulesCachesOnWrite({
      clientId: row.clientId ?? undefined,
      reason: "visa-case:document-cancelled",
      visaCase: {
        id: row.visaCaseId,
        clientId: row.clientId,
      },
    });
  }
  return row ?? null;
};

export const getVisaCaseDocumentRequestById = async (id: string) => {
  const [row] = await getDbSecond()
    .select()
    .from(visaCaseDocumentRequests)
    .where(eq(visaCaseDocumentRequests.id, id))
    .limit(1);
  return row ?? null;
};

export const listVisaCaseDocumentRequests = async (visaCaseId: string) =>
  getDbSecond()
    .select()
    .from(visaCaseDocumentRequests)
    .where(eq(visaCaseDocumentRequests.visaCaseId, visaCaseId))
    .orderBy(desc(visaCaseDocumentRequests.createdAt));

export const countOpenVisaCaseDocumentRequests = async (
  visaCaseId: string
): Promise<number> => {
  const [row] = await getDbSecond()
    .select({ count: sql<number>`count(*)::int` })
    .from(visaCaseDocumentRequests)
    .where(
      and(
        eq(visaCaseDocumentRequests.visaCaseId, visaCaseId),
        eq(visaCaseDocumentRequests.requestStatus, "OPEN")
      )
    );
  return row?.count ?? 0;
};

export const listVisaCaseDocumentRequestHistory = async (
  filters: DocumentRequestHistoryFilters
) => {
  const conditions = buildDocumentRequestHistoryConditions(filters);
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [[countRow], rows] = await Promise.all([
    documentRequestHistoryBaseQuery().where(whereClause),
    getDbSecond()
      .select({
        request: visaCaseDocumentRequests,
        visaCase: {
          id: visaCases.id,
          currentStage: visaCases.currentStage,
          currentSubStatus: visaCases.currentSubStatus,
          assignedTeam: visaCases.assignedTeam,
          assignedUserId: visaCases.assignedUserId,
        },
        client: {
          id: clients.id,
          legacyClientId: clients.legacyClientId,
          clientCode: clients.clientCode,
        },
        person: {
          fullName: personModule.fullName,
        },
      })
      .from(visaCaseDocumentRequests)
      .innerJoin(visaCases, eq(visaCaseDocumentRequests.visaCaseId, visaCases.id))
      .innerJoin(clients, eq(visaCases.clientId, clients.id))
      .innerJoin(personModule, eq(clients.personId, personModule.id))
      .where(whereClause)
      .orderBy(desc(visaCaseDocumentRequests.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
  ]);

  return {
    rows,
    total: countRow?.count ?? 0,
  };
};
