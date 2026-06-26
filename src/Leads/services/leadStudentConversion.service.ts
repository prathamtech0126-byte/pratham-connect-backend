import { and, eq, sql } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { clientInformation } from "../../schemas/clientInformation.schema";
import { clientProductPayments } from "../../schemas/clientProductPayments.schema";
import { saleTypes } from "../../schemas/saleType.schema";
import { saleTypeCategories } from "../../schemas/saleTypeCategory.schema";
import { tutionFees } from "../../schemas/tutionFees.schema";
import { leads } from "../schemas/leads.schema";
import { normalizeLeadTypeSlug } from "../models/leadType.model";

const STUDENT_CATEGORY = "student";

const saleTypeJoinOnLeadType = sql`
  LOWER(REPLACE(TRIM(COALESCE(l.lead_type, '')), ' ', '_'))
    = LOWER(REPLACE(TRIM(st.sale_type), ' ', '_'))
`;

/** True when the lead's sale type (leads.lead_type) belongs to the student category. */
export const isStudentCategoryLeadType = async (
  leadType: string | null | undefined
): Promise<boolean> => {
  if (!leadType?.trim()) return false;
  const slug = normalizeLeadTypeSlug(leadType.trim());
  const [row] = await db
    .select({ categoryName: saleTypeCategories.name })
    .from(saleTypes)
    .innerJoin(saleTypeCategories, eq(saleTypes.categoryId, saleTypeCategories.id))
    .where(sql`LOWER(REPLACE(TRIM(${saleTypes.saleType}), ' ', '_')) = ${slug}`)
    .limit(1);
  return row?.categoryName?.toLowerCase() === STUDENT_CATEGORY;
};

/** Paid tuition deposit exists for the client created from this lead. */
export const leadHasPaidTuitionDeposit = async (leadId: number): Promise<boolean> => {
  const [row] = await db
    .select({ id: tutionFees.id })
    .from(clientInformation)
    .innerJoin(clientProductPayments, eq(clientProductPayments.clientId, clientInformation.clientId))
    .innerJoin(
      tutionFees,
      and(
        eq(clientProductPayments.entityId, tutionFees.id),
        eq(clientProductPayments.entityType, "tutionFees_id")
      )
    )
    .where(
      and(
        eq(clientInformation.convertedLeadId, leadId),
        eq(tutionFees.tutionFeesStatus, "paid")
      )
    )
    .limit(1);
  return Boolean(row);
};

/** DB fields when counsellor converts a lead (student → pending telecaller conversion until TD). */
export const buildCounsellorLeadConversionUpdate = async (
  leadType: string | null | undefined,
  existingConvertedAt?: Date | null,
  now: Date = new Date()
): Promise<{
  progressStatus: "converted";
  assignmentStatus: "transferred" | "converted";
  convertedAt: Date | null;
}> => {
  const isStudent = await isStudentCategoryLeadType(leadType);
  return {
    progressStatus: "converted",
    assignmentStatus: isStudent ? "transferred" : "converted",
    convertedAt: isStudent ? null : (existingConvertedAt ?? now),
  };
};

/**
 * Student leads wrongly marked assignment=converted before TD (e.g. via client form PATCH).
 * Revert to transferred + clear converted_at so telecaller metrics stay correct.
 */
export const maybeRevertPrematureStudentConversion = async (leadId: number): Promise<boolean> => {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead || lead.progressStatus !== "converted") return false;
  if (!(await isStudentCategoryLeadType(lead.leadType))) return false;
  if (await leadHasPaidTuitionDeposit(leadId)) return false;
  if (lead.assignmentStatus === "transferred" && lead.convertedAt == null) return false;

  await db
    .update(leads)
    .set({
      assignmentStatus: "transferred",
      convertedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));
  return true;
};

/** Lead ids: student category, counsellor-converted, no paid TD yet. */
export const getPendingStudentConversionLeadIds = async (
  leadIds: number[]
): Promise<Set<number>> => {
  if (leadIds.length === 0) return new Set();

  const result = await db.execute<{ id: number }>(sql`
    SELECT l.id::int AS id
    FROM leads l
    INNER JOIN sale_type st ON ${saleTypeJoinOnLeadType}
    INNER JOIN sale_type_category stc ON stc.id = st.category_id
      AND LOWER(stc.name) = ${STUDENT_CATEGORY}
    WHERE l.id IN (${sql.join(leadIds.map((id) => sql`${id}`), sql`, `)})
      AND l.progress_status = 'converted'
      AND NOT EXISTS (
        SELECT 1
        FROM client_information ci
        INNER JOIN client_product_payment cpp ON cpp.client_id = ci.id
        INNER JOIN tution_fees tf ON tf.id = cpp.entity_id
          AND cpp.entity_type = 'tutionFees_id'
        WHERE ci.converted_lead_id = l.id
          AND tf.tution_fees_status = 'paid'
      )
  `);

  const raw = Array.isArray(result)
    ? result
    : ((result as { rows?: { id: number }[] }).rows ?? []);

  return new Set(raw.map((r) => Number(r.id)));
};

export type LeadPendingConversionRow = {
  id: number;
  leadType?: string | null;
  progressStatus?: string | null;
  assignmentStatus?: string | null;
};

export const attachPendingConvertedFlags = async <T extends LeadPendingConversionRow>(
  rows: T[]
): Promise<(T & { pendingConverted: boolean })[]> => {
  const candidateIds = rows
    .filter((r) => r.progressStatus === "converted")
    .map((r) => r.id);

  for (const id of candidateIds) {
    await maybeRevertPrematureStudentConversion(id);
  }

  const pendingSet =
    candidateIds.length > 0
      ? await getPendingStudentConversionLeadIds(candidateIds)
      : new Set<number>();

  return rows.map((row) => ({
    ...row,
    pendingConverted: pendingSet.has(row.id),
  }));
};

const tuitionFeeDateToConvertedAt = (feeDate?: string | null): Date => {
  if (!feeDate?.trim()) return new Date();
  const parsed = new Date(`${feeDate.trim()}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
};

/**
 * When TD is marked paid for a converted-from-lead student client,
 * finalize telecaller conversion (assignment_status → converted, set converted_at).
 */
export const maybeFinalizeLeadConversionAfterTuitionDeposit = async (
  clientId: number,
  tuitionDepositDate?: string | null
): Promise<void> => {
  const [client] = await db
    .select({ convertedLeadId: clientInformation.convertedLeadId })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client?.convertedLeadId) return;

  const leadId = client.convertedLeadId;
  await maybeRevertPrematureStudentConversion(leadId);

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);

  if (!lead) return;
  if (lead.assignmentStatus === "converted" && lead.convertedAt != null) return;
  if (lead.progressStatus !== "converted") return;
  if (!(await isStudentCategoryLeadType(lead.leadType))) return;

  const hasPaid = await leadHasPaidTuitionDeposit(leadId);
  if (!hasPaid) return;

  const convertedAt = tuitionFeeDateToConvertedAt(tuitionDepositDate);
  const now = new Date();

  await db
    .update(leads)
    .set({
      assignmentStatus: "converted",
      convertedAt,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));
};
