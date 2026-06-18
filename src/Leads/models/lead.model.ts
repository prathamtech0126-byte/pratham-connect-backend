import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { saveClient } from "../../models/client.model";
import {
  getIndianNow,
  indianPeriodBounds,
  serializeLeadActivityTimestampsForApi,
  serializeLeadTimestampsForApi,
  utcToIndianWallClock,
} from "../../utils/istTime";

export { getIndianNow } from "../../utils/istTime";
import { leads } from "../schemas/leads.schema";
import { transferOutcomeInPeriodFilter } from "../services/leadTransferredAt.service";
import {
  convertedInPeriodSql,
  droppedInPeriodSql,
  transferredAtInPeriodSql,
  transferOutcomeInPeriodSql,
} from "../services/leadReportPeriodSql.service";
import { leadActivities } from "../schemas/leadActivities.schema";
import { leadTypes } from "../schemas/leadType.schema";
import { users } from "../../schemas/users.schema";
import { normalizeLeadTypeSlug } from "./leadType.model";
import { leadStudentProfiles } from "../leadregistration/schemas/leadStudentProfiles.schema";
import { leadStudentEducation } from "../leadregistration/schemas/leadStudentEducation.schema";
import { leadLanguageExamScores } from "../leadregistration/schemas/leadLanguageExamScores.schema";
import { leadFamilyMembers } from "../leadregistration/schemas/leadFamilyMembers.schema";
import { getFacebookLeadMetaByLeadId, getFacebookLeadSentStatus } from "../facebookautomation/facebook_models/facebookLead.model";
import { facebookLead } from "../facebookautomation/facebook_schemas/facebookLead.schema";
import { attachReferencesToLeadRows } from "../services/leadReference.service";
import { assertEnglishNameField, assertLeadCityField } from "../../utils/leadTextNormalization";
import { normalizeDateOfBirthForDb } from "../../utils/date";

type LeadInsert = typeof leads.$inferInsert;
type ActivityInsert = typeof leadActivities.$inferInsert;

type LeadLockRow = {
  isJunk?: boolean | null;
  progressStatus?: string | null;
  assignmentStatus?: string | null;
};

export const isLeadJunkLocked = (lead: LeadLockRow): boolean =>
  Boolean(lead.isJunk) || lead.progressStatus === "junk";

export const isLeadConvertedLocked = (lead: LeadLockRow): boolean =>
  lead.progressStatus === "converted" || lead.assignmentStatus === "converted";

export const isLeadDroppedLocked = (lead: LeadLockRow): boolean =>
  lead.assignmentStatus === "dropped";

/** Junk: all roles. Converted: all roles (view-only). Dropped: counsellors. */
export const isLeadLocked = (lead: LeadLockRow, role?: string | null): boolean => {
  if (isLeadJunkLocked(lead)) return true;
  if (isLeadConvertedLocked(lead)) return true;
  if (role === "counsellor" && isLeadDroppedLocked(lead)) return true;
  return false;
};

export interface LeadListFilters {
  search?: string;
  assignmentStatus?: string;
  progressStatus?: string;
  eligibilityStatus?: string;
  leadQuality?: string;
  currentTelecallerId?: number;
  currentCounsellorId?: number;
  isJunk?: boolean;
  nextFollowupFrom?: string;
  nextFollowupTo?: string;
  leadSource?: string;
  leadType?: string;
  createdFrom?: string;
  createdTo?: string;
  transferredFrom?: string;
  transferredTo?: string;
  convertedFrom?: string;
  convertedTo?: string;
  droppedFrom?: string;
  droppedTo?: string;
  page?: number;
  limit?: number;
  sortBy?: "created_at" | "updated_at" | "next_followup_at";
  sortOrder?: "asc" | "desc";
  /** Counsellor list buckets: not_contacted | in_progress | follow_up | converted | dropped */
  counsellorListFilter?:
    | "not_contacted"
    | "in_progress"
    | "follow_up"
    | "converted"
    | "dropped";
  /** When true, do not hide converted/dropped on counsellor-scoped lists (reports). */
  forReport?: boolean;
  /** Counsellor viewing their own lead list (hide converted/dropped unless forReport). */
  counsellorOwnList?: boolean;
  /** All leads linked to currentTelecallerId / currentCounsellorId (any assignment status). */
  assignedScope?: boolean;
  /** Report drilldown bucket computed on backend. */
  reportBucket?: "contacted" | "transferred";
  /** Leads with at least one pending follow-up activity. */
  hasPendingFollowUp?: boolean;
  withoutTelecaller?: boolean;
  withTelecaller?: boolean;
  /** Filter by sent_to_meta flag in facebook_lead table. Omit to skip filter. */
  sentToMeta?: boolean;
  /** When true, restrict to leads that have a facebook_lead record (both FB and Instagram). */
  metaLeadsOnly?: boolean;
  /** true = leadQuality IS NOT NULL; false = leadQuality IS NULL */
  hasQuality?: boolean;
  /** When true, only show leads with assignmentStatus IN ('transferred','dropped','converted') OR progressStatus='junk' */
  excludeUnassigned?: boolean;
}

/** Slugs that may appear on either leads.lead_source or leads.lead_type (inbound channels). */
const CHANNEL_LEAD_SLUGS = new Set([
  "udaan",
  "udan",
  "walk_in",
  "web_site",
  "facebook",
  "instagram",
]);

const normalizedLeadColumnEquals = (column: typeof leads.leadSource | typeof leads.leadType, slug: string) =>
  sql`LOWER(REPLACE(TRIM(COALESCE(${column}, '')), ' ', '_')) = ${slug}`;

/**
 * Match lead source/type filters case-insensitively.
 * Channel slugs (web_site, udaan, walk_in) match either column so filters work
 * when legacy rows only have the value on lead_type.
 */
const buildLeadChannelFilter = (
  raw: string,
  field: "leadSource" | "leadType" = "leadSource"
) => {
  const slug = normalizeLeadTypeSlug(raw);
  const exact = raw.trim();

  if (slug && CHANNEL_LEAD_SLUGS.has(slug)) {
    return or(
      normalizedLeadColumnEquals(leads.leadSource, slug),
      normalizedLeadColumnEquals(leads.leadType, slug)
    )!;
  }

  if (field === "leadType") {
    const parts = [eq(leads.leadType, exact), ilike(leads.leadType, exact)];
    if (slug) parts.push(normalizedLeadColumnEquals(leads.leadType, slug));
    return or(...parts)!;
  }

  const parts = [eq(leads.leadSource, exact), ilike(leads.leadSource, exact)];
  if (slug) {
    parts.push(
      normalizedLeadColumnEquals(leads.leadSource, slug),
      normalizedLeadColumnEquals(leads.leadType, slug)
    );
  }
  return or(...parts)!;
};

const buildWhereClause = (filters: LeadListFilters) => {
  const conditions: any[] = [];

  const searchTerm = filters.search?.trim();
  if (searchTerm && searchTerm.length >= 3) {
    const q = `%${searchTerm}%`;
    conditions.push(
      or(
        ilike(leads.fullName, q),
        ilike(leads.phone, q),
        ilike(leads.whatsapp, q),
        ilike(leads.email, q),
        ilike(leads.city, q),
        ilike(leads.externalLeadId, q),
        ilike(leads.leadType, q)
      )
    );
  }

  if (filters.assignmentStatus && !filters.assignedScope) {
    conditions.push(eq(leads.assignmentStatus, filters.assignmentStatus as any));
  }

  if (filters.reportBucket === "transferred") {
    const tf = filters.transferredFrom ?? filters.createdFrom;
    const tt = filters.transferredTo ?? filters.createdTo;
    conditions.push(
      sql`${transferOutcomeInPeriodSql(
        tf ? new Date(tf) : undefined,
        tt ? new Date(tt) : undefined
      )}`
    );
  } else if (filters.reportBucket === "contacted") {
    conditions.push(
      and(
        eq(leads.isJunk, false),
        or(
          eq(leads.progressStatus, "contacted"),
          eq(leads.progressStatus, "follow_up"),
          inArray(leads.assignmentStatus, ["transferred", "dropped", "converted"] as any[])
        )
      )
    );
  }

  if (filters.hasPendingFollowUp) {
    conditions.push(
      and(
        eq(leads.isJunk, false),
        sql`EXISTS (
          SELECT 1
          FROM lead_activities la
          WHERE la.lead_id = ${leads.id}
            AND la.activity_type = 'followup'
            AND la.status = 'pending'
        )`
      )
    );
  }

  if (filters.counsellorListFilter === "not_contacted") {
    conditions.push(
      and(
        eq(leads.isJunk, false),
        ne(leads.assignmentStatus, "converted"),
        ne(leads.assignmentStatus, "dropped"),
        eq(leads.progressStatus, "not_contacted")
      )
    );
  } else if (filters.counsellorListFilter === "in_progress") {
    conditions.push(
      and(
        eq(leads.isJunk, false),
        ne(leads.assignmentStatus, "converted"),
        ne(leads.assignmentStatus, "dropped"),
        ne(leads.progressStatus, "follow_up"),
        ne(leads.progressStatus, "converted"),
        ne(leads.progressStatus, "junk"),
        ne(leads.progressStatus, "not_contacted"),
        eq(leads.progressStatus, "contacted")
      )
    );
  } else if (filters.counsellorListFilter === "follow_up") {
    conditions.push(eq(leads.progressStatus, "follow_up"));
  } else if (filters.counsellorListFilter === "converted") {
    conditions.push(eq(leads.assignmentStatus, "converted"));
  } else if (filters.counsellorListFilter === "dropped") {
    conditions.push(eq(leads.assignmentStatus, "dropped"));
  } else if (filters.progressStatus === "contacted") {
    // Lead list "Contacted" should also include converted leads.
    conditions.push(
      or(
        eq(leads.progressStatus, "contacted"),
        eq(leads.assignmentStatus, "converted")
      )!
    );
  } else if (filters.progressStatus) {
    conditions.push(eq(leads.progressStatus, filters.progressStatus as any));
  }

  // Counsellor's own inbox hides closed leads unless a bucket filter, report mode, or assigned scope
  if (
    filters.counsellorOwnList &&
    !filters.counsellorListFilter &&
    !filters.forReport &&
    !filters.assignedScope
  ) {
    conditions.push(ne(leads.assignmentStatus, "converted"));
    conditions.push(ne(leads.assignmentStatus, "dropped"));
  }

  if (filters.eligibilityStatus) {
    conditions.push(eq(leads.eligibilityStatus, filters.eligibilityStatus as any));
  }

  if (filters.leadQuality) {
    conditions.push(eq(leads.leadQuality, filters.leadQuality as any));
  }

  if (filters.currentTelecallerId) {
    conditions.push(eq(leads.currentTelecallerId, filters.currentTelecallerId));
  }

  if (filters.withoutTelecaller) {
    conditions.push(isNull(leads.currentTelecallerId));
  } else if (filters.withTelecaller) {
    conditions.push(isNotNull(leads.currentTelecallerId));
  }

  if (filters.currentCounsellorId) {
    conditions.push(eq(leads.currentCounsellorId, filters.currentCounsellorId));
  }

  if (typeof filters.isJunk === "boolean") {
    conditions.push(eq(leads.isJunk, filters.isJunk));
  }

  if (filters.nextFollowupFrom) {
    conditions.push(gte(leads.nextFollowupAt, utcToIndianWallClock(new Date(filters.nextFollowupFrom))));
  }

  if (filters.nextFollowupTo) {
    conditions.push(lte(leads.nextFollowupAt, utcToIndianWallClock(new Date(filters.nextFollowupTo))));
  }

  if (filters.leadSource?.trim()) {
    conditions.push(buildLeadChannelFilter(filters.leadSource.trim()));
  }

  if (filters.leadType?.trim()) {
    conditions.push(buildLeadChannelFilter(filters.leadType.trim(), "leadType"));
  }

  const useConvertedPeriod =
    filters.assignmentStatus === "converted" &&
    Boolean(filters.convertedFrom || filters.convertedTo || (filters.forReport && filters.createdFrom));

  const useDroppedPeriod =
    filters.assignmentStatus === "dropped" &&
    Boolean(filters.droppedFrom || filters.droppedTo || (filters.forReport && filters.createdFrom));

  if (useConvertedPeriod) {
    const cf = filters.convertedFrom ?? filters.createdFrom;
    const ct = filters.convertedTo ?? filters.createdTo;
    if (cf) conditions.push(gte(leads.convertedAt, utcToIndianWallClock(new Date(cf))));
    if (ct) conditions.push(lte(leads.convertedAt, utcToIndianWallClock(new Date(ct))));
    conditions.push(isNotNull(leads.convertedAt));
  } else if (useDroppedPeriod) {
    const df = filters.droppedFrom ?? filters.createdFrom;
    const dt = filters.droppedTo ?? filters.createdTo;
    if (df) conditions.push(gte(leads.droppedAt, utcToIndianWallClock(new Date(df))));
    if (dt) conditions.push(lte(leads.droppedAt, utcToIndianWallClock(new Date(dt))));
    conditions.push(isNotNull(leads.droppedAt));
  } else if (filters.reportBucket !== "transferred") {
    // filters.createdFrom/To are already naive IST strings (e.g. "2026-06-08 00:00:00").
    // Passing them through new Date() on a UTC server shifts by +5:30 before utcToIndianWallClock
    // re-extracts IST parts, so we pass them directly as typed SQL literals.
    if (filters.createdFrom) {
      conditions.push(sql`${leads.createdAt} >= ${filters.createdFrom}::timestamp`);
    }
    if (filters.createdTo) {
      conditions.push(sql`${leads.createdAt} <= ${filters.createdTo}::timestamp`);
    }
  }

  if (
    (filters.transferredFrom || filters.transferredTo) &&
    filters.reportBucket !== "transferred"
  ) {
    conditions.push(
      sql`${transferredAtInPeriodSql(
        filters.transferredFrom ? new Date(filters.transferredFrom) : undefined,
        filters.transferredTo ? new Date(filters.transferredTo) : undefined
      )}`
    );
  }

  if (
    (filters.droppedFrom || filters.droppedTo) &&
    filters.reportBucket !== "transferred" &&
    !useDroppedPeriod
  ) {
    if (filters.droppedFrom) conditions.push(gte(leads.droppedAt, utcToIndianWallClock(new Date(filters.droppedFrom))));
    if (filters.droppedTo) conditions.push(lte(leads.droppedAt, utcToIndianWallClock(new Date(filters.droppedTo))));
    conditions.push(isNotNull(leads.droppedAt));
    conditions.push(eq(leads.assignmentStatus, "dropped"));
  }

  if (filters.metaLeadsOnly) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM facebook_lead fl WHERE fl.lead_id = ${leads.id})`
    );
  }

  if (typeof filters.sentToMeta === "boolean") {
    if (filters.sentToMeta) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM facebook_lead fl WHERE fl.lead_id = ${leads.id} AND fl.sent_to_meta = true)`
      );
    } else {
      conditions.push(
        sql`NOT EXISTS (SELECT 1 FROM facebook_lead fl WHERE fl.lead_id = ${leads.id} AND fl.sent_to_meta = true)`
      );
    }
  }

  if (typeof filters.hasQuality === "boolean") {
    if (filters.hasQuality) {
      conditions.push(isNotNull(leads.leadQuality));
    } else {
      conditions.push(isNull(leads.leadQuality));
    }
  }

  if (filters.excludeUnassigned) {
    conditions.push(ne(leads.assignmentStatus, "not_assigned"));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
};

const resolveSort = (sortBy?: LeadListFilters["sortBy"], sortOrder?: LeadListFilters["sortOrder"]) => {
  const order = sortOrder === "asc" ? asc : desc;
  if (sortBy === "updated_at") return order(leads.updatedAt);
  if (sortBy === "next_followup_at") return order(leads.nextFollowupAt);
  return order(leads.createdAt);
};

export const createLead = async (data: LeadInsert) => {
  const [created] = await db.insert(leads).values(data).returning();
  return serializeLeadTimestampsForApi(created);
};

export const getLeadById = async (id: number) => {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) return null;

  const userIds = [lead.currentTelecallerId, lead.currentCounsellorId].filter(
    (uid): uid is number => uid != null
  );

  let telecallerName: string | null = null;
  let counsellorName: string | null = null;

  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, userIds));

    const userMap = new Map(userRows.map((u) => [u.id, u.fullName]));

    telecallerName = lead.currentTelecallerId
      ? (userMap.get(lead.currentTelecallerId) ?? null)
      : null;

    counsellorName = lead.currentCounsellorId
      ? (userMap.get(lead.currentCounsellorId) ?? null)
      : null;
  }

  const facebookMeta = await getFacebookLeadMetaByLeadId(id);
  return serializeLeadTimestampsForApi({
    ...lead,
    telecallerName,
    counsellorName,
    ...(facebookMeta
      ? {
          facebookCreatedAt: facebookMeta.facebookCreatedAt,
          campaignId: facebookMeta.campaignId,
          campaignName: facebookMeta.campaignName,
          adsetId: facebookMeta.adsetId,
          adsetName: facebookMeta.adsetName,
          adId: facebookMeta.adId,
          adName: facebookMeta.adName,
          formId: facebookMeta.formId,
          formName: facebookMeta.formName,
          customAnswers: facebookMeta.customAnswers,
        }
      : {}),
  });
};

const enrichLeadsWithAssigneeNames = async <T extends {
  currentTelecallerId?: number | null;
  currentCounsellorId?: number | null;
}>(
  rows: T[]
): Promise<(T & { telecallerName: string | null; counsellorName: string | null })[]> => {
  const userIds = new Set<number>();
  for (const row of rows) {
    if (row.currentTelecallerId != null) userIds.add(row.currentTelecallerId);
    if (row.currentCounsellorId != null) userIds.add(row.currentCounsellorId);
  }
  if (userIds.size === 0) {
    return rows.map((row) => ({
      ...row,
      telecallerName: null,
      counsellorName: null,
    }));
  }
  const userRows = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  const nameMap = new Map(userRows.map((u) => [u.id, u.fullName]));
  return rows.map((row) => ({
    ...row,
    telecallerName: row.currentTelecallerId
      ? (nameMap.get(row.currentTelecallerId) ?? null)
      : null,
    counsellorName: row.currentCounsellorId
      ? (nameMap.get(row.currentCounsellorId) ?? null)
      : null,
  }));
};

const attachPendingFollowUpFlags = async <T extends { id: number }>(
  rows: T[]
): Promise<(T & { pendingFollowUp: boolean })[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const pendingRows = await db
    .select({ leadId: leadActivities.leadId })
    .from(leadActivities)
    .where(
      and(
        inArray(leadActivities.leadId, ids),
        eq(leadActivities.activityType, "followup"),
        eq(leadActivities.status, "pending")
      )
    );
  const pendingSet = new Set(pendingRows.map((r) => r.leadId));
  return rows.map((row) => ({
    ...row,
    pendingFollowUp: pendingSet.has(row.id),
  }));
};

const LEAD_LIST_MAX_LIMIT = 500;

export const listLeads = async (filters: LeadListFilters) => {
  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.min(LEAD_LIST_MAX_LIMIT, Math.max(1, Number(filters.limit || 50)));
  const offset = (page - 1) * limit;

  const whereClause = buildWhereClause(filters);
  const orderBy = resolveSort(filters.sortBy, filters.sortOrder);

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),

    db.select({ total: count() }).from(leads).where(whereClause),
  ]);

  const total = Number(totalResult[0]?.total || 0);
  const enriched = await enrichLeadsWithAssigneeNames(rows);
  const withPending = await attachPendingFollowUpFlags(enriched);
  const withReferences = await attachReferencesToLeadRows(withPending);

  // Attach sentToMeta when the query is scoped to Meta leads so the UI can display the status.
  let sentToMetaMap: Map<number, boolean> | null = null;
  const isMetaScoped =
    filters.metaLeadsOnly ||
    (filters.leadSource &&
      ["facebook", "instagram"].includes(filters.leadSource.toLowerCase()));
  if (isMetaScoped) {
    const ids = withReferences.map((r) => r.id);
    sentToMetaMap = await getFacebookLeadSentStatus(ids);
  }

  return {
    items: withReferences.map((row) =>
      serializeLeadTimestampsForApi({
        ...row,
        sentToMeta: sentToMetaMap ? (sentToMetaMap.get(row.id) ?? false) : undefined,
      })
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export type TelecallerLeadSummaryRow = {
  telecallerId: number;
  total: number;
  contacted: number;
  notContacted: number;
  transferred: number;
  converted: number;
  dropped: number;
  followUp: number;
  junk: number;
};

export const getTelecallerLeadSummaryRows = async (
  createdFrom?: Date,
  createdTo?: Date
): Promise<TelecallerLeadSummaryRow[]> => {
  const result = await db.execute(sql`
    SELECT
      current_telecaller_id::int AS "telecallerId",

      -- All counts use created_at for the period filter (current status of leads created in period)
      -- total = ALL leads including junk (raw assignment count)
      COUNT(*) FILTER (
        WHERE true
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "total",

      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'contacted' AND assignment_status = 'assigned'
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "contacted",

      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'not_contacted' AND assignment_status = 'assigned'
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "notContacted",

      -- Transferred = all 3 outcomes (transferred/converted/dropped); dropped requires counsellor assigned too
      COUNT(*) FILTER (
        WHERE NOT is_junk
        AND (
          assignment_status IN ('transferred', 'converted')
          OR (assignment_status = 'dropped' AND current_counsellor_id IS NOT NULL)
        )
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "transferred",

      COUNT(*) FILTER (
        WHERE NOT is_junk AND assignment_status = 'converted'
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "converted",

      COUNT(*) FILTER (
        WHERE NOT is_junk AND assignment_status = 'dropped' AND current_counsellor_id IS NOT NULL
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "dropped",

      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'follow_up' AND assignment_status = 'assigned'
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "followUp",

      COUNT(*) FILTER (
        WHERE (is_junk OR progress_status = 'junk')
        ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
        ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
      )::int AS "junk"

    FROM leads
    WHERE current_telecaller_id IS NOT NULL
    GROUP BY current_telecaller_id
  `);

  const raw = Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : ((result as { rows?: Record<string, unknown>[] }).rows ?? []);

  const num = (r: Record<string, unknown>, camel: string, snake: string) =>
    Number(r[camel] ?? r[snake] ?? 0);

  return raw.map((r) => ({
    telecallerId: Number(r.telecallerId ?? r.telecaller_id ?? 0),
    total: num(r, "total", "total"),
    contacted: num(r, "contacted", "contacted"),
    notContacted: num(r, "notContacted", "notcontacted"),
    transferred: num(r, "transferred", "transferred"),
    converted: num(r, "converted", "converted"),
    dropped: num(r, "dropped", "dropped"),
    followUp: num(r, "followUp", "followup"),
    junk: num(r, "junk", "junk"),
  }));
};

export const updateLeadById = async (id: number, patch: Partial<LeadInsert>) => {
  const [updated] = await db
    .update(leads)
    .set({ ...patch, updatedAt: getIndianNow() })
    .where(eq(leads.id, id))
    .returning();

  if (!updated) {
    throw new Error("Lead not found");
  }

  return serializeLeadTimestampsForApi(updated);
};

export const createLeadActivity = async (payload: ActivityInsert) => {
  const now = getIndianNow();
  const [created] = await db
    .insert(leadActivities)
    .values({
      ...payload,
      createdAt: payload.createdAt ?? now,
      updatedAt: payload.updatedAt ?? now,
    })
    .returning();
  return created;
};

export const getLeadActivities = async (leadId: number) => {
  return db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt));
};

export const getLeadActivitiesEnriched = async (leadId: number) => {
  const rows = await db
    .select({
      id: leadActivities.id,
      leadId: leadActivities.leadId,
      userId: leadActivities.userId,
      activityType: leadActivities.activityType,
      message: leadActivities.message,
      followupAt: leadActivities.followupAt,
      status: leadActivities.status,
      meta: leadActivities.meta,
      createdAt: leadActivities.createdAt,
      updatedAt: leadActivities.updatedAt,
      userName: users.fullName,
    })
    .from(leadActivities)
    .leftJoin(users, eq(leadActivities.userId, users.id))
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt));

  return rows.map((row) =>
    serializeLeadActivityTimestampsForApi({
      id: row.id,
      leadId: row.leadId,
      userId: row.userId,
      activityType: row.activityType,
      message: row.message,
      followupAt: row.followupAt,
      status: row.status,
      meta: row.meta ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userName: row.userName ?? null,
    })
  );
};

/** Concatenated note timeline per lead for list export (oldest first). */
export const getBulkLeadNotesForExport = async (
  leadIds: number[]
): Promise<Record<number, string>> => {
  if (leadIds.length === 0) return {};

  const rows = await db
    .select({
      leadId: leadActivities.leadId,
      message: leadActivities.message,
      createdAt: leadActivities.createdAt,
      userName: users.fullName,
    })
    .from(leadActivities)
    .leftJoin(users, eq(leadActivities.userId, users.id))
    .where(
      and(inArray(leadActivities.leadId, leadIds), eq(leadActivities.activityType, "note"))
    )
    .orderBy(asc(leadActivities.leadId), asc(leadActivities.createdAt));

  const out: Record<number, string> = {};
  for (const row of rows) {
    const msg = row.message?.trim();
    if (!msg) continue;
    const ts = row.createdAt
      ? new Date(row.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";
    const who = row.userName?.trim() || "Unknown";
    const line = ts ? `[${ts}] ${who}: ${msg}` : `${who}: ${msg}`;
    out[row.leadId] = out[row.leadId] ? `${out[row.leadId]}\n${line}` : line;
  }
  return out;
};

/** Pending follow-up activity not yet completed. */
export const hasPendingFollowUpForLead = async (leadId: number): Promise<boolean> => {
  const rows = await db
    .select({ id: leadActivities.id })
    .from(leadActivities)
    .where(
      and(
        eq(leadActivities.leadId, leadId),
        eq(leadActivities.activityType, "followup"),
        eq(leadActivities.status, "pending")
      )
    )
    .limit(1);
  return rows.length > 0;
};

/** Counsellor did follow-up / note / call after assignment (blocks telecaller re-transfer). */
export const hasCounsellorPostTransferActivity = async (leadId: number): Promise<boolean> => {
  const [lead] = await db
    .select({ currentCounsellorId: leads.currentCounsellorId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead?.currentCounsellorId) return false;

  const counsellorActs = await db
    .select({ id: leadActivities.id })
    .from(leadActivities)
    .where(
      and(
        eq(leadActivities.leadId, leadId),
        eq(leadActivities.userId, lead.currentCounsellorId),
        inArray(leadActivities.activityType, ["followup", "note", "call_log"])
      )
    )
    .limit(1);
  return counsellorActs.length > 0;
};

export type TelecallerSourceBreakdownRow = {
  leadSource: string;
  assigned: number;
  transferred: number;
  converted: number;
};

export type TelecallerDashboardStats = {
  assigned: number;
  uncontacted: number;
  contacted: number;
  transferred: number;
  converted: number;
  followUpsToday: number;
  followUpsInPeriod: number;
  categoryBreakdown: { leadType: string; count: number }[];
  sourceBreakdown: TelecallerSourceBreakdownRow[];
};

export const getTelecallerDashboardStats = async (
  telecallerId: number,
  createdFrom?: Date,
  createdTo?: Date,
  followupFrom?: Date,
  followupTo?: Date
): Promise<TelecallerDashboardStats> => {
  const baseWhere = and(
    eq(leads.currentTelecallerId, telecallerId),
    eq(leads.isJunk, false)
  );
  const { from: naiveFrom, to: naiveTo } = indianPeriodBounds(createdFrom, createdTo);
  const hasPeriod = Boolean(naiveFrom && naiveTo);
  const transferFilter = transferOutcomeInPeriodFilter(hasPeriod, createdFrom, createdTo);

  const [counts] = await db
    .select({
      assigned: hasPeriod
        ? sql<number>`COUNT(*) FILTER (WHERE ${leads.createdAt} >= ${createdFrom} AND ${leads.createdAt} <= ${createdTo})`
        : count(),
      uncontacted: hasPeriod
        ? sql<number>`COUNT(*) FILTER (WHERE ${leads.createdAt} >= ${createdFrom} AND ${leads.createdAt} <= ${createdTo} AND ${leads.progressStatus} = 'not_contacted')`
        : sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} = 'not_contacted')`,
      contacted: hasPeriod
        ? sql<number>`COUNT(*) FILTER (WHERE ${leads.createdAt} >= ${createdFrom} AND ${leads.createdAt} <= ${createdTo} AND ${leads.progressStatus} IN ('contacted', 'follow_up'))`
        : sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} IN ('contacted', 'follow_up'))`,
      transferred: sql<number>`COUNT(*) FILTER (WHERE ${transferFilter})`,
      converted: hasPeriod
        ? sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${naiveFrom} AND ${leads.convertedAt} <= ${naiveTo} AND ${leads.assignmentStatus} = 'converted')`
        : sql<number>`COUNT(*) FILTER (WHERE ${leads.assignmentStatus} = 'converted')`,
    })
    .from(leads)
    .where(baseWhere);

  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const followTodayBounds = indianPeriodBounds(
    new Date(`${todayYmd}T00:00:00.000+05:30`),
    new Date(`${todayYmd}T23:59:59.999+05:30`),
  );

  const [followToday] =
    followTodayBounds.from && followTodayBounds.to
      ? await db
          .select({ cnt: count() })
          .from(leads)
          .where(
            and(
              eq(leads.currentTelecallerId, telecallerId),
              eq(leads.isJunk, false),
              isNotNull(leads.nextFollowupAt),
              gte(leads.nextFollowupAt, followTodayBounds.from),
              lte(leads.nextFollowupAt, followTodayBounds.to)
            )
          )
      : [{ cnt: 0 }];

  let followInPeriod = 0;
  if (followupFrom && followupTo) {
    const { from: naiveFollowFrom, to: naiveFollowTo } = indianPeriodBounds(
      followupFrom,
      followupTo,
    );
    const [fp] = await db
      .select({ cnt: count() })
      .from(leads)
      .where(
        and(
          eq(leads.currentTelecallerId, telecallerId),
          eq(leads.isJunk, false),
          isNotNull(leads.nextFollowupAt),
          naiveFollowFrom ? gte(leads.nextFollowupAt, naiveFollowFrom) : undefined,
          naiveFollowTo ? lte(leads.nextFollowupAt, naiveFollowTo) : undefined,
        )
      );
    followInPeriod = Number(fp?.cnt ?? 0);
  }

  const catWhere = and(baseWhere, sql`${transferFilter}`);

  const catRows = await db
    .select({
      leadType: sql<string>`COALESCE(${leads.leadType}, 'Unknown')`,
      cnt: count(),
    })
    .from(leads)
    .where(catWhere)
    .groupBy(leads.leadType)
    .orderBy(desc(sql`count(*)`));

  const sourceRows = await db
    .select({
      leadSource: sql<string>`COALESCE(${leads.leadSource}, 'unknown')`,
      assigned: hasPeriod
        ? sql<number>`COUNT(*) FILTER (WHERE ${leads.createdAt} >= ${createdFrom} AND ${leads.createdAt} <= ${createdTo})`
        : count(),
      transferred: sql<number>`COUNT(*) FILTER (WHERE ${transferFilter})`,
      converted: hasPeriod
        ? sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${naiveFrom} AND ${leads.convertedAt} <= ${naiveTo} AND ${leads.assignmentStatus} = 'converted')`
        : sql<number>`COUNT(*) FILTER (WHERE ${leads.assignmentStatus} = 'converted')`,
    })
    .from(leads)
    .where(baseWhere)
    .groupBy(leads.leadSource)
    .orderBy(desc(sql`count(*)`));

  const num = (v: unknown) => Number(v ?? 0);

  return {
    assigned: num(counts?.assigned),
    uncontacted: num(counts?.uncontacted),
    contacted: num(counts?.contacted),
    transferred: num(counts?.transferred),
    converted: num(counts?.converted),
    followUpsToday: num(followToday?.cnt),
    followUpsInPeriod: followInPeriod,
    categoryBreakdown: catRows.map((r) => ({
      leadType: String(r.leadType ?? "Unknown"),
      count: num(r.cnt),
    })),
    sourceBreakdown: sourceRows.map((r) => ({
      leadSource: String(r.leadSource ?? "unknown"),
      assigned: num(r.assigned),
      transferred: num(r.transferred),
      converted: num(r.converted),
    })),
  };
};

export const getLeadReportSummary = async (params: {
  from?: string;
  to?: string;
  assigneeId?: number;
  status?: string;
}) => {
  const conditions: any[] = [];

  if (params.from) conditions.push(gte(leads.createdAt, new Date(params.from)));
  if (params.to) conditions.push(lte(leads.createdAt, new Date(params.to)));
  if (params.assigneeId) conditions.push(eq(leads.currentTelecallerId, params.assigneeId));
  if (params.status) conditions.push(eq(leads.progressStatus, params.status as any));

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [totals, statusRows] = await Promise.all([
    db
      .select({
        total: count(),

        notContacted: sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} = 'not_contacted')`,
        contacted: sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} = 'contacted')`,
        followUp: sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} = 'follow_up')`,
        converted: sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} = 'converted')`,
        junk: sql<number>`COUNT(*) FILTER (WHERE ${leads.progressStatus} = 'junk')`,

        eligible: sql<number>`COUNT(*) FILTER (WHERE ${leads.eligibilityStatus} = 'eligible')`,
        futureProspect: sql<number>`COUNT(*) FILTER (WHERE ${leads.eligibilityStatus} = 'future_prospect')`,

        excellent: sql<number>`COUNT(*) FILTER (WHERE ${leads.leadQuality} = 'excellent')`,
        good: sql<number>`COUNT(*) FILTER (WHERE ${leads.leadQuality} = 'good')`,
        average: sql<number>`COUNT(*) FILTER (WHERE ${leads.leadQuality} = 'average')`,
        bad: sql<number>`COUNT(*) FILTER (WHERE ${leads.leadQuality} = 'bad')`,
      })
      .from(leads)
      .where(whereClause),

    db
      .select({
        progressStatus: leads.progressStatus,
        count: count(),
      })
      .from(leads)
      .where(whereClause)
      .groupBy(leads.progressStatus),
  ]);

  return {
    totals: totals[0],
    byStatus: statusRows,
  };
};

export const updateLeadActivityMessage = async (activityId: number, message: string) => {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Note message is required");

  const [updated] = await db
    .update(leadActivities)
    .set({
      message: trimmed,
      updatedAt: getIndianNow(),
    })
    .where(eq(leadActivities.id, activityId))
    .returning();

  if (!updated) throw new Error("Activity not found");
  return updated;
};

export const updateActivityStatus = async (
  activityId: number,
  status: "pending" | "completed" | "cancelled",
  message?: string | null
) => {
  const patch: { status: typeof status; updatedAt: Date; message?: string } = {
    status,
    updatedAt: getIndianNow(),
  };
  if (message != null && String(message).trim()) {
    patch.message = String(message).trim();
  }

  const [updated] = await db
    .update(leadActivities)
    .set(patch)
    .where(eq(leadActivities.id, activityId))
    .returning();

  if (!updated) throw new Error("Activity not found");

  return updated;
};

export const getTelecallerLeaderboard = async () => {
  const rows = await db
    .select({
      telecallerId: leads.currentTelecallerId,
      fullName: users.fullName,
      totalAssigned: count(),

      qualified: sql<number>`
        COUNT(*) FILTER (
          WHERE ${leads.assignmentStatus} = 'transferred'
          OR ${leads.eligibilityStatus} = 'eligible'
          OR ${leads.progressStatus} IN ('follow_up', 'converted')
        )
      `,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.currentTelecallerId))
    .where(isNotNull(leads.currentTelecallerId))
    .groupBy(leads.currentTelecallerId, users.fullName)
    .orderBy(
      sql`
        COUNT(*) FILTER (
          WHERE ${leads.assignmentStatus} = 'transferred'
          OR ${leads.eligibilityStatus} = 'eligible'
          OR ${leads.progressStatus} IN ('follow_up', 'converted')
        ) DESC
      `,
      sql`COUNT(*) DESC`
    );

  return rows.map((r, idx) => ({
    rank: idx + 1,
    telecallerId: r.telecallerId,
    fullName: r.fullName ?? `Telecaller #${r.telecallerId}`,
    totalAssigned: Number(r.totalAssigned),
    qualified: Number(r.qualified),
  }));
};

export const getLeadsByIds = async (ids: number[]) => {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueIds.length) return [];
  return db.select().from(leads).where(inArray(leads.id, uniqueIds));
};

/** Map leads.lead_type (sale type label) → client_information.lead_type_id */
const resolveLeadTypeIdForClient = async (leadTypeLabel: string | null | undefined): Promise<number> => {
  const slug = normalizeLeadTypeSlug(leadTypeLabel);
  if (slug) {
    const [bySlug] = await db
      .select({ id: leadTypes.id })
      .from(leadTypes)
      .where(eq(leadTypes.leadType, slug))
      .limit(1);
    if (bySlug) return bySlug.id;
  }
  if (leadTypeLabel?.trim()) {
    const [byName] = await db
      .select({ id: leadTypes.id })
      .from(leadTypes)
      .where(ilike(leadTypes.leadType, leadTypeLabel.trim()))
      .limit(1);
    if (byName) return byName.id;
  }
  const [fallback] = await db
    .select({ id: leadTypes.id })
    .from(leadTypes)
    .where(eq(leadTypes.isArchived, false))
    .limit(1);
  if (!fallback) throw new Error("No lead type configured in the system");
  return fallback.id;
};

/** Counsellor converts lead → row in client_information (passport placeholder until collected). */
export const convertLeadToClient = async (leadId: number, counsellorId: number) => {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");
  if (lead.currentCounsellorId !== counsellorId) {
    throw new Error("You can only convert leads assigned to you");
  }
  if (lead.progressStatus === "converted" || lead.assignmentStatus === "converted") {
    throw new Error("Lead is already converted");
  }
  if (!lead.eligibilityStatus) {
    throw new Error("Set eligibility before converting to client");
  }
  if (!lead.leadQuality) {
    throw new Error("Set lead quality before converting to client");
  }
  const pendingFollowUp = await hasPendingFollowUpForLead(leadId);
  if (pendingFollowUp) {
    throw new Error("Complete the pending follow-up before converting to client");
  }

  // Validate and normalize name + city before conversion (throws LeadFieldValidationError on failure)
  const normalizedName = assertEnglishNameField(lead.fullName, "Full name", { required: true });
  assertLeadCityField(lead.city, { required: true });

  const now = getIndianNow();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const enrollmentDate = `${y}-${m}-${d}`;

  const [studentProfile] = await db
    .select({ passportNumber: leadStudentProfiles.passportNumber })
    .from(leadStudentProfiles)
    .where(eq(leadStudentProfiles.leadId, leadId))
    .limit(1);

  const phoneDigits = String(lead.phone || "").replace(/\D/g, "").slice(-8) || "00000000";
  const passportDetails =
    studentProfile?.passportNumber?.trim() || `LEAD-${leadId}-${phoneDigits}`;

  const leadTypeId = await resolveLeadTypeIdForClient(lead.leadSource);
  const client = await saveClient(
    {
      fullName: normalizedName,
      enrollmentDate,
      passportDetails,
      leadTypeId,
      convertedLeadId: leadId,
    },
    counsellorId
  );

  const [updated] = await db
    .update(leads)
    .set({
      fullName: normalizedName,
      progressStatus: "converted",
      assignmentStatus: "converted",
      convertedAt: now,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId))
    .returning();

  return {
    lead: serializeLeadTimestampsForApi(updated),
    client,
  };
};

/** Counsellor drops lead with mandatory reason (not junk — counsellors cannot mark junk). */
export const dropLeadByCounsellor = async (
  leadId: number,
  counsellorId: number,
  reason: string
) => {
  const trimmed = reason?.trim();
  if (!trimmed) throw new Error("Drop reason is required");

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");
  if (lead.currentCounsellorId !== counsellorId) {
    throw new Error("You can only drop leads assigned to you");
  }
  if (lead.progressStatus === "converted") {
    throw new Error("Converted leads cannot be dropped");
  }

  const now = getIndianNow();
  const [updated] = await db
    .update(leads)
    .set({
      assignmentStatus: "dropped",
      eligibilityStatus: "not_eligible",
      dropReason: trimmed,
      latestNote: `[DROP] ${trimmed}`,
      droppedAt: now,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId))
    .returning();

  const enriched = await getLeadById(leadId);
  if (!enriched) throw new Error("Lead not found after drop");
  return enriched;
};

/** Admin-only: restore junk lead and optionally assign it during restore. */
export const revertJunkLead = async (
  leadId: number,
  assignment?: {
    telecallerId?: number | null;
    counsellorId?: number | null;
    assignedBy?: number | null;
  }
) => {
  const [existing] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!existing) throw new Error("Lead not found");
  if (!existing.isJunk && existing.progressStatus !== "junk") {
    throw new Error("Only junk leads can be restored");
  }

  const [firstActivity] = await db
    .select({ id: leadActivities.id })
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(asc(leadActivities.createdAt))
    .limit(1);

  await db.delete(leadActivities).where(
    firstActivity
      ? and(eq(leadActivities.leadId, leadId), ne(leadActivities.id, firstActivity.id))
      : eq(leadActivities.leadId, leadId)
  );

  const now = getIndianNow();
  await db
    .update(leads)
    .set({
      isJunk: false,
      progressStatus: "not_contacted",
      assignmentStatus:
        assignment?.counsellorId != null
          ? "transferred"
          : assignment?.telecallerId != null
            ? "assigned"
            : "not_assigned",
      eligibilityStatus: null,
      leadQuality: null,
      currentTelecallerId: assignment?.counsellorId != null ? null : assignment?.telecallerId ?? null,
      currentCounsellorId: assignment?.counsellorId ?? null,
      assignedBy:
        assignment?.telecallerId != null || assignment?.counsellorId != null
          ? assignment?.assignedBy ?? null
          : null,
      nextFollowupAt: null,
      convertedAt: null,
      latestNote: null,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));

  const enriched = await getLeadById(leadId);
  if (!enriched) throw new Error("Lead not found after restore");
  return enriched;
};

export type LeadStructuredDetailsInput = {
  profile?: {
    gender?: string;
    dateOfBirth?: string;
    alternatePhone?: string;
    hasPassport?: boolean;
    passportNumber?: string | null;
    languageExamGiven?: boolean;
    visaRefusalDetails?: string;
    preferredCountry?: string;
    fieldOfInterest?: string;
  };
  education?: Array<{
    educationLevel?: string;
    schoolName?: string;
    specialization?: string;
    yearOfCompletion?: number;
    percentageOrCgpa?: string;
    numberOfBacklogs?: number;
  }>;
  languageScores?: Array<{
    examType?: string;
    listening?: number;
    reading?: number;
    writing?: number;
    speaking?: number;
    overallBand?: number;
  }>;
  familyMembers?: Array<{
    memberName?: string;
    phoneNumber?: string;
  }>;
};

export async function getLeadStructuredDetails(leadId: number) {
  const [profile, education, languageScores, familyMembers] = await Promise.all([
    db.select().from(leadStudentProfiles).where(eq(leadStudentProfiles.leadId, leadId)).limit(1),
    db.select().from(leadStudentEducation).where(eq(leadStudentEducation.leadId, leadId)),
    db.select().from(leadLanguageExamScores).where(eq(leadLanguageExamScores.leadId, leadId)),
    db.select().from(leadFamilyMembers).where(eq(leadFamilyMembers.leadId, leadId)),
  ]);
  return {
    profile: profile[0] ?? null,
    education,
    languageScores,
    familyMembers,
  };
}

export async function updateLeadStructuredDetails(leadId: number, input: LeadStructuredDetailsInput) {
  if (input.profile) {
    const profileData: Record<string, unknown> = { updatedAt: new Date() };
    const p = input.profile;
    if (p.gender !== undefined) profileData.gender = p.gender;
    if (p.dateOfBirth !== undefined) {
      profileData.dateOfBirth = normalizeDateOfBirthForDb(p.dateOfBirth);
    }
    if (p.alternatePhone !== undefined) profileData.alternatePhone = p.alternatePhone;
    if (p.hasPassport !== undefined) profileData.hasPassport = p.hasPassport;
    if (p.passportNumber !== undefined) profileData.passportNumber = p.passportNumber;
    if (p.languageExamGiven !== undefined) profileData.languageExamGiven = p.languageExamGiven;
    if (p.visaRefusalDetails !== undefined) profileData.visaRefusalDetails = p.visaRefusalDetails;
    if (p.preferredCountry !== undefined) profileData.preferredCountry = p.preferredCountry;
    if (p.fieldOfInterest !== undefined) profileData.fieldOfInterest = p.fieldOfInterest;

    const existing = await db
      .select({ id: leadStudentProfiles.id })
      .from(leadStudentProfiles)
      .where(eq(leadStudentProfiles.leadId, leadId))
      .limit(1);
    if (existing.length > 0) {
      await db.update(leadStudentProfiles).set(profileData as any).where(eq(leadStudentProfiles.leadId, leadId));
    } else {
      await db.insert(leadStudentProfiles).values({ leadId, ...(profileData as any) });
    }
  }

  if (input.education !== undefined) {
    await db.delete(leadStudentEducation).where(eq(leadStudentEducation.leadId, leadId));
    if (input.education.length > 0) {
      await db.insert(leadStudentEducation).values(
        input.education.map((e) => ({
          leadId,
          educationLevel: e.educationLevel ?? null,
          schoolName: e.schoolName ?? null,
          specialization: e.specialization ?? null,
          yearOfCompletion: e.yearOfCompletion ?? null,
          percentageOrCgpa: e.percentageOrCgpa ?? null,
          numberOfBacklogs: e.numberOfBacklogs ?? 0,
        }))
      );
    }
  }

  if (input.languageScores !== undefined) {
    await db.delete(leadLanguageExamScores).where(eq(leadLanguageExamScores.leadId, leadId));
    if (input.languageScores.length > 0) {
      await db.insert(leadLanguageExamScores).values(
        input.languageScores.map((s) => ({
          leadId,
          examType: s.examType ?? null,
          listening: s.listening?.toString() ?? null,
          reading: s.reading?.toString() ?? null,
          writing: s.writing?.toString() ?? null,
          speaking: s.speaking?.toString() ?? null,
          overallBand: s.overallBand?.toString() ?? null,
        }))
      );
    }
  }

  if (input.familyMembers !== undefined) {
    await db.delete(leadFamilyMembers).where(eq(leadFamilyMembers.leadId, leadId));
    if (input.familyMembers.length > 0) {
      await db.insert(leadFamilyMembers).values(
        input.familyMembers.map((f) => ({
          leadId,
          memberName: f.memberName ?? null,
          phoneNumber: f.phoneNumber ?? null,
        }))
      );
    }
  }

  return getLeadStructuredDetails(leadId);
}