import { and, count, desc, eq, gte, inArray, max, or, sql } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { facebookFormStrategy } from "../facebook_schemas/facebookFormStrategy.schema";
import { leads } from "../../schemas/leads.schema";
import { facebookLead } from "../facebook_schemas/facebookLead.schema";
import { users } from "../../../schemas/users.schema";
import { saleTypes } from "../../../schemas/saleType.schema";

type StrategyRow = typeof facebookFormStrategy.$inferSelect;
type StrategyInsert = typeof facebookFormStrategy.$inferInsert;
type RawResult = { rows?: unknown[] };

const getFirstRow = (result: unknown): any | null => {
  const rows = (result as RawResult)?.rows;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const getAllRows = (result: unknown): any[] => {
  const rows = (result as RawResult)?.rows;
  return Array.isArray(rows) ? rows : [];
};

const mapRow = (row: any): StrategyRow => ({
  id: Number(row.id),
  formId: row.form_id,
  formName: row.form_name ?? null,
  pageId: row.page_id ?? null,
  pageName: row.page_name ?? null,
  strategy: row.strategy ?? null,
  assignedTelecallers: row.assigned_telecallers ?? [],
  assignedCounsellors: row.assigned_counsellors ?? [],
  priorityWeights: row.priority_weights ?? {},
  isActive: row.is_active ?? false,
  isArchived: row.is_archived ?? false,
  isMasterManaged: row.is_master_managed ?? false,
  leadTypeId: row.lead_type_id != null ? Number(row.lead_type_id) : null,
  masterDistributionGroup: row.master_distribution_group ?? null,
  roundRobinIndex: Number(row.round_robin_index ?? 0),
  lastLeadCreatedTime: row.last_lead_created_time ?? null,
  createdBy: row.created_by ? Number(row.created_by) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const SELECT_COLS = sql`
  id, form_id, form_name, page_id, page_name, strategy,
  assigned_telecallers, assigned_counsellors, priority_weights,
  is_active, is_archived, is_master_managed, lead_type_id, master_distribution_group,
  round_robin_index, last_lead_created_time,
  created_by, created_at, updated_at
`;

export const CUSTOM_LEAD_TYPE_GROUP_PREFIX = "lt:";

export const parseCustomLeadTypeFromGroup = (
  group: string | null | undefined
): string | null => {
  if (!group || !group.startsWith(CUSTOM_LEAD_TYPE_GROUP_PREFIX)) return null;
  const name = group.slice(CUSTOM_LEAD_TYPE_GROUP_PREFIX.length).trim();
  return name || null;
};

export const customLeadTypeGroupKey = (label: string): string =>
  `${CUSTOM_LEAD_TYPE_GROUP_PREFIX}${label.trim().slice(0, 50)}`;

export const assertLeadTypeIdExists = async (leadTypeId: number): Promise<void> => {
  if (!Number.isFinite(leadTypeId) || leadTypeId <= 0) {
    throw new Error("LEAD_TYPE_REQUIRED");
  }
  const [row] = await db
    .select({ id: saleTypes.saleTypeId })
    .from(saleTypes)
    .where(eq(saleTypes.saleTypeId, leadTypeId))
    .limit(1);
  if (!row) throw new Error("LEAD_TYPE_INVALID");
};

/** Sale type label stored on `leads.lead_type` (matches Lead detail / sale-types UI). */
export const resolveLeadTypeLabelFromId = async (
  leadTypeId: number | null | undefined
): Promise<string | null> => {
  if (leadTypeId == null || !Number.isFinite(leadTypeId) || leadTypeId <= 0) return null;
  const [row] = await db
    .select({ saleType: saleTypes.saleType })
    .from(saleTypes)
    .where(eq(saleTypes.saleTypeId, leadTypeId))
    .limit(1);
  return row?.saleType ?? null;
};

export const applyLeadTypeLabelToFormLeads = async (
  formId: string,
  label: string
): Promise<void> => {
  const trimmed = label.trim();
  if (!trimmed) return;
  await db.execute(sql`
    UPDATE leads l
    SET lead_type = ${trimmed}, updated_at = NOW()
    FROM facebook_lead fl
    WHERE fl.lead_id = l.id AND fl.form_id = ${formId}
  `);
};

export const applyLeadTypeLabelToLeadIds = async (
  leadIds: number[],
  label: string
): Promise<void> => {
  if (leadIds.length === 0) return;
  const trimmed = label.trim();
  if (!trimmed) return;
  await db
    .update(leads)
    .set({ leadType: trimmed, updatedAt: new Date() })
    .where(inArray(leads.id, leadIds));
};

export const applyLeadTypeToFormLeads = async (
  formId: string,
  leadTypeId: number
): Promise<void> => {
  const label = await resolveLeadTypeLabelFromId(leadTypeId);
  if (!label) return;
  await applyLeadTypeLabelToFormLeads(formId, label);
};

export const applyLeadTypeToLeadIds = async (
  leadIds: number[],
  leadTypeId: number
): Promise<void> => {
  if (leadIds.length === 0) return;
  const label = await resolveLeadTypeLabelFromId(leadTypeId);
  if (!label) return;
  await applyLeadTypeLabelToLeadIds(leadIds, label);
};

export const masterDistributionGroupKey = (leadTypeId: number): string => String(leadTypeId);

export const upsertFormStrategy = async (data: StrategyInsert): Promise<StrategyRow> => {
  const result = await db.execute(sql`
    INSERT INTO facebook_form_strategy
      (form_id, form_name, page_id, page_name, strategy,
       assigned_telecallers, assigned_counsellors, priority_weights,
       lead_type_id, master_distribution_group,
       created_by, created_at, updated_at)
    VALUES (
      ${data.formId},
      ${data.formName ?? null},
      ${data.pageId ?? null},
      ${data.pageName ?? null},
      ${data.strategy ?? null},
      ${JSON.stringify(data.assignedTelecallers ?? [])}::jsonb,
      ${JSON.stringify(data.assignedCounsellors ?? [])}::jsonb,
      ${JSON.stringify(data.priorityWeights ?? {})}::jsonb,
      ${data.leadTypeId ?? null},
      ${data.masterDistributionGroup ?? null},
      ${data.createdBy ?? null},
      NOW(), NOW()
    )
    ON CONFLICT (form_id) DO UPDATE SET
      form_name             = EXCLUDED.form_name,
      page_id               = EXCLUDED.page_id,
      page_name             = EXCLUDED.page_name,
      strategy              = EXCLUDED.strategy,
      assigned_telecallers  = EXCLUDED.assigned_telecallers,
      assigned_counsellors  = EXCLUDED.assigned_counsellors,
      priority_weights      = EXCLUDED.priority_weights,
      lead_type_id          = EXCLUDED.lead_type_id,
      master_distribution_group = EXCLUDED.master_distribution_group,
      is_archived           = FALSE,
      updated_at            = NOW()
    RETURNING ${SELECT_COLS}
  `);
  const row = getFirstRow(result);
  if (!row) throw new Error("Upsert returned no row");
  return mapRow(row);
};

export const getFormStrategy = async (formId: string): Promise<StrategyRow | null> => {
  try {
    const result = await db.execute(sql`
      SELECT ${SELECT_COLS}
      FROM facebook_form_strategy
      WHERE form_id = ${formId}
      LIMIT 1
    `);
    const row = getFirstRow(result);
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
};

export const getFormStrategiesByPage = async (pageId: string): Promise<StrategyRow[]> => {
  const result = await db.execute(sql`
    SELECT ${SELECT_COLS}
    FROM facebook_form_strategy
    WHERE page_id = ${pageId}
    ORDER BY created_at ASC
  `);
  return getAllRows(result).map(mapRow);
};

export type SyncedFacebookForm = {
  id: string;
  name: string;
  archivedFromFb: boolean;
};

export const syncFormsForPage = async (
  pageId: string,
  liveForms: SyncedFacebookForm[],
  createdBy: number | null
): Promise<{ live: StrategyRow[]; archived: StrategyRow[] }> => {
  const liveIds = new Set(liveForms.map((f) => f.id));

  for (const form of liveForms) {
    const archivedFromFb = form.archivedFromFb;
    await db.execute(sql`
      INSERT INTO facebook_form_strategy
        (form_id, form_name, page_id, strategy, assigned_telecallers, assigned_counsellors,
         priority_weights, is_active, is_archived, created_by, created_at, updated_at)
      VALUES (
        ${form.id}, ${form.name}, ${pageId}, NULL,
        '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        FALSE, ${archivedFromFb},
        ${createdBy}, NOW(), NOW()
      )
      ON CONFLICT (form_id) DO UPDATE SET
        form_name  = CASE
          WHEN facebook_form_strategy.form_name IS DISTINCT FROM EXCLUDED.form_name
          THEN EXCLUDED.form_name
          ELSE facebook_form_strategy.form_name
        END,
        is_archived = EXCLUDED.is_archived,
        is_active = CASE
          WHEN EXCLUDED.is_archived THEN FALSE
          ELSE facebook_form_strategy.is_active
        END,
        updated_at = NOW()
    `);
  }

  const existing = await db
    .select({ formId: facebookFormStrategy.formId })
    .from(facebookFormStrategy)
    .where(eq(facebookFormStrategy.pageId, pageId));

  const toArchive = existing
    .map((r) => r.formId)
    .filter((id) => !liveIds.has(id));

  if (toArchive.length > 0) {
    await db
      .update(facebookFormStrategy)
      .set({ isArchived: true, isActive: false, updatedAt: new Date() })
      .where(inArray(facebookFormStrategy.formId, toArchive));
  }

  const allResult = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM facebook_form_strategy WHERE page_id = ${pageId} ORDER BY created_at ASC
  `);
  const all = getAllRows(allResult).map(mapRow);
  return {
    live: all.filter((r) => !r.isArchived),
    archived: all.filter((r) => r.isArchived),
  };
};

export const listActiveFormStrategies = async (): Promise<StrategyRow[]> => {
  const result = await db.execute(sql`
    SELECT ${SELECT_COLS}
    FROM facebook_form_strategy
    WHERE is_active = TRUE AND is_archived = FALSE
  `);
  return getAllRows(result).map(mapRow);
};

export const getMasterManagedForms = async (): Promise<StrategyRow[]> => {
  const result = await db.execute(sql`
    SELECT ${SELECT_COLS}
    FROM facebook_form_strategy
    WHERE is_master_managed = TRUE AND is_archived = FALSE
  `);
  return getAllRows(result).map(mapRow);
};

export const setMasterManaged = async (
  formId: string,
  isMasterManaged: boolean,
  masterDistributionGroup?: string | null
): Promise<void> => {
  if (isMasterManaged) {
    await db.execute(sql`
      UPDATE facebook_form_strategy
      SET is_master_managed = TRUE,
          master_distribution_group = ${masterDistributionGroup ?? null},
          updated_at = NOW()
      WHERE form_id = ${formId}
    `);
    return;
  }
  await db.execute(sql`
    UPDATE facebook_form_strategy
    SET is_master_managed = FALSE,
        master_distribution_group = NULL,
        updated_at = NOW()
    WHERE form_id = ${formId}
  `);
};

export const detachFormFromMasterDistribution = async (formId: string): Promise<void> => {
  await db.execute(sql`
    UPDATE facebook_form_strategy
    SET is_master_managed = FALSE,
        master_distribution_group = NULL,
        is_active = FALSE,
        updated_at = NOW()
    WHERE form_id = ${formId}
  `);
};

export type MasterDistributionGroupSummary = {
  masterDistributionGroup: string;
  leadTypeId: number | null;
  saleTypeName: string | null;
  isActive: boolean;
  formIds: string[];
  strategy: string | null;
  assignedTelecallers: number[];
  assignedCounsellors: number[];
  priorityWeights: Record<string, number>;
};

const resolveMasterGroupKey = (row: StrategyRow): string | null => {
  if (row.masterDistributionGroup) return row.masterDistributionGroup;
  if (row.leadTypeId != null) return String(row.leadTypeId);
  return null;
};

export const getMasterDistributionGroupsByPage = async (
  pageId: string
): Promise<MasterDistributionGroupSummary[]> => {
  const rows = await getFormStrategiesByPage(pageId);
  const masterRows = rows.filter((r) => r.isMasterManaged);
  const groupMap = new Map<string, StrategyRow[]>();

  for (const r of masterRows) {
    const key = resolveMasterGroupKey(r);
    if (!key) continue;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(r);
  }

  const leadTypeIds = [
    ...new Set(masterRows.map((r) => r.leadTypeId).filter((n): n is number => n != null)),
  ];
  const saleTypeMap = new Map<number, string>();
  if (leadTypeIds.length > 0) {
    const stRows = await db
      .select({ id: saleTypes.saleTypeId, name: saleTypes.saleType })
      .from(saleTypes)
      .where(inArray(saleTypes.saleTypeId, leadTypeIds));
    for (const s of stRows) saleTypeMap.set(s.id, s.name);
  }

  const summaries: MasterDistributionGroupSummary[] = [];
  for (const [groupKey, forms] of groupMap) {
    const first = forms.find((f) => f.isActive) ?? forms[0];
    const customName = parseCustomLeadTypeFromGroup(groupKey);
    const leadTypeId = customName
      ? null
      : first.leadTypeId ?? (Number.isFinite(Number(groupKey)) ? Number(groupKey) : null);
    summaries.push({
      masterDistributionGroup: groupKey,
      leadTypeId,
      saleTypeName:
        customName ?? (leadTypeId != null ? saleTypeMap.get(leadTypeId) ?? null : null),
      isActive: forms.some((f) => f.isActive),
      formIds: forms.map((f) => f.formId),
      strategy: first.strategy,
      assignedTelecallers: first.assignedTelecallers ?? [],
      assignedCounsellors: first.assignedCounsellors ?? [],
      priorityWeights: first.priorityWeights ?? {},
    });
  }

  return summaries.sort((a, b) => (a.saleTypeName || a.masterDistributionGroup).localeCompare(b.saleTypeName || b.masterDistributionGroup));
};

export const clearMasterDistributionGroup = async (
  pageId: string,
  groupKey: string
): Promise<string[]> => {
  const rows = await getFormStrategiesByPage(pageId);
  const toClear = rows.filter((r) => r.isMasterManaged && resolveMasterGroupKey(r) === groupKey);
  for (const r of toClear) {
    await detachFormFromMasterDistribution(r.formId);
  }
  return toClear.map((r) => r.formId);
};

export const setMasterManagedBatch = async (formIds: string[], isMasterManaged: boolean): Promise<void> => {
  if (formIds.length === 0) return;
  await db
    .update(facebookFormStrategy)
    .set({ isMasterManaged, updatedAt: new Date() })
    .where(inArray(facebookFormStrategy.formId, formIds));
};

export const updateFormActiveStatus = async (formId: string, isActive: boolean): Promise<void> => {
  await db.execute(sql`
    UPDATE facebook_form_strategy
    SET is_active = ${isActive}, updated_at = NOW()
    WHERE form_id = ${formId}
  `);
};

export const touchLastLeadCreatedTime = async (
  formId: string,
  leadCreatedAt: Date
): Promise<void> => {
  await db.execute(sql`
    UPDATE facebook_form_strategy
    SET
      last_lead_created_time = CASE
        WHEN last_lead_created_time IS NULL OR last_lead_created_time < ${leadCreatedAt}
          THEN ${leadCreatedAt}
        ELSE last_lead_created_time
      END,
      updated_at = NOW()
    WHERE form_id = ${formId}
  `);
};

/** After manual assign: advance last_lead_created_time only up to max Meta time among those leads (never regress). */
export const syncLastLeadCreatedAfterManualDistribution = async (
  formId: string,
  leadIds: number[]
): Promise<void> => {
  if (leadIds.length === 0) return;
  const agg = await db
    .select({ maxFb: max(facebookLead.facebookCreatedAt) })
    .from(facebookLead)
    .where(and(eq(facebookLead.formId, formId), inArray(facebookLead.leadId, leadIds)));
  const maxFb = agg[0]?.maxFb;
  if (maxFb instanceof Date && Number.isFinite(maxFb.getTime())) {
    await touchLastLeadCreatedTime(formId, maxFb);
  }
};

// ── Per-form stats ───────────────────────────────────────────────────────────

export const getFormStats = async (formId: string) => {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (
        WHERE current_telecaller_id IS NOT NULL OR current_counsellor_id IS NOT NULL
      )::int AS distributed_leads,
      COUNT(*) FILTER (
        WHERE current_telecaller_id IS NULL AND current_counsellor_id IS NULL
      )::int AS unassigned_leads
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    WHERE fl.form_id = ${formId}
  `);
  const row = getFirstRow(result);
  return {
    totalLeads: Number(row?.total_leads ?? 0),
    distributedLeads: Number(row?.distributed_leads ?? 0),
    unassignedLeads: Number(row?.unassigned_leads ?? 0),
  };
};

export const getFormStatsBulk = async (formIds: string[]): Promise<Record<string, { totalLeads: number; distributedLeads: number; unassignedLeads: number }>> => {
  if (formIds.length === 0) return {};
  const result = await db.execute(sql`
    SELECT
      form_id,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (
        WHERE current_telecaller_id IS NOT NULL OR current_counsellor_id IS NOT NULL
      )::int AS distributed_leads,
      COUNT(*) FILTER (
        WHERE current_telecaller_id IS NULL AND current_counsellor_id IS NULL
      )::int AS unassigned_leads
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    WHERE fl.form_id = ANY(${sql.raw(`ARRAY[${formIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]`)}::text[])
    GROUP BY fl.form_id
  `);
  const map: Record<string, { totalLeads: number; distributedLeads: number; unassignedLeads: number }> = {};
  for (const row of getAllRows(result)) {
    map[String(row.form_id)] = {
      totalLeads: Number(row.total_leads ?? 0),
      distributedLeads: Number(row.distributed_leads ?? 0),
      unassignedLeads: Number(row.unassigned_leads ?? 0),
    };
  }
  return map;
};

// ── Paginated leads for a form ───────────────────────────────────────────────

export const getFormLeadsPaginated = async (
  formId: string,
  page: number,
  limit: number,
  filter: "all" | "unassigned"
) => {
  const offset = (page - 1) * limit;
  const filterClause =
    filter === "unassigned"
      ? sql`AND l.current_telecaller_id IS NULL AND l.current_counsellor_id IS NULL`
      : sql``;

  const dataResult = await db.execute(sql`
    SELECT
      l.id, l.external_lead_id, l.full_name, l.phone, l.email, l.city,
      l.assignment_status, l.progress_status, l.created_at, l.updated_at,
      fl.campaign_name, fl.ad_name, fl.form_name, l.latest_note,
      l.current_telecaller_id, l.current_counsellor_id,
      fl.custom_answers,
      tc.full_name AS telecaller_name,
      co.full_name AS counsellor_name
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    LEFT JOIN users tc ON tc.id = l.current_telecaller_id
    LEFT JOIN users co ON co.id = l.current_counsellor_id
    WHERE fl.form_id = ${formId}
    ${filterClause}
    ORDER BY l.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    WHERE fl.form_id = ${formId}
    ${filterClause}
  `);

  const total = Number(getFirstRow(countResult)?.total ?? 0);
  const rows = getAllRows(dataResult).map((r: any) => ({
    id: Number(r.id),
    externalLeadId: r.external_lead_id,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email,
    city: r.city,
    assignmentStatus: r.assignment_status,
    progressStatus: r.progress_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    campaignName: r.campaign_name,
    adName: r.ad_name,
    formName: r.form_name,
    latestNote: r.latest_note,
    currentTelecallerId: r.current_telecaller_id ? Number(r.current_telecaller_id) : null,
    currentCounsellorId: r.current_counsellor_id ? Number(r.current_counsellor_id) : null,
    telecallerName: r.telecaller_name ?? null,
    counsellorName: r.counsellor_name ?? null,
    customAnswers: r.custom_answers ?? {},
  }));

  return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
};

// ── CSV export helper ────────────────────────────────────────────────────────

export const getFormLeadsForExport = async (formId: string) => {
  const result = await db.execute(sql`
    SELECT
      l.full_name, l.phone, l.email, l.city,
      l.assignment_status, l.progress_status, l.created_at,
      fl.campaign_name, fl.ad_name, fl.form_name,
      l.external_lead_id, l.latest_note,
      l.current_telecaller_id, l.current_counsellor_id,
      fl.custom_answers,
      tc.full_name AS telecaller_name,
      co.full_name AS counsellor_name
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    LEFT JOIN users tc ON tc.id = l.current_telecaller_id
    LEFT JOIN users co ON co.id = l.current_counsellor_id
    WHERE fl.form_id = ${formId}
    ORDER BY l.created_at DESC
  `);
  return getAllRows(result);
};

// ── Forms that still have unassigned Facebook / Instagram leads — manual distribution form picker

export const getFormsWithUnassignedLeads = async (): Promise<{ formId: string; formName: string | null }[]> => {
  const result = await db.execute(sql`
    SELECT DISTINCT fl.form_id, ffs.form_name
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    LEFT JOIN facebook_form_strategy ffs ON ffs.form_id = fl.form_id
    WHERE (l.lead_source = 'instagram' OR l.lead_source = 'facebook')
      AND fl.form_id IS NOT NULL
      AND l.current_telecaller_id IS NULL
      AND l.current_counsellor_id IS NULL
    ORDER BY ffs.form_name ASC NULLS LAST
  `);
  return getAllRows(result).map((r: any) => ({
    formId: String(r.form_id),
    formName: r.form_name ?? null,
  }));
};

// ── Assignment strategies ────────────────────────────────────────────────────

const pickWeightedRandom = (pool: number[], weights: Record<string, number>): number | null => {
  if (pool.length === 0) return null;
  const expanded: number[] = [];
  for (const id of pool) {
    const w = Math.max(1, Math.min(99, weights[String(id)] ?? 1));
    for (let i = 0; i < w; i++) expanded.push(id);
  }
  return expanded[Math.floor(Math.random() * expanded.length)] ?? null;
};

const pickLeastLoaded = async (pool: number[]): Promise<number | null> => {
  if (pool.length === 0) return null;
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );

  const rows = await db
    .select({ uid: leads.currentTelecallerId, c: count() })
    .from(leads)
    .where(
      and(
        inArray(leads.currentTelecallerId, pool),
        gte(leads.createdAt, todayStart)
      )
    )
    .groupBy(leads.currentTelecallerId);

  const countMap = new Map(rows.map((r) => [r.uid!, Number(r.c)]));

  let best = pool[0];
  let bestCount = countMap.get(pool[0]) ?? 0;
  for (const id of pool.slice(1)) {
    const c = countMap.get(id) ?? 0;
    if (c < bestCount) {
      bestCount = c;
      best = id;
    }
  }
  return best;
};

const pickRoundRobin = async (row: StrategyRow, allPool: number[]): Promise<number | null> => {
  const total = allPool.length;
  if (total === 0) return null;

  const result = await db.execute(sql`
    UPDATE facebook_form_strategy
    SET round_robin_index = (round_robin_index + 1) % ${total}
    WHERE form_id = ${row.formId}
    RETURNING round_robin_index AS new_index
  `);
  const newIndex = Number(getFirstRow(result)?.new_index ?? 0);
  const usedIndex = ((newIndex - 1) % total + total) % total;
  return allPool[usedIndex] ?? null;
};

export const pickNextAssignee = async (
  row: StrategyRow
): Promise<{ userId: number; role: "telecaller" | "counsellor" } | null> => {
  const tcPool = (row.assignedTelecallers ?? []).filter(Number.isFinite);
  const coPool = (row.assignedCounsellors ?? []).filter(Number.isFinite);
  const allPool = [...tcPool, ...coPool];
  if (allPool.length === 0) return null;

  const userRoles = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.id, allPool));
  const roleMap = new Map(userRoles.map((u) => [u.id, u.role as string]));

  if (!row.strategy) return null;

  let pickedId: number | null = null;

  switch (row.strategy) {
    case "round_robin":
    case "performance_based":
      pickedId = await pickRoundRobin(row, allPool);
      break;
    case "least_loaded":
      pickedId = await pickLeastLoaded(tcPool.length > 0 ? tcPool : allPool);
      break;
    case "priority_weighted":
      pickedId = pickWeightedRandom(allPool, row.priorityWeights ?? {});
      break;
    default:
      pickedId = allPool[0] ?? null;
  }

  if (!pickedId) return null;
  const role = roleMap.get(pickedId) === "counsellor" ? "counsellor" : "telecaller";
  return { userId: pickedId, role };
};

// ── Manual distribution ──────────────────────────────────────────────────────

const getLeadIdsForFormOrderedByFacebookCreatedDesc = async (
  formId: string,
  leadIds: number[]
): Promise<number[]> => {
  if (leadIds.length === 0) return [];
  const rows = await db
    .select({ id: leads.id, fb: facebookLead.facebookCreatedAt })
    .from(leads)
    .innerJoin(facebookLead, eq(facebookLead.leadId, leads.id))
    .where(and(eq(facebookLead.formId, formId), inArray(leads.id, leadIds)));
  return rows
    .filter((r) => r.fb != null)
    .sort((a, b) => b.fb!.getTime() - a.fb!.getTime())
    .map((r) => r.id);
};

export type ResolvedLeadTypeForDistribution = {
  leadTypeId: number | null;
  label: string;
  masterDistributionGroup: string | null;
};

export const distributeLeadsManually = async (
  formId: string,
  leadIds: number[],
  strategy: string,
  assignedTelecallers: number[],
  assignedCounsellors: number[],
  priorityWeights: Record<string, number>,
  leadType: ResolvedLeadTypeForDistribution
): Promise<{
  distributed: number;
  assignments: { leadId: number; userId: number; role: string }[];
  byForm: { formId: string; distributed: number; assignments: { leadId: number; userId: number; role: string }[] }[];
}> => {
  const allPool = [...assignedTelecallers, ...assignedCounsellors];
  if (allPool.length === 0 || leadIds.length === 0) {
    return { distributed: 0, assignments: [], byForm: [] };
  }

  await db.execute(sql`
    UPDATE facebook_form_strategy
    SET lead_type_id = ${leadType.leadTypeId},
        master_distribution_group = ${leadType.masterDistributionGroup},
        updated_at = NOW()
    WHERE form_id = ${formId}
  `);

  const sortedLeadIds = await getLeadIdsForFormOrderedByFacebookCreatedDesc(formId, leadIds);
  if (sortedLeadIds.length === 0) {
    return { distributed: 0, assignments: [], byForm: [] };
  }

  await applyLeadTypeLabelToLeadIds(sortedLeadIds, leadType.label);

  const userRoles = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.id, allPool));
  const roleMap = new Map(userRoles.map((u) => [u.id, u.role as string]));

  const assignments: { leadId: number; userId: number; role: string }[] = [];
  let rrIndex = 0;

  for (const leadId of sortedLeadIds) {
    let pickedId: number | null = null;

    if (strategy === "round_robin" || strategy === "performance_based") {
      pickedId = allPool[rrIndex % allPool.length] ?? null;
      rrIndex++;
    } else if (strategy === "least_loaded") {
      pickedId = await pickLeastLoaded(
        assignedTelecallers.length > 0 ? assignedTelecallers : allPool
      );
    } else if (strategy === "priority_weighted") {
      pickedId = pickWeightedRandom(allPool, priorityWeights);
    } else {
      pickedId = allPool[rrIndex % allPool.length] ?? null;
      rrIndex++;
    }

    if (!pickedId) continue;
    const role = roleMap.get(pickedId) === "counsellor" ? "counsellor" : "telecaller";

    if (role === "telecaller") {
      await db.execute(sql`
        UPDATE leads
        SET current_telecaller_id = ${pickedId},
            current_counsellor_id = NULL,
            assignment_status = 'assigned',
            updated_at = NOW()
        WHERE id = ${leadId}
      `);
    } else {
      await db.execute(sql`
        UPDATE leads
        SET current_counsellor_id = ${pickedId},
            current_telecaller_id = NULL,
            assignment_status = 'assigned',
            updated_at = NOW()
        WHERE id = ${leadId}
      `);
    }

    assignments.push({ leadId, userId: pickedId, role });
  }

  const assignedIds = assignments.map((a) => a.leadId);
  if (assignedIds.length > 0) {
    await syncLastLeadCreatedAfterManualDistribution(formId, assignedIds);
  }

  return {
    distributed: assignments.length,
    assignments,
    byForm: [{ formId, distributed: assignments.length, assignments }],
  };
};

export type ManualBulkByForm = {
  formId: string;
  distributed: number;
  assignments: { leadId: number; userId: number; role: string }[];
};

/** Group bulk manual IDs by form_id and distribute each form separately (strategy / RR per form). */
export const distributeLeadsManuallyBulkAcrossForms = async (
  leadIds: number[],
  strategy: string,
  assignedTelecallers: number[],
  assignedCounsellors: number[],
  priorityWeights: Record<string, number>,
  leadType: ResolvedLeadTypeForDistribution
): Promise<{
  distributed: number;
  assignments: { leadId: number; userId: number; role: string; formId: string }[];
  byForm: ManualBulkByForm[];
}> => {
  const unique = [...new Set(leadIds.map(Number).filter((n) => Number.isFinite(n)))];
  if (unique.length === 0) {
    return { distributed: 0, assignments: [], byForm: [] };
  }

  const rows = await db
    .select({ id: leads.id, formId: facebookLead.formId })
    .from(leads)
    .innerJoin(facebookLead, eq(facebookLead.leadId, leads.id))
    .where(inArray(leads.id, unique));

  const byFormIds = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.formId) continue;
    const fid = String(r.formId);
    if (!byFormIds.has(fid)) byFormIds.set(fid, []);
    byFormIds.get(fid)!.push(r.id);
  }

  const allAssignments: { leadId: number; userId: number; role: string; formId: string }[] = [];
  const byForm: ManualBulkByForm[] = [];

  for (const fid of [...byFormIds.keys()].sort()) {
    const ids = byFormIds.get(fid)!;
    if (ids.length === 0) continue;
    const r = await distributeLeadsManually(
      fid,
      ids,
      strategy,
      assignedTelecallers,
      assignedCounsellors,
      priorityWeights,
      leadType
    );
    byForm.push({ formId: fid, distributed: r.distributed, assignments: r.assignments });
    for (const a of r.assignments) {
      allAssignments.push({ ...a, formId: fid });
    }
  }

  return { distributed: allAssignments.length, assignments: allAssignments, byForm };
};

export type FacebookManualAssignmentFilter = "assigned" | "unassigned" | "all";

export const ensureFacebookLeadsEligibleForInactiveManualBulk = async (
  leadIds: number[]
): Promise<void> => {
  if (leadIds.length === 0) return;
  const unique = [...new Set(leadIds)];
  const rows = await db
    .select({
      id: leads.id,
      formId: facebookLead.formId,
      leadSource: leads.leadSource,
    })
    .from(leads)
    .innerJoin(facebookLead, eq(facebookLead.leadId, leads.id))
    .where(inArray(leads.id, unique));

  if (rows.length !== unique.length) {
    throw new Error("FACEBOOK_MANUAL_DIST_NON_FB_LEADS");
  }

  const isFbSource = (src: string | null) => src === "instagram" || src === "facebook";
  if (rows.some((r) => !isFbSource(r.leadSource))) {
    throw new Error("FACEBOOK_MANUAL_DIST_NON_FB_LEADS");
  }

  const formIds = [...new Set(rows.map((r) => r.formId).filter(Boolean))] as string[];
  if (formIds.length === 0) {
    throw new Error("FACEBOOK_MANUAL_DIST_NO_FORM");
  }
  for (const fid of formIds) {
    const s = await getFormStrategy(fid);
    if (!s) throw new Error(`FACEBOOK_MANUAL_DIST_NO_STRATEGY:${fid}`);
    if (s.isActive) throw new Error(`FACEBOOK_MANUAL_DIST_FORM_ACTIVE:${fid}`);
  }
};

export type FacebookManualPagedLeadRow = {
  id: number;
  formId: string | null;
  formName: string | null;
  externalLeadId: string | null;
  fullName: string;
  phone: string;
  email: string | null;
  city: string | null;
  assignmentStatus: string;
  progressStatus: string;
  createdAt: Date;
  facebookCreatedAt: Date;
  currentTelecallerId: number | null;
  currentCounsellorId: number | null;
  telecallerName: string | null;
  counsellorName: string | null;
};

export const getFacebookManualDistributionLeadRowsPaginated = async (opts: {
  page: number;
  limit: number;
  assignment: FacebookManualAssignmentFilter;
  formId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}): Promise<{
  data: FacebookManualPagedLeadRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const page = Math.max(1, opts.page);
  const limit = Math.min(500, Math.max(1, opts.limit));
  const offset = (page - 1) * limit;

  let assignmentClause = sql``;
  if (opts.assignment === "assigned") {
    assignmentClause = sql`
      AND (
        l.current_telecaller_id IS NOT NULL OR l.current_counsellor_id IS NOT NULL
      )
    `;
  } else if (opts.assignment === "unassigned") {
    assignmentClause = sql`
      AND l.current_telecaller_id IS NULL AND l.current_counsellor_id IS NULL
    `;
  }

  let formClause = sql``;
  if (opts.formId) formClause = sql`AND fl.form_id = ${opts.formId}`;

  let dateClause = sql``;
  if (opts.createdFrom && opts.createdTo) {
    dateClause = sql`
      AND l.created_at >= ${opts.createdFrom}
      AND l.created_at <= ${opts.createdTo}
    `;
  }

  const dataResult = await db.execute(sql`
    SELECT
      l.id, fl.form_id, l.external_lead_id, l.full_name, l.phone, l.email, l.city,
      l.assignment_status, l.progress_status, l.created_at, fl.facebook_created_at,
      l.current_telecaller_id, l.current_counsellor_id, fl.form_name,
      tc.full_name AS telecaller_name,
      co.full_name AS counsellor_name
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    LEFT JOIN users tc ON tc.id = l.current_telecaller_id
    LEFT JOIN users co ON co.id = l.current_counsellor_id
    WHERE (l.lead_source = 'instagram' OR l.lead_source = 'facebook')
      AND fl.form_id IS NOT NULL
      ${formClause}
      ${assignmentClause}
      ${dateClause}
    ORDER BY fl.facebook_created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM leads l
    INNER JOIN facebook_lead fl ON fl.lead_id = l.id
    WHERE (l.lead_source = 'instagram' OR l.lead_source = 'facebook')
      AND fl.form_id IS NOT NULL
      ${formClause}
      ${assignmentClause}
      ${dateClause}
  `);

  const total = Number(getFirstRow(countResult)?.total ?? 0);
  const data: FacebookManualPagedLeadRow[] = getAllRows(dataResult).map((r: any) => ({
    id: Number(r.id),
    formId: r.form_id ?? null,
    formName: r.form_name ?? null,
    externalLeadId: r.external_lead_id ?? null,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email ?? null,
    city: r.city ?? null,
    assignmentStatus: r.assignment_status,
    progressStatus: r.progress_status,
    createdAt: r.created_at,
    facebookCreatedAt: r.facebook_created_at,
    currentTelecallerId: r.current_telecaller_id ? Number(r.current_telecaller_id) : null,
    currentCounsellorId: r.current_counsellor_id ? Number(r.current_counsellor_id) : null,
    telecallerName: r.telecaller_name ?? null,
    counsellorName: r.counsellor_name ?? null,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

export type FacebookManualAssigneeStatRow = {
  assigneeId: number;
  assigneeName: string;
  role: string;
  totalAssigned: number;
  transferredLeads: number;
};

// export const getFacebookManualDistributionAssigneeStats = async (opts: {
//   formId?: string;
//   createdFrom?: Date;
//   createdTo?: Date;
// }): Promise<FacebookManualAssigneeStatRow[]> => {
//   if (!opts.createdFrom || !opts.createdTo) return [];

//   let formClause = sql``;
//   if (opts.formId) formClause = sql`AND fl.form_id = ${opts.formId}`;

//   const result = await db.execute(sql`
//     SELECT
//       u.id AS assignee_id,
//       u.full_name AS assignee_name,
//       u.role::text AS assignee_role,
//       COUNT(*)::int AS total_assigned,
//       COUNT(*) FILTER (WHERE l.assignment_status = 'transferred')::int AS transferred_leads
//     FROM leads l
//     INNER JOIN users u ON u.id = COALESCE(l.current_telecaller_id, l.current_counsellor_id)
//     WHERE l.lead_source = 'facebook_lead_ads'
//       AND l.form_id IS NOT NULL
//       AND (
//         l.current_telecaller_id IS NOT NULL OR l.current_counsellor_id IS NOT NULL
//       )
//       AND l.created_at >= ${opts.createdFrom}
//       AND l.created_at <= ${opts.createdTo}
//       ${formClause}
//     GROUP BY u.id, u.full_name, u.role
//     ORDER BY u.full_name ASC
//   `);

//   return getAllRows(result).map((r: any) => ({
//     assigneeId: Number(r.assignee_id),
//     assigneeName: String(r.assignee_name ?? ""),
//     role: String(r.assignee_role ?? ""),
//     totalAssigned: Number(r.total_assigned ?? 0),
//     transferredLeads: Number(r.transferred_leads ?? 0),
//   }));
// };

export const getFacebookManualDistributionAssigneeStats = async (opts: {
  formId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}): Promise<FacebookManualAssigneeStatRow[]> => {
  let formClause = sql``;
  if (opts.formId) formClause = sql`AND fl.form_id = ${opts.formId}`;

  const hasDateRange =
    opts.createdFrom &&
    opts.createdTo &&
    Number.isFinite(opts.createdFrom.getTime()) &&
    Number.isFinite(opts.createdTo.getTime());

  const dateJoinClause = hasDateRange
    ? sql`
        AND l.created_at >= ${opts.createdFrom}
        AND l.created_at <= ${opts.createdTo}
      `
    : sql``;

  const result = await db.execute(sql`
    WITH assignee_stats AS (
      SELECT
        u.id AS assignee_id,
        u.full_name AS assignee_name,
        u.role::text AS assignee_role,
        COUNT(l.id)::int AS total_assigned,
        COUNT(l.id) FILTER (WHERE l.assignment_status = 'transferred')::int AS transferred_leads
      FROM users u
      LEFT JOIN leads l ON (
        u.id = COALESCE(l.current_telecaller_id, l.current_counsellor_id)
        AND (l.lead_source = 'instagram' OR l.lead_source = 'facebook')
        AND EXISTS (
          SELECT 1 FROM facebook_lead fl2
          WHERE fl2.lead_id = l.id AND fl2.form_id IS NOT NULL
          ${formClause}
        )
        ${dateJoinClause}
      )
      WHERE u.role IN ('telecaller', 'counsellor')
      GROUP BY u.id, u.full_name, u.role
    )
    SELECT
      assignee_id,
      assignee_name,
      assignee_role,
      COALESCE(total_assigned, 0) AS total_assigned,
      COALESCE(transferred_leads, 0) AS transferred_leads
    FROM assignee_stats
    ORDER BY assignee_name ASC
  `);

  return getAllRows(result).map((r: any) => ({
    assigneeId: Number(r.assignee_id),
    assigneeName: String(r.assignee_name ?? ""),
    role: String(r.assignee_role ?? ""),
    totalAssigned: Number(r.total_assigned ?? 0),
    transferredLeads: Number(r.transferred_leads ?? 0),
  }));
};