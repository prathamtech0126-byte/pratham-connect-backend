import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { users } from "../../../schemas/users.schema";
import type { Role } from "../../../types/role";
import {
  isBindingApplicationRole,
  isVisaCaseAssignableRole,
  VISA_CASE_ASSIGN_ADMIN_ROLES,
  VISA_CASE_ASSIGNABLE_ROLES,
  VISA_CASE_BINDING_APPLICATION_ROLES,
  VISA_CASE_OPS_ROLES,
  toDisplayAssignedTeam,
  type VisaAssignedTeam,
} from "../constants/visaCase.constants";
import {
  visaCaseForbiddenError,
  visaCaseNotAssignedError,
} from "../errors/visaCase.errors";
import { getVisaCaseById } from "../models/visaCase.model";
import {
  assignVisaCaseInTransaction,
  getLastCxAssigneeUserId,
  isUserInvolvedInVisaCase,
  listVisaCaseAssignmentsByCaseId,
} from "../models/visaCaseAssignment.model";

export type AssignmentType =
  | "admin_initial"
  | "admin_reassign"
  | "manager_reassign"
  | "cx_to_binding"
  | "cx_to_application"
  | "binding_to_application"
  | "ops_reassign";

export type ViewerContext = {
  userId: number;
  role: Role;
};

const OPS_TEAM_BY_ROLE: Record<string, VisaAssignedTeam> = {
  cx: "cx",
  binding: "binding",
  application: "binding",
};

export const isStrictAssignmentVisibility = (): boolean =>
  process.env.VISA_CASE_ASSIGNMENT_STRICT_VISIBILITY !== "false";

export const isOpsRole = (role: Role): boolean =>
  (VISA_CASE_OPS_ROLES as readonly string[]).includes(role);

export const canViewAllVisaCases = (role: Role): boolean =>
  role === "developer" ||
  (VISA_CASE_ASSIGN_ADMIN_ROLES as readonly string[]).includes(role);

export const teamForUserRole = (role: string): VisaAssignedTeam | null =>
  OPS_TEAM_BY_ROLE[role] ?? null;

export const assertOpsAssigneeAccess = (
  viewer: ViewerContext,
  assignedUserId: number | null | undefined
): void => {
  if (!isStrictAssignmentVisibility()) return;
  if (!isOpsRole(viewer.role)) return;
  if (assignedUserId !== viewer.userId) {
    throw visaCaseNotAssignedError();
  }
};

/** Read access for ops — current assignee or anyone in assignment history. */
export const assertOpsViewAccess = async (
  viewer: ViewerContext,
  visaCaseId: string,
  assignedUserId: number | null | undefined
): Promise<void> => {
  if (!isStrictAssignmentVisibility()) return;
  if (!isOpsRole(viewer.role)) return;
  if (assignedUserId === viewer.userId) return;

  const involved = await isUserInvolvedInVisaCase(visaCaseId, viewer.userId);
  if (!involved) {
    throw visaCaseNotAssignedError();
  }
};

/**
 * CX member who should handle a routed document request for this case:
 * current assignee when they are CX, otherwise the most recent CX assignee in history.
 */
export const resolveCxDocumentRequestHandler = async (
  visaCaseId: string,
  currentAssignedUserId: number | null | undefined
): Promise<number | null> => {
  if (currentAssignedUserId != null) {
    const currentAssignee = await getUserById(currentAssignedUserId);
    if (currentAssignee?.role === "cx") {
      return currentAssignedUserId;
    }
  }

  return getLastCxAssigneeUserId(visaCaseId);
};

const selectAssigneeFields = {
  id: users.id,
  fullName: users.fullName,
  role: users.role,
  empId: users.emp_id,
  status: users.status,
};

export const getUserById = async (userId: number) => {
  const [row] = await db
    .select(selectAssigneeFields)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
};

export type AssigneeLookupInput = {
  assignedUserId?: number;
  empId?: string;
};

/** Resolve assignee on main CRM `users` by numeric id or emp_id (e.g. PINT41952). */
export const resolveAssigneeUser = async (input: AssigneeLookupInput) => {
  if (input.assignedUserId != null && Number.isFinite(input.assignedUserId)) {
    const byId = await getUserById(input.assignedUserId);
    if (byId && isVisaCaseAssignableRole(byId.role)) return byId;
  }

  const empId = input.empId?.trim().toUpperCase();
  if (empId) {
    const [byEmp] = await db
      .select(selectAssigneeFields)
      .from(users)
      .where(
        or(
          eq(users.emp_id, empId),
          sql`upper(${users.emp_id}) = ${empId}`
        )
      )
      .limit(1);
    if (byEmp && isVisaCaseAssignableRole(byEmp.role)) return byEmp;
  }

  return null;
};

const formatAssigneeNotFoundMessage = (input: AssigneeLookupInput): string => {
  const parts: string[] = [];
  if (input.assignedUserId != null) {
    parts.push(`users.id=${input.assignedUserId}`);
  }
  if (input.empId?.trim()) {
    parts.push(`emp_id=${input.empId.trim().toUpperCase()}`);
  }
  const lookup = parts.join(", ") || "unknown";
  return (
    `Assignee user not found (${lookup}). ` +
    `Use GET /api/modules/visa-cases/:visaCaseId/assignable-users?targetRole=binding ` +
    `to list valid user ids for this handoff.`
  );
};

export const assertVisaCaseAssignableRole = (role: string): void => {
  if (!isVisaCaseAssignableRole(role)) {
    throw new Error(
      `targetRole must be one of: ${VISA_CASE_ASSIGNABLE_ROLES.join(", ")}`
    );
  }
};

/** Active users with role cx | binding | application only. */
export const listActiveUsersByRole = async (role: string) => {
  assertVisaCaseAssignableRole(role);

  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      empId: users.emp_id,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.role, role),
        eq(users.status, true),
        inArray(users.role, [...VISA_CASE_ASSIGNABLE_ROLES])
      )
    )
    .orderBy(users.fullName);
};

/** Active binding + application users (combined post-CX team). */
export const listActiveBindingApplicationUsers = async () =>
  db
    .select({
      id: users.id,
      fullName: users.fullName,
      empId: users.emp_id,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        inArray(users.role, [...VISA_CASE_BINDING_APPLICATION_ROLES]),
        eq(users.status, true)
      )
    )
    .orderBy(users.fullName);

const isAdminAssigner = (role: Role): boolean =>
  role === "developer" ||
  role === "admin" ||
  role === "superadmin";

const isManagerAssigner = (role: Role): boolean =>
  role === "manager" || role === "branchmanager";

const canAdminAssign = (role: Role): boolean =>
  isAdminAssigner(role) || isManagerAssigner(role);

/** Ops handoff picker: which target roles each ops role may list. */
export const resolveOpsListableTargetRoles = (
  role: Role
): readonly (typeof VISA_CASE_ASSIGNABLE_ROLES)[number][] | null => {
  if (role === "cx") return VISA_CASE_BINDING_APPLICATION_ROLES;
  if (isBindingApplicationRole(role)) return VISA_CASE_BINDING_APPLICATION_ROLES;
  return null;
};

/** @deprecated Use resolveOpsListableTargetRoles — first allowed role for legacy callers. */
export const resolveOpsListableTargetRole = (
  role: Role
): (typeof VISA_CASE_ASSIGNABLE_ROLES)[number] | null =>
  resolveOpsListableTargetRoles(role)?.[0] ?? null;

export const resolveTargetTeamForAssigner = (
  viewer: ViewerContext,
  visaCase: {
    assignedUserId: number | null;
    assignedTeam: VisaAssignedTeam;
  }
): { targetRoles: readonly string[]; assignmentTypeHint: AssignmentType } | null => {
  if (canAdminAssign(viewer.role)) {
    if (visaCase.assignedUserId == null) {
      return { targetRoles: ["cx"], assignmentTypeHint: "admin_initial" };
    }
    return { targetRoles: ["cx"], assignmentTypeHint: "admin_reassign" };
  }

  if (viewer.role === "cx") {
    if (visaCase.assignedUserId !== viewer.userId) return null;
    return {
      targetRoles: VISA_CASE_BINDING_APPLICATION_ROLES,
      assignmentTypeHint: "cx_to_binding",
    };
  }

  if (isBindingApplicationRole(viewer.role)) {
    if (visaCase.assignedUserId !== viewer.userId) return null;
    return {
      targetRoles: VISA_CASE_BINDING_APPLICATION_ROLES,
      assignmentTypeHint: "ops_reassign",
    };
  }

  return null;
};

export const resolveAssignmentType = (
  viewer: ViewerContext,
  previousUserId: number | null,
  targetRole: string,
  explicitAdminPick: boolean
): AssignmentType => {
  if (canAdminAssign(viewer.role)) {
    if (previousUserId == null) return "admin_initial";
    if (isManagerAssigner(viewer.role) && !isAdminAssigner(viewer.role)) {
      return "manager_reassign";
    }
    return "admin_reassign";
  }

  if (viewer.role === "cx" && isBindingApplicationRole(targetRole)) {
    return targetRole === "application" ? "cx_to_application" : "cx_to_binding";
  }

  if (
    isBindingApplicationRole(viewer.role) &&
    isBindingApplicationRole(targetRole)
  ) {
    if (viewer.role === "binding" && targetRole === "application") {
      return "binding_to_application";
    }
    return "ops_reassign";
  }

  if (explicitAdminPick) return "admin_reassign";
  throw new Error("Invalid assignment type for this handoff");
};

export const validateAssignmentRequest = async (
  viewer: ViewerContext,
  visaCaseId: string,
  assignee: AssigneeLookupInput
): Promise<{
  visaCase: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>;
  targetUser: NonNullable<Awaited<ReturnType<typeof getUserById>>>;
  assignedTeam: VisaAssignedTeam;
  assignmentType: AssignmentType;
}> => {
  const row = await getVisaCaseById(visaCaseId);
  if (!row) {
    throw new Error("Visa case not found");
  }

  if (
    assignee.assignedUserId == null &&
    !assignee.empId?.trim()
  ) {
    throw new Error("assignedUserId or empId is required");
  }

  const targetUser = await resolveAssigneeUser(assignee);
  if (!targetUser) {
    throw new Error(formatAssigneeNotFoundMessage(assignee));
  }

  if (!targetUser.status) {
    throw new Error("Cannot assign to an inactive user");
  }

  if (!isVisaCaseAssignableRole(targetUser.role)) {
    throw new Error(
      `Assignee must have role cx, binding, or application (got "${targetUser.role}")`
    );
  }

  const targetTeam = teamForUserRole(targetUser.role);
  if (!targetTeam) {
    throw new Error("Assignee must be a cx, binding, or application team member");
  }

  const previousUserId = row.visaCase.assignedUserId ?? null;

  if (canAdminAssign(viewer.role)) {
    const assignmentType = resolveAssignmentType(
      viewer,
      previousUserId,
      targetUser.role,
      true
    );
    return {
      visaCase: row,
      targetUser,
      assignedTeam: targetTeam,
      assignmentType,
    };
  }

  if (viewer.role === "cx") {
    if (previousUserId !== viewer.userId) {
      throw visaCaseForbiddenError(
        "Only the current CX assignee can hand off this case"
      );
    }
    if (!isBindingApplicationRole(targetUser.role)) {
      throw new Error(
        "CX can only assign to a binding or application team member"
      );
    }
    return {
      visaCase: row,
      targetUser,
      assignedTeam: targetTeam,
      assignmentType: resolveAssignmentType(
        viewer,
        previousUserId,
        targetUser.role,
        false
      ),
    };
  }

  if (isBindingApplicationRole(viewer.role)) {
    if (previousUserId !== viewer.userId) {
      throw visaCaseForbiddenError(
        "Only the current assignee can reassign this case"
      );
    }
    if (!isBindingApplicationRole(targetUser.role)) {
      throw new Error(
        "Can only assign to a binding or application team member"
      );
    }
    return {
      visaCase: row,
      targetUser,
      assignedTeam: targetTeam,
      assignmentType: resolveAssignmentType(
        viewer,
        previousUserId,
        targetUser.role,
        false
      ),
    };
  }

  throw visaCaseForbiddenError(
    "You do not have permission to assign this visa case"
  );
};

export const assignVisaCase = async (
  viewer: ViewerContext,
  visaCaseId: string,
  input: { assignedUserId?: number; empId?: string; notes?: string | null }
) => {
  const validated = await validateAssignmentRequest(viewer, visaCaseId, {
    assignedUserId: input.assignedUserId,
    empId: input.empId,
  });

  const previousUserId = validated.visaCase.visaCase.assignedUserId ?? null;

  const result = await assignVisaCaseInTransaction({
    visaCaseId,
    assignedUserId: validated.targetUser.id,
    assignedTeam: validated.assignedTeam,
    previousUserId,
    previousTeam:
      previousUserId != null ? validated.visaCase.visaCase.assignedTeam : null,
    assignedBy: viewer.userId,
    assignedByRole: viewer.role,
    assignmentType: validated.assignmentType,
    notes: input.notes?.trim() || null,
  });

  if (!result) {
    throw new Error("Failed to assign visa case");
  }

  return {
    visaCase: result.visaCase,
    assignment: result.assignment,
    targetUser: validated.targetUser,
  };
};

export const getVisaCaseAssignments = async (visaCaseId: string) => {
  const rows = await listVisaCaseAssignmentsByCaseId(visaCaseId);
  if (rows.length === 0) return [];

  const userIds = new Set<number>();
  for (const row of rows) {
    userIds.add(row.assignedUserId);
    userIds.add(row.assignedBy);
    if (row.previousUserId != null) userIds.add(row.previousUserId);
  }

  const userRows =
    userIds.size > 0
      ? await db
          .select({
            id: users.id,
            fullName: users.fullName,
            role: users.role,
            empId: users.emp_id,
          })
          .from(users)
          .where(inArray(users.id, [...userIds]))
      : [];

  const userMap = new Map(userRows.map((u) => [u.id, u]));

  return rows.map((row) => ({
    id: row.id,
    assignmentType: row.assignmentType,
    assignedTeam: toDisplayAssignedTeam(row.assignedTeam),
    notes: row.notes,
    createdAt: row.createdAt,
    assignedUser: userMap.get(row.assignedUserId) ?? {
      id: row.assignedUserId,
      fullName: "Unknown",
      role: row.assignedTeam,
      empId: null,
    },
    assignedBy: userMap.get(row.assignedBy) ?? {
      id: row.assignedBy,
      fullName: "Unknown",
      role: row.assignedByRole ?? "unknown",
      empId: null,
    },
    previousUserId: row.previousUserId,
    previousTeam: row.previousTeam,
  }));
};

/** Active cx | binding | application users (all assignable ops roles). */
export const listAllActiveAssigneeUsers = async () =>
  db
    .select({
      id: users.id,
      fullName: users.fullName,
      empId: users.emp_id,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.status, true),
        inArray(users.role, [...VISA_CASE_ASSIGNABLE_ROLES])
      )
    )
    .orderBy(users.fullName);

export const listAssignableOpsUsers = async (
  viewer: ViewerContext,
  targetRole: string
) => {
  assertVisaCaseAssignableRole(targetRole);

  if (!canAdminAssign(viewer.role) && viewer.role !== "developer") {
    const allowedTargets = resolveOpsListableTargetRoles(viewer.role);
    if (!allowedTargets) {
      throw visaCaseForbiddenError(
        "You do not have permission to list assignable users"
      );
    }
    if (!allowedTargets.includes(targetRole as (typeof allowedTargets)[number])) {
      throw visaCaseForbiddenError(
        `${viewer.role} can only list assignable users for targetRole=${allowedTargets.join("|")}`
      );
    }
  }

  const usersList = await listActiveUsersByRole(targetRole);

  return {
    targetTeam: teamForUserRole(targetRole)!,
    targetRole,
    users: usersList,
  };
};

/** Bulk-assign picker: admin/manager see all ops users when targetRole is omitted. */
export const listGlobalAssignableOpsUsers = async (
  viewer: ViewerContext,
  targetRoleQuery?: string
) => {
  const trimmed = targetRoleQuery?.trim();

  if (trimmed) {
    return listAssignableOpsUsers(viewer, trimmed);
  }

  if (canAdminAssign(viewer.role)) {
    const usersList = await listAllActiveAssigneeUsers();
    return {
      targetTeam: null,
      targetRole: null,
      users: usersList,
    };
  }

  const opsDefault = resolveOpsListableTargetRoles(viewer.role);
  if (!opsDefault) {
    throw visaCaseForbiddenError(
      "You do not have permission to list assignable users"
    );
  }

  const usersList = await listActiveBindingApplicationUsers();

  return {
    targetTeam: null,
    targetRole: null,
    users: usersList,
  };
};

export const getAssignableUsers = async (
  viewer: ViewerContext,
  visaCaseId: string,
  targetRoleQuery?: string
) => {
  const row = await getVisaCaseById(visaCaseId);
  if (!row) {
    throw new Error("Visa case not found");
  }

  let targetRole: string | null = null;
  let usersList: Awaited<ReturnType<typeof listActiveUsersByRole>>;

  if (canAdminAssign(viewer.role)) {
    if (targetRoleQuery && isVisaCaseAssignableRole(targetRoleQuery)) {
      targetRole = targetRoleQuery;
      usersList = await listActiveUsersByRole(targetRole);
    } else if (row.visaCase.assignedUserId == null) {
      targetRole = "cx";
      usersList = await listActiveUsersByRole(targetRole);
    } else {
      const currentAssignee = await getUserById(row.visaCase.assignedUserId);
      if (currentAssignee?.role === "cx") {
        usersList = await listActiveBindingApplicationUsers();
      } else if (currentAssignee && isBindingApplicationRole(currentAssignee.role)) {
        usersList = await listActiveBindingApplicationUsers();
      } else {
        targetRole = "cx";
        usersList = await listActiveUsersByRole(targetRole);
      }
    }
  } else {
    const handoff = resolveTargetTeamForAssigner(viewer, {
      assignedUserId: row.visaCase.assignedUserId,
      assignedTeam: row.visaCase.assignedTeam,
    });

    if (!handoff) {
      throw visaCaseForbiddenError(
        "You do not have permission to assign this visa case"
      );
    }

    usersList = await listActiveBindingApplicationUsers();
  }

  return {
    targetTeam: targetRole ? teamForUserRole(targetRole) : null,
    targetRole,
    users: usersList,
  };
};

export const buildAssignmentMeta = (
  viewer: ViewerContext,
  visaCase: {
    assignedUserId: number | null;
    assignedTeam: VisaAssignedTeam;
  }
) => {
  const handoff = resolveTargetTeamForAssigner(viewer, visaCase);
  const isAssignee =
    visaCase.assignedUserId != null && visaCase.assignedUserId === viewer.userId;
  const canAssign =
    handoff != null &&
    (canAdminAssign(viewer.role) || isAssignee);

  return {
    assignedUserId: visaCase.assignedUserId,
    assignedTeam: toDisplayAssignedTeam(visaCase.assignedTeam),
    canAssign,
    assignableTargetTeam: null,
    assignableTargetRole: handoff?.targetRoles[0] ?? null,
    assignableTargetRoles: handoff?.targetRoles ?? null,
  };
};

const BULK_ASSIGN_MAX = 50;

export type BulkAssignResultItem = {
  visaCaseId: string;
  success: boolean;
  message?: string;
  assignedUserId?: number;
  assignmentType?: string;
};

export const bulkAssignVisaCases = async (
  viewer: ViewerContext,
  input: {
    visaCaseIds: string[];
    assignedUserId?: number;
    empId?: string;
    notes?: string | null;
  }
) => {
  const uniqueIds = [...new Set(input.visaCaseIds.map((id) => id.trim()).filter(Boolean))];

  if (uniqueIds.length === 0) {
    throw new Error("visaCaseIds must contain at least one id");
  }

  if (uniqueIds.length > BULK_ASSIGN_MAX) {
    throw new Error(`Cannot assign more than ${BULK_ASSIGN_MAX} visa cases at once`);
  }

  const assignee = await resolveAssigneeUser({
    assignedUserId: input.assignedUserId,
    empId: input.empId,
  });

  if (!assignee) {
    throw new Error(
      formatAssigneeNotFoundMessage({
        assignedUserId: input.assignedUserId,
        empId: input.empId,
      })
    );
  }

  if (!isVisaCaseAssignableRole(assignee.role)) {
    throw new Error(
      `Assignee must have role cx, binding, or application (got "${assignee.role}")`
    );
  }

  const results: BulkAssignResultItem[] = [];

  for (const visaCaseId of uniqueIds) {
    try {
      const result = await assignVisaCase(viewer, visaCaseId, {
        assignedUserId: assignee.id,
        notes: input.notes,
      });
      results.push({
        visaCaseId,
        success: true,
        assignedUserId: assignee.id,
        assignmentType: result.assignment.assignmentType,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Assignment failed";
      results.push({ visaCaseId, success: false, message });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return {
    assignee: {
      id: assignee.id,
      fullName: assignee.fullName,
      role: assignee.role,
      empId: assignee.empId,
    },
    summary: {
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
    },
    results,
  };
};
