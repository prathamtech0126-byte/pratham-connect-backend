import { desc, eq } from "drizzle-orm";
import { getDbSecond, getPoolSecond } from "../../../config/databaseConnectionSecond";
import { invalidateModulesCachesOnWrite } from "../../cache/invalidate";
import { visaCases } from "../schemas/visaCase.schema";
import { visaCaseAssignments } from "../schemas/visaCaseAssignment.schema";
import { getVisaCaseById } from "./visaCase.model";

export const insertVisaCaseAssignment = async (
  values: typeof visaCaseAssignments.$inferInsert
) => {
  const [row] = await getDbSecond()
    .insert(visaCaseAssignments)
    .values(values)
    .returning();

  return row;
};

/** True when user is current assignee or appears in assignment history. */
export async function isUserInvolvedInVisaCase(
  visaCaseId: string,
  userId: number
): Promise<boolean> {
  const current = await getVisaCaseById(visaCaseId);
  if (current?.visaCase.assignedUserId === userId) return true;

  const { rows } = await getPoolSecond().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM visa_case_assignments a
        WHERE a.visa_case_id = $1::uuid
          AND (a.assigned_user_id = $2 OR a.previous_user_id = $2)
     ) AS exists`,
    [visaCaseId, userId]
  );

  return rows[0]?.exists === true;
}

export const listVisaCaseAssignmentsByCaseId = async (visaCaseId: string) => {
  return getDbSecond()
    .select()
    .from(visaCaseAssignments)
    .where(eq(visaCaseAssignments.visaCaseId, visaCaseId))
    .orderBy(desc(visaCaseAssignments.createdAt));
};

/** Most recent CX assignee from assignment history (for document-request alerts). */
export const getLastCxAssigneeUserId = async (
  visaCaseId: string
): Promise<number | null> => {
  const { rows } = await getPoolSecond().query<{ assigned_user_id: number }>(
    `SELECT a.assigned_user_id
       FROM visa_case_assignments a
      WHERE a.visa_case_id = $1::uuid
        AND a.assigned_team = 'cx'
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [visaCaseId]
  );

  const userId = rows[0]?.assigned_user_id;
  return userId != null && userId > 0 ? userId : null;
};

export const assignVisaCaseInTransaction = async (input: {
  visaCaseId: string;
  assignedUserId: number;
  assignedTeam: (typeof visaCases.$inferSelect)["assignedTeam"];
  previousUserId: number | null;
  previousTeam: (typeof visaCases.$inferSelect)["assignedTeam"] | null;
  assignedBy: number;
  assignedByRole: string;
  assignmentType: string;
  notes: string | null;
}) => {
  const db = getDbSecond();

  try {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(visaCases)
        .set({
          assignedUserId: input.assignedUserId,
          assignedTeam: input.assignedTeam,
          updatedAt: new Date(),
        })
        .where(eq(visaCases.id, input.visaCaseId))
        .returning();

      if (!updated) {
        return null;
      }

      const [assignment] = await tx
        .insert(visaCaseAssignments)
        .values({
          visaCaseId: input.visaCaseId,
          assignedTeam: input.assignedTeam,
          assignedUserId: input.assignedUserId,
          previousUserId: input.previousUserId,
          previousTeam: input.previousTeam,
          assignedBy: input.assignedBy,
          assignedByRole: input.assignedByRole,
          assignmentType: input.assignmentType,
          notes: input.notes,
        })
        .returning();

      return { visaCase: updated, assignment };
    });

    if (result) {
      await invalidateModulesCachesOnWrite({
        clientId: result.visaCase.clientId,
        reason: "visa-case:assigned",
        visaCase: {
          id: result.visaCase.id,
          clientId: result.visaCase.clientId,
          assignedUserId: result.visaCase.assignedUserId,
          assignedTeam: result.visaCase.assignedTeam,
          currentStage: result.visaCase.currentStage,
          currentSubStatus: result.visaCase.currentSubStatus,
          assignment: {
            previousUserId: input.previousUserId,
            previousTeam: input.previousTeam,
            assignmentType: input.assignmentType,
          },
        },
      });
    }

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /visa_case_assignments/i.test(message) &&
      /does not exist|relation/i.test(message)
    ) {
      throw new Error(
        "visa_case_assignments table is missing on modules DB. Run: npm run migrate:module-visa-case-assignments"
      );
    }
    throw error;
  }
};
