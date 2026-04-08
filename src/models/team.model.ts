import { db } from "../config/databaseConnection";
import { teams } from "../schemas/team.schema";
import { eq, desc } from "drizzle-orm";
import { SQL } from "drizzle-orm";

/* ==============================
   TYPES
============================== */

interface CreateTeamInput {
  name: string;
  createdBy?: number | null;
}

interface UpdateTeamInput {
  name?: string;
  isActive?: boolean;
}

interface GetTeamFilters {
  id?: number;
  isActive?: boolean;
}

/* ==============================
   CREATE
============================== */

export const createTeam = async (data: CreateTeamInput) => {
  if (!data.name) throw new Error("Team name is required");

  const [created] = await db
    .insert(teams)
    .values({
      name: data.name,
      createdBy: data.createdBy ?? null,
    })
    .returning();

  return created;
};

/* ==============================
   GET ALL / FILTER
============================== */

export const getAllTeams = async (filters?: GetTeamFilters) => {
  const conditions: SQL[] = [];
  
  if (filters?.id) {
    conditions.push(eq(teams.teamId, filters.id));
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(teams.isActive, filters.isActive));
  }
  
  const query = db.select().from(teams);
  
  if (conditions.length > 0) {
    return await query.where(conditions.reduce((acc, condition) => acc as any, conditions[0]) as any).orderBy(desc(teams.createdAt));
  }
  
  return await query.orderBy(desc(teams.createdAt));
};

/* ==============================
   GET BY ID
============================== */

export const getTeamById = async (id: number) => {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.teamId, id));

  if (!team) {
    throw new Error("Team not found");
  }

  return team;
};

/* ==============================
   UPDATE
============================== */

export const updateTeam = async (id: number, data: UpdateTeamInput) => {
  const patch: Partial<typeof teams.$inferInsert> = {};

  if (data.name !== undefined) patch.name = data.name;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  
  patch.updatedAt = new Date();

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update");
  }

  const [updated] = await db
    .update(teams)
    .set(patch)
    .where(eq(teams.teamId, id))
    .returning();

  if (!updated) {
    throw new Error("Team not found");
  }

  return updated;
};

/* ==============================
   DELETE
============================== */

export const deleteTeam = async (id: number) => {
  const deleted = await db
    .delete(teams)
    .where(eq(teams.teamId, id))
    .returning();

  if (deleted.length === 0) {
    throw new Error("Team not found");
  }

  return { message: "Team deleted successfully" };
};