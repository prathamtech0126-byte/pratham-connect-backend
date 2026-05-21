import { db } from "../config/databaseConnection";
import { telecallerTargets } from "../schemas/telecallerTargets.schema";
import { eq, and } from "drizzle-orm";

interface TargetInput {
  telecallerId: number;
  monthYear: string;
  transferTarget: number;
  conversionTarget: number;
}

export const upsertTelecallerTarget = async (data: TargetInput) => {
  // Check if record exists
  const [existing] = await db
    .select()
    .from(telecallerTargets)
    .where(
      and(
        eq(telecallerTargets.telecallerId, data.telecallerId),
        eq(telecallerTargets.monthYear, data.monthYear)
      )
    )
    .limit(1);

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(telecallerTargets)
      .set({
        transferTargetAssigned: data.transferTarget,
        conversionTargetAssigned: data.conversionTarget,
        updatedAt: new Date(),
      })
      .where(eq(telecallerTargets.id, existing.id))
      .returning();
    return updated;
  } else {
    // Create new
    const [inserted] = await db
      .insert(telecallerTargets)
      .values({
        telecallerId: data.telecallerId,
        monthYear: data.monthYear,
        transferTargetAssigned: data.transferTarget,
        conversionTargetAssigned: data.conversionTarget,
      })
      .returning();
    return inserted;
  }
};