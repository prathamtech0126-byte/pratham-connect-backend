import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { users } from "../../schemas/users.schema";
import { leadActivities } from "../schemas/leadActivities.schema";

export type LeadTransferRow = {
  assignmentStatus?: string | null;
  currentCounsellorId?: number | null;
};

export const TELECALLER_ROLE = "telecaller";
export const COUNSELLOR_ROLE = "counsellor";

export const isLeadTransferredToCounsellor = (lead: LeadTransferRow): boolean =>
  lead.assignmentStatus === "transferred" && lead.currentCounsellorId != null;

/** Telecaller may view but not add notes / complete follow-ups after counsellor transfer. */
export const isTelecallerTransferredViewOnly = (
  lead: LeadTransferRow,
  viewerRole?: string | null
): boolean => viewerRole === TELECALLER_ROLE && isLeadTransferredToCounsellor(lead);

export const assertTelecallerCanModifyLead = (
  lead: LeadTransferRow,
  viewerRole?: string | null
): void => {
  if (isTelecallerTransferredViewOnly(lead, viewerRole)) {
    throw new Error(
      "This lead was transferred to a counsellor. You can view the timeline but cannot add or edit notes or follow-ups."
    );
  }
};

export const getUserRoleById = async (userId: number | null | undefined): Promise<string | null> => {
  if (userId == null) return null;
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role ?? null;
};

type FollowUpActivityRow = {
  activityType: string;
  status: string;
  userId?: number | null;
  userRole?: string | null;
};

/** Current telecaller assignee may complete pending follow-ups created by any telecaller (handoff). */
export const canTelecallerCompleteFollowUp = async (
  lead: LeadTransferRow,
  activity: FollowUpActivityRow,
  viewerRole?: string | null
): Promise<boolean> => {
  if (viewerRole !== TELECALLER_ROLE) return true;
  if (activity.activityType !== "followup" || activity.status !== "pending") return false;
  if (isLeadTransferredToCounsellor(lead)) return false;

  const creatorRole =
    activity.userRole ?? (await getUserRoleById(activity.userId ?? null));
  return creatorRole === TELECALLER_ROLE;
};

export const assertTelecallerCanCompleteFollowUp = async (
  lead: LeadTransferRow,
  activity: FollowUpActivityRow,
  viewerRole?: string | null
): Promise<void> => {
  if (viewerRole !== TELECALLER_ROLE) return;

  if (isLeadTransferredToCounsellor(lead)) {
    throw new Error("Counsellor follow-ups cannot be completed by telecallers after transfer.");
  }

  const allowed = await canTelecallerCompleteFollowUp(lead, activity, viewerRole);
  if (!allowed) {
    throw new Error("You can only complete follow-ups created by your telecaller team.");
  }
};

/** Pending follow-up that the current telecaller assignee must complete (telecaller-created only). */
export const hasPendingTelecallerFollowUpForLead = async (leadId: number): Promise<boolean> => {
  const rows = await db
    .select({ id: leadActivities.id })
    .from(leadActivities)
    .innerJoin(users, eq(leadActivities.userId, users.id))
    .where(
      and(
        eq(leadActivities.leadId, leadId),
        eq(leadActivities.activityType, "followup"),
        eq(leadActivities.status, "pending"),
        eq(users.role, TELECALLER_ROLE)
      )
    )
    .limit(1);
  return rows.length > 0;
};

export const getUserRolesByIds = async (userIds: number[]): Promise<Map<number, string>> => {
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.role]));
};
