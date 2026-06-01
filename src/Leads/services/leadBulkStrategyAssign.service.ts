import { and, count, gte, inArray } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { leads } from "../schemas/leads.schema";
import { users } from "../../schemas/users.schema";
import { getIndianNow } from "../models/lead.model";
import { buildCounsellorAssignPatch } from "./leadAssignment.service";
import { isLeadTransferBlocked } from "./leadActivityLog.service";

export type LeadDistributionStrategy =
  | "round_robin"
  | "least_loaded"
  | "priority_weighted"
  | "performance_based";

export type StrategyAssignment = {
  leadId: number;
  leadName: string;
  userId: number;
  userName: string;
  role: "telecaller" | "counsellor";
};

export type StrategyAssignSummary = {
  userId: number;
  userName: string;
  role: "telecaller" | "counsellor";
  count: number;
};

export type BulkStrategyAssignResult = {
  assignments: StrategyAssignment[];
  summary: StrategyAssignSummary[];
  blocked: number[];
  missing: number[];
  conflictCounts: {
    withTelecaller: number;
    withCounsellor: number;
  };
};

const VALID_STRATEGIES: LeadDistributionStrategy[] = [
  "round_robin",
  "least_loaded",
  "priority_weighted",
  "performance_based",
];

const pickWeightedRandom = (pool: number[], weights: Record<string, number>): number | null => {
  if (pool.length === 0) return null;
  const expanded: number[] = [];
  for (const id of pool) {
    const w = Math.max(1, Math.min(99, weights[String(id)] ?? 1));
    for (let i = 0; i < w; i++) expanded.push(id);
  }
  return expanded[Math.floor(Math.random() * expanded.length)] ?? null;
};

const pickLeastLoadedFromPool = async (
  pool: number[],
  telecallerPool: number[],
  counsellorPool: number[]
): Promise<number | null> => {
  if (pool.length === 0) return null;

  const istNow = getIndianNow();
  const todayStart = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0)
  );

  const countMap = new Map<number, number>();

  if (telecallerPool.length > 0) {
    const rows = await db
      .select({ uid: leads.currentTelecallerId, c: count() })
      .from(leads)
      .where(
        and(inArray(leads.currentTelecallerId, telecallerPool), gte(leads.createdAt, todayStart))
      )
      .groupBy(leads.currentTelecallerId);
    for (const row of rows) {
      if (row.uid != null) countMap.set(row.uid, Number(row.c));
    }
  }

  if (counsellorPool.length > 0) {
    const rows = await db
      .select({ uid: leads.currentCounsellorId, c: count() })
      .from(leads)
      .where(
        and(inArray(leads.currentCounsellorId, counsellorPool), gte(leads.createdAt, todayStart))
      )
      .groupBy(leads.currentCounsellorId);
    for (const row of rows) {
      if (row.uid != null) countMap.set(row.uid, Number(row.c));
    }
  }

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

const pickNextAssignee = async (
  strategy: LeadDistributionStrategy,
  allPool: number[],
  telecallerPool: number[],
  counsellorPool: number[],
  priorityWeights: Record<string, number>,
  rrIndex: number
): Promise<{ userId: number | null; nextRrIndex: number }> => {
  if (allPool.length === 0) return { userId: null, nextRrIndex: rrIndex };

  switch (strategy) {
    case "round_robin":
    case "performance_based": {
      const userId = allPool[rrIndex % allPool.length] ?? null;
      return { userId, nextRrIndex: rrIndex + 1 };
    }
    case "least_loaded": {
      const userId = await pickLeastLoadedFromPool(allPool, telecallerPool, counsellorPool);
      return { userId, nextRrIndex: rrIndex };
    }
    case "priority_weighted": {
      const userId = pickWeightedRandom(allPool, priorityWeights);
      return { userId, nextRrIndex: rrIndex };
    }
    default:
      return { userId: allPool[0] ?? null, nextRrIndex: rrIndex + 1 };
  }
};

export const assertValidStrategy = (strategy: string): LeadDistributionStrategy => {
  if (!VALID_STRATEGIES.includes(strategy as LeadDistributionStrategy)) {
    throw new Error(`Invalid strategy. Use one of: ${VALID_STRATEGIES.join(", ")}`);
  }
  return strategy as LeadDistributionStrategy;
};

export const computeBulkStrategyAssignments = async (input: {
  leadIds: number[];
  strategy: LeadDistributionStrategy;
  assignedTelecallers: number[];
  assignedCounsellors: number[];
  priorityWeights?: Record<string, number>;
  rowsById?: Map<number, Awaited<ReturnType<typeof getLeadsForStrategyAssign>>[number]>;
}): Promise<BulkStrategyAssignResult> => {
  const {
    leadIds,
    strategy,
    assignedTelecallers,
    assignedCounsellors,
    priorityWeights = {},
  } = input;

  const telecallerPool = assignedTelecallers.filter(Number.isFinite);
  const counsellorPool = assignedCounsellors.filter(Number.isFinite);
  const allPool = [...telecallerPool, ...counsellorPool];

  if (allPool.length === 0) {
    throw new Error("Select at least one telecaller or counsellor");
  }

  const ids = leadIds.map(Number).filter((id) => Number.isFinite(id));
  const rows =
    input.rowsById != null
      ? ids.map((id) => input.rowsById!.get(id)).filter(Boolean) as Awaited<
          ReturnType<typeof getLeadsForStrategyAssign>
        >
      : await getLeadsForStrategyAssign(ids);

  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const blocked: number[] = [];
  const missing: number[] = [];
  const eligibleIds: number[] = [];

  for (const id of ids) {
    const lead = rowMap.get(id);
    if (!lead) {
      missing.push(id);
      continue;
    }
    if (isLeadTransferBlocked(lead)) {
      blocked.push(id);
      continue;
    }
    eligibleIds.push(id);
  }

  const userRows = await db
    .select({ id: users.id, fullName: users.fullName, role: users.role })
    .from(users)
    .where(inArray(users.id, allPool));
  const userNameMap = new Map(userRows.map((u) => [u.id, u.fullName ?? String(u.id)]));
  const roleMap = new Map(
    userRows.map((u) => [u.id, u.role === "counsellor" ? "counsellor" : "telecaller"] as const)
  );

  const assignments: StrategyAssignment[] = [];
  let rrIndex = 0;
  let withTelecaller = 0;
  let withCounsellor = 0;

  for (const leadId of eligibleIds) {
    const lead = rowMap.get(leadId)!;
    if (lead.currentTelecallerId != null) withTelecaller++;
    if (lead.currentCounsellorId != null) withCounsellor++;

    const { userId, nextRrIndex } = await pickNextAssignee(
      strategy,
      allPool,
      telecallerPool,
      counsellorPool,
      priorityWeights,
      rrIndex
    );
    rrIndex = nextRrIndex;
    if (!userId) continue;

    const role = roleMap.get(userId) ?? "telecaller";
    assignments.push({
      leadId,
      leadName: lead.fullName,
      userId,
      userName: userNameMap.get(userId) ?? String(userId),
      role,
    });
  }

  const summaryMap = new Map<string, StrategyAssignSummary>();
  for (const a of assignments) {
    const key = `${a.role}:${a.userId}`;
    const existing = summaryMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      summaryMap.set(key, {
        userId: a.userId,
        userName: a.userName,
        role: a.role,
        count: 1,
      });
    }
  }

  return {
    assignments,
    summary: Array.from(summaryMap.values()).sort((a, b) => b.count - a.count),
    blocked,
    missing,
    conflictCounts: { withTelecaller, withCounsellor },
  };
};

export async function getLeadsForStrategyAssign(ids: number[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phone: leads.phone,
      currentTelecallerId: leads.currentTelecallerId,
      currentCounsellorId: leads.currentCounsellorId,
      assignmentStatus: leads.assignmentStatus,
      progressStatus: leads.progressStatus,
      eligibilityStatus: leads.eligibilityStatus,
      leadQuality: leads.leadQuality,
    })
    .from(leads)
    .where(inArray(leads.id, ids));
}

export const buildStrategyAssignPatch = (
  lead: Awaited<ReturnType<typeof getLeadsForStrategyAssign>>[number],
  assignment: Pick<StrategyAssignment, "userId" | "role">,
  assignedBy: number,
  options: { isAdminLike: boolean; removeFromPreviousAssignee: boolean }
): Record<string, unknown> => {
  if (assignment.role === "counsellor") {
    const patch = buildCounsellorAssignPatch(lead, assignment.userId, assignedBy, {
      isAdminLike: options.isAdminLike,
    });
    if (options.removeFromPreviousAssignee) {
      patch.currentTelecallerId = null;
    }
    return patch;
  }

  return {
    assignedBy,
    currentTelecallerId: assignment.userId,
    currentCounsellorId:
      options.removeFromPreviousAssignee ? null : (lead.currentCounsellorId ?? null),
    assignmentStatus: "assigned",
  };
};
