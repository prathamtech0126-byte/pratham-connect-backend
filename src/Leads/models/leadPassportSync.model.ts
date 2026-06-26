import { eq } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { assertEnglishNameField } from "../../utils/leadTextNormalization";
import { leads } from "../schemas/leads.schema";
import { leadStudentProfiles } from "../leadregistration/schemas/leadStudentProfiles.schema";

/** Keep lead.full_name in sync when a counsellor corrects the name during client conversion. */
export async function syncLeadFullNameFromClient(
  leadId: number,
  fullName: string
): Promise<void> {
  const trimmed = fullName?.trim();
  if (!Number.isFinite(leadId) || leadId <= 0 || !trimmed) return;

  const normalized = assertEnglishNameField(trimmed, "Full name", { required: true });
  await db
    .update(leads)
    .set({ fullName: normalized, updatedAt: new Date() })
    .where(eq(leads.id, leadId));
}

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
