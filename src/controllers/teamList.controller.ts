import { Request, Response } from "express";
import {
  createTeam,
  getAllTeams,
  updateTeam,
  deleteTeam,
  getTeamById,
} from "../models/team.model";
import { redisDel, redisGetJson, redisSetJson } from "../config/redis";

const TEAMS_CACHE_KEY = "teams-list";
const TEAMS_CACHE_TTL_SECONDS = 300; // 5 min

/* ==============================
   CREATE TEAM
   POST /api/team
============================== */
export const createTeamController = async (req: Request, res: Response) => {
  try {
    console.log("createTeamController req.body", req.body);
    
    const teamData = {
      name: req.body.name,
      createdBy: req.user?.id,
    };
    
    const team = await createTeam(teamData);
    
    // Clear cache after creating new team
    try {
      await redisDel(TEAMS_CACHE_KEY);
    } catch {
      // ignore redis error
    }
    
    res.status(201).json({ success: true, data: team });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   GET ALL TEAMS
   GET /api/team
============================== */
export const getAllTeamsController = async (req: Request, res: Response) => {
  try {
    const { isActive } = req.query;
    
    // Build filters
    const filters: any = {};
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    
    // Generate cache key
    const cacheKey = `${TEAMS_CACHE_KEY}:${JSON.stringify(filters)}`;
    
    // Check cache
    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }
    
    // Fetch from database
    const teams = await getAllTeams(filters);
    
    // Store in cache
    await redisSetJson(cacheKey, teams, TEAMS_CACHE_TTL_SECONDS);
    
    res.json({ 
      success: true, 
      data: teams,
      count: teams.length 
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   GET TEAM BY ID
   GET /api/team/:id
============================== */
export const getTeamByIdController = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid team id");
    
    // Check cache
    const cacheKey = `team-${id}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }
    
    // Fetch from database
    const team = await getTeamById(id);
    
    // Store in cache
    await redisSetJson(cacheKey, team, TEAMS_CACHE_TTL_SECONDS);
    
    res.json({ success: true, data: team });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   UPDATE TEAM
   PUT /api/team/:id
============================== */
export const updateTeamController = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid team id");
    
    const updated = await updateTeam(id, req.body);
    
    // Clear cache
    try {
      await redisDel(TEAMS_CACHE_KEY);
      await redisDel(`team-${id}`);
    } catch {
      // ignore
    }
    
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   DELETE TEAM
   DELETE /api/team/:id
============================== */
export const deleteTeamController = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid team id");
    
    const result = await deleteTeam(id);
    
    // Clear cache
    try {
      await redisDel(TEAMS_CACHE_KEY);
      await redisDel(`team-${id}`);
    } catch {
      // ignore
    }
    
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};