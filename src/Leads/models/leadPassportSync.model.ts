import { eq } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { leadStudentProfiles } from "../leadregistration/schemas/leadStudentProfiles.schema";

/** Sync client passport into lead_student_profiles after lead conversion. */
export async function syncLeadPassportFromClient(
  leadId: number,
  passportNumber: string,
): Promise<void> {
  const trimmed = passportNumber?.trim();
  if (!Number.isFinite(leadId) || leadId <= 0 || !trimmed) return;

  const [existing] = await db
    .select({ id: leadStudentProfiles.id })
    .from(leadStudentProfiles)
    .where(eq(leadStudentProfiles.leadId, leadId))
    .limit(1);

  const profileData = {
    hasPassport: true,
    passportNumber: trimmed,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(leadStudentProfiles)
      .set(profileData)
      .where(eq(leadStudentProfiles.leadId, leadId));
  } else {
    await db.insert(leadStudentProfiles).values({
      leadId,
      ...profileData,
    });
  }
}
