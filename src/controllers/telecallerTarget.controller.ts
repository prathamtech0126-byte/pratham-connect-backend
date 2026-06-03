// import { Request, Response } from "express";
// import { db } from "../config/databaseConnection";
// import { telecallerTargets } from "../schemas/telecallerTargets.schema";
// import { eq, and } from "drizzle-orm";

// // CREATE OR UPDATE Assigned Targets
// export const upsertTelecallerTarget = async (req: Request, res: Response) => {
//   try {
//     const { telecallerId, month, transferTarget, conversionTarget } = req.body;

//     if (!telecallerId || !month) {
//       return res.status(400).json({ error: "Telecaller ID and Month are required" });
//     }

//     const tId = parseInt(telecallerId);
//     const transTarget = parseInt(transferTarget || "0");
//     const convTarget = parseInt(conversionTarget || "0");

//     // Check if target for this telecaller and month already exists
//     const [existing] = await db
//       .select()
//       .from(telecallerTargets)
//       .where(
//         and(
//           eq(telecallerTargets.telecallerId, tId),
//           eq(telecallerTargets.monthYear, month)
//         )
//       )
//       .limit(1);

//     let result;

//     if (existing) {
//       // UPDATE existing assigned targets (Achieved counts remain untouched)
//       [result] = await db
//         .update(telecallerTargets)
//         .set({
//           transferTargetAssigned: transTarget,
//           conversionTargetAssigned: convTarget,
//           updatedAt: new Date(),
//         })
//         .where(eq(telecallerTargets.id, existing.id))
//         .returning();
//     } else {
//       // CREATE new record
//       [result] = await db
//         .insert(telecallerTargets)
//         .values({
//           telecallerId: tId,
//           monthYear: month,
//           transferTargetAssigned: transTarget,
//           conversionTargetAssigned: convTarget,
//           transferTargetAchieved: 0,
//           conversionTargetAchieved: 0,
//         })
//         .returning();
//     }

//     return res.status(200).json({ message: "Target saved successfully", data: result });
//   } catch (error: any) {
//     return res.status(500).json({ error: error.message });
//   }
// };

// // GET target for a specific telecaller and month (to populate form)
// export const getTelecallerTarget = async (req: Request, res: Response) => {
//   try {
//     const { telecallerId, monthYear } = req.params;
//     const [target] = await db
//       .select()
//       .from(telecallerTargets)
//       .where(
//         and(
//           eq(telecallerTargets.telecallerId, parseInt(telecallerId)),
//           eq(telecallerTargets.monthYear, monthYear)
//         )
//       )
//       .limit(1);

//     return res.status(200).json(target || null);
//   } catch (error: any) {
//     return res.status(500).json({ error: error.message });
//   }
// };



import { Request, Response } from "express";
import { db } from "../config/databaseConnection";
import { telecallerTargets } from "../schemas/telecallerTargets.schema";
import { users } from "../schemas/users.schema";
import { eq, and, desc } from "drizzle-orm";
import {
  getTelecallerAchievedCountsForMonth,
  getTelecallerAchievedCountsMapForMonth,
} from "../Leads/services/telecallerTargetMetrics.service";

export const upsertTelecallerTarget = async (req: Request, res: Response) => {
  try {
    const { telecallerId, month, transferTarget, conversionTarget, mode } = req.body;

    const tId = parseInt(telecallerId);
    const [existing] = await db
      .select()
      .from(telecallerTargets)
      .where(and(eq(telecallerTargets.telecallerId, tId), eq(telecallerTargets.monthYear, month)))
      .limit(1);

    // MODE CHECK: If user is trying to "Set" but it already exists
    if (mode === "create" && existing) {
      return res.status(409).json({ error: "Target already assigned to this person for this month-year" });
    }

    let result;
    if (existing) {
      [result] = await db
        .update(telecallerTargets)
        .set({
          transferTargetAssigned: parseInt(transferTarget),
          conversionTargetAssigned: parseInt(conversionTarget),
          updatedAt: new Date(),
        })
        .where(eq(telecallerTargets.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(telecallerTargets)
        .values({
          telecallerId: tId,
          monthYear: month,
          transferTargetAssigned: parseInt(transferTarget),
          conversionTargetAssigned: parseInt(conversionTarget),
        })
        .returning();
    }

    return res.status(200).json({ message: "Success", data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getTelecallerTarget = async (req: Request, res: Response) => {
  try {
    const { telecallerId, monthYear } = req.params;
    const [target] = await db
      .select()
      .from(telecallerTargets)
      .where(and(eq(telecallerTargets.telecallerId, parseInt(telecallerId)), eq(telecallerTargets.monthYear, monthYear)))
      .limit(1);

    if (!target) return res.status(200).json(null);

    const achieved = await getTelecallerAchievedCountsForMonth(
      parseInt(telecallerId),
      monthYear
    );

    return res.status(200).json({
      ...target,
      transferTargetAchieved: achieved.transferTargetAchieved,
      conversionTargetAchieved: achieved.conversionTargetAchieved,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getLeaderboardForMonth = async (req: Request, res: Response) => {
  try {
    const { monthYear } = req.params;
    const results = await db
      .select({
        telecallerId: telecallerTargets.telecallerId,
        fullName: users.fullName,
        transferTargetAssigned: telecallerTargets.transferTargetAssigned,
        conversionTargetAssigned: telecallerTargets.conversionTargetAssigned,
      })
      .from(telecallerTargets)
      .innerJoin(users, eq(users.id, telecallerTargets.telecallerId))
      .where(eq(telecallerTargets.monthYear, monthYear));

    const achievedMap = await getTelecallerAchievedCountsMapForMonth(
      results.map((r) => r.telecallerId),
      monthYear
    );

    const data = results.map((r) => {
      const achieved = achievedMap.get(r.telecallerId) ?? {
        transferTargetAchieved: 0,
        conversionTargetAchieved: 0,
      };
      return {
        ...r,
        transferTargetAchieved: achieved.transferTargetAchieved,
        conversionTargetAchieved: achieved.conversionTargetAchieved,
      };
    });

    return res.status(200).json({ data });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getTelecallerTargetHistory = async (req: Request, res: Response) => {
  try {
    const { telecallerId } = req.params;
    const tId = parseInt(telecallerId);
    if (Number.isNaN(tId)) {
      return res.status(400).json({ error: "Invalid telecallerId" });
    }

    const rows = await db
      .select()
      .from(telecallerTargets)
      .where(eq(telecallerTargets.telecallerId, tId))
      .orderBy(desc(telecallerTargets.monthYear), desc(telecallerTargets.updatedAt));

    return res.status(200).json({ data: rows });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};