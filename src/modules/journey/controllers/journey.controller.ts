import type { Request, Response } from "express";
import { isModulesDbConfigured } from "../../../config/databaseConnectionSecond";
import { canUserViewClient } from "../../clients/services/clientAccess.service";
import {
  getJourneyClientMeta,
  resolveJourneyClient,
} from "../services/journeyClient.service";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import {
  getCachedClientJourneySummary,
  getCachedClientJourneyTimeline,
} from "../cache/journey.cache.service";
import { getClientActivityFeed } from "../services/activityFeed.service";

function requireModulesDb(res: Response): boolean {
  if (!isModulesDbConfigured()) {
    res.status(503).json({ error: "Modules DB not configured" });
    return false;
  }
  return true;
}

function viewerFromReq(req: Request): { id: number; role: string } | null {
  const user = req.user as { id?: number; role?: string } | undefined;
  if (!user?.id || !user.role) return null;
  return { id: Number(user.id), role: user.role };
}

async function resolveAndAuthorizeClient(
  req: Request,
  res: Response
): Promise<{ clientUuid: string; legacyClientId: number | null; counsellorId: number | null } | null> {
  const clientIdParam = req.params.clientId?.trim();
  if (!clientIdParam) {
    res.status(400).json({ error: "clientId is required" });
    return null;
  }

  const viewer = viewerFromReq(req);
  if (!viewer) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const resolved = await resolveJourneyClient(clientIdParam);
  if (!resolved) {
    res.status(404).json({ error: "Client not found in modules DB" });
    return null;
  }

  const meta = await getJourneyClientMeta(resolved);

  const journeyViewAll = [
    "admin",
    "superadmin",
    "manager",
    "developer",
    "branchmanager",
    "cx",
    "binding",
    "application",
  ] as const;

  let allowed = (journeyViewAll as readonly string[]).includes(viewer.role);

  if (!allowed && viewer.role === "telecaller") {
    allowed = meta.telecallerId != null && meta.telecallerId === viewer.id;
  }

  if (
    !allowed &&
    viewer.role === "counsellor" &&
    meta.legacyClientId != null
  ) {
    allowed = await canUserViewClient(
      meta.legacyClientId,
      viewer.id,
      viewer.role
    );
  }

  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return {
    clientUuid: resolved.clientUuid,
    legacyClientId: meta.legacyClientId,
    counsellorId: meta.counsellorId,
  };
}

/**
 * GET /api/modules/clients/:clientId/journey-timeline
 *
 * clientId — modules UUID or legacy CRM client_information.id
 */
export async function getJourneyTimelineController(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireModulesDb(res)) return;

  try {
    const client = await resolveAndAuthorizeClient(req, res);
    if (!client) return;

    const result = await getCachedClientJourneyTimeline(client.clientUuid);
    res.json({
      clientId: client.clientUuid,
      legacyClientId: client.legacyClientId,
      counsellorId: client.counsellorId,
      enrollmentDate: result.data.enrollmentDate,
      createdAt: result.data.createdAt,
      events: result.data.events,
      total: result.data.events.length,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    res.status(500).json({ error: msg });
  }
}

/**
 * GET /api/modules/clients/:clientId/activity-feed
 *
 * Unified audit feed: journey events + visa status/assignment events +
 * legacy activity_log (client edits, payments, product payments, finance).
 *
 * Query params:
 *   page     — 1-based page number (default 1)
 *   pageSize — items per page, 1–100 (default 20)
 */
export async function getActivityFeedController(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireModulesDb(res)) return;

  try {
    const client = await resolveAndAuthorizeClient(req, res);
    if (!client) return;

    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt((req.query.pageSize as string) ?? "20", 10) || 20)
    );

    const actorIdRaw = parseInt((req.query.actorId as string) ?? "", 10);
    const actorId = Number.isFinite(actorIdRaw) ? actorIdRaw : undefined;
    const phase = (req.query.phase as string) || undefined;

    const result = await getClientActivityFeed(
      client.clientUuid,
      client.legacyClientId,
      page,
      pageSize,
      { actorId, phase }
    );

    res.json({
      clientId: client.clientUuid,
      legacyClientId: client.legacyClientId,
      ...result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    res.status(500).json({ error: msg });
  }
}

/**
 * GET /api/modules/clients/:clientId/journey-summary
 *
 * clientId — modules UUID or legacy CRM client_information.id
 */
export async function getJourneySummaryController(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireModulesDb(res)) return;

  try {
    const client = await resolveAndAuthorizeClient(req, res);
    if (!client) return;

    const result = await getCachedClientJourneySummary(client.clientUuid);
    res.json({
      ...result.data,
      legacyClientId: client.legacyClientId,
      counsellorId: client.counsellorId,
      ...toApiCacheMeta(result),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    res.status(500).json({ error: msg });
  }
}
