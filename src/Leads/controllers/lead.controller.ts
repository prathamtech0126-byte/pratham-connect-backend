import { Request, Response } from "express";
import {
  createLead,
  createLeadActivity,
  getIndianNow,
  getLeadActivities,
  getLeadActivitiesEnriched,
  getLeadById,
  getLeadStructuredDetails,
  getLeadReportSummary,
  getTelecallerLeaderboard,
  listLeads,
  getTelecallerLeadSummaryRows,
  hasPendingFollowUpForLead,
  hasCounsellorPostTransferActivity,
  isLeadLocked,
  isLeadJunkLocked,
  revertJunkLead,
  updateActivityStatus,
  updateLeadActivityMessage,
  updateLeadById,
  updateLeadStructuredDetails,
  getLeadsByIds,
  convertLeadToClient,
  dropLeadByCounsellor,
  type LeadStructuredDetailsInput,
  type LeadListFilters,
} from "../models/lead.model";
import {
  getTelecallerIndividualReport,
  getCounsellorIndividualReport,
} from "../models/leadIndividualReport.model";
import { insertLeadRecord } from "../services/leadInsert.service";
import { pgNaiveIst, serializeLeadActivityTimestampsForApi } from "../../utils/pgTimestamp";
import {
  createLeadCreatedActivity,
  createLeadReasonNote,
  createLeadUpdateActivity,
} from "../services/leadActivityEvents.service";
import {
  assertValidSaleTypeLabel,
  requiresReferenceSelection,
  buildReasonNoteMessage,
  formatFollowUpCompletedMessage,
  LeadFieldValidationError,
  normalizeAndValidateLeadPayload,
  requiresReasonForEligibility,
  requiresReasonForQuality,
} from "../services/leadValidation.service";
import {
  assertReferenceInputForSource,
  enrichLeadWithReference,
  insertLeadReferenceRow,
} from "../services/leadReference.service";
import { getAllClients } from "../../models/client.model";
import { assertLeadTransferReady } from "../../utils/leadTextNormalization";
import { getCachedTelecallerDashboardStats } from "../services/telecallerStatsCache.service";
import { redisGetJson, redisSetJson } from "../../config/redis";
import {
  getLeadListCacheGen,
  invalidateLeadListCaches,
  LEAD_LIST_CACHE_PREFIX,
  publishLeadChange,
} from "../services/leadRealtime.service";
import {
  CSV_IMPORT_TEMPLATE,
  importLeadsFromCsvBuffer,
} from "../services/leadCsvImport.service";
import { applyAutoContactedProgressIfNeeded } from "../services/leadProgressRules.service";
import { buildCounsellorAssignPatch } from "../services/leadAssignment.service";
import {
  assertValidStrategy,
  buildStrategyAssignPatch,
  computeBulkStrategyAssignments,
  getLeadsForStrategyAssign,
} from "../services/leadBulkStrategyAssign.service";
import {
  flushLeadAssignmentBatch,
  onLeadAssignmentChange,
  scheduleLeadFollowupReminder,
  notifyLeadConverted,
  notifyLeadDropped,
  notifyLeadJunked,
} from "../../notification/integrations/leadNotifications";
import { AuthenticatedRequest } from "../../types/express-auth";
import { db } from "../../config/databaseConnection";
import { eq, inArray } from "drizzle-orm";
import { users } from "../../schemas/users.schema";
import {
  isLeadTransferBlocked,
  logLeadAssignment,
  logLeadCreated,
  logLeadFollowup,
  logLeadJunk,
  logLeadUpdate,
  logLeadConverted,
  logLeadDropped,
} from "../services/leadActivityLog.service";
import { buildLeadFieldChanges } from "../services/leadActivityChanges";

const LEAD_REPORT_CACHE_PREFIX = "leads:report:";

const getUserFullName = async (userId: number | null | undefined): Promise<string | null> => {
  if (userId == null) return null;
  const [row] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.fullName ?? null;
};
const LEAD_CACHE_TTL_SECONDS = 120;

export const createLeadController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const body = req.body ?? {};

    if (!body.fullName || !body.phone) {
      return res.status(400).json({
        success: false,
        message: "fullName and phone are required",
      });
    }

    const normalizedText = normalizeAndValidateLeadPayload(body, {
      requireEmail: true,
    });
    const validatedLeadType = await assertValidSaleTypeLabel(body.leadType);
    const referenceInput = assertReferenceInputForSource(
      body.leadSource,
      body.referenceMeta ?? body.reference
    );
    const referenceId = referenceInput
      ? await insertLeadReferenceRow(referenceInput)
      : null;

    // When a telecaller creates a lead, auto-assign it to themselves
    if (authReq.user?.role === "telecaller") {
      body.currentTelecallerId = authReq.user.id;
      body.assignmentStatus = "assigned";
    }

    // When a counsellor creates a lead directly, assign it to themselves
    if (authReq.user?.role === "counsellor") {
      body.currentCounsellorId = authReq.user.id;
      body.assignmentStatus = "transferred";
      body.assignedBy = authReq.user.id;
    }

    if (["admin", "developer", "manager"].includes(authReq.user?.role ?? "")) {
      body.assignedBy = authReq.user?.id;
    }

    const indianNow = getIndianNow();
    const performerName = await getUserFullName(authReq.user?.id);
    const {
      facebookCreatedAt: _fb,
      customAnswers: _ca,
      campaignId: _cid,
      campaignName: _cn,
      adsetId: _asid,
      adsetName: _asn,
      adId: _aid,
      adName: _an,
      formId: _fid,
      formName: _fn,
      profile: _profile,
      education: _education,
      languageScores: _languageScores,
      familyMembers: _familyMembers,
      reason: _reason,
      referenceMeta: _referenceMeta,
      ...leadBody
    } = body;

    const created = await insertLeadRecord(
      {
        ...leadBody,
        ...normalizedText,
        leadType: validatedLeadType ?? leadBody.leadType,
        referenceId,
        createdAt: indianNow,
        updatedAt: indianNow,
        eligibilityStatus: body.eligibilityStatus ?? null,
        leadQuality: body.leadQuality ?? null,
      },
      null,
      { userId: authReq.user?.id, performerName }
    );

    const createdWithRef = await enrichLeadWithReference(created);

    if (authReq.user?.id) {
      await logLeadCreated(req, createdWithRef, authReq.user.id);
    }

    await publishLeadChange("lead:created", createdWithRef as Record<string, unknown>, {
      notifyTelecallerId: created.currentTelecallerId ?? null,
    });

    res.status(201).json({ success: true, data: createdWithRef });
  } catch (error: any) {
    const status = error instanceof LeadFieldValidationError ? 400 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const getLeadsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const counsellorIdFromQuery = req.query.counsellorId ?? req.query.currentCounsellorId;
    const telecallerIdFromQuery = req.query.telecallerId ?? req.query.currentTelecallerId;
    const assignedScope =
      req.query.assignedScope === "true" || req.query.assignedScope === "1";
    const reportBucketRaw = req.query.reportBucket;
    const reportBucket =
      reportBucketRaw === "contacted" || reportBucketRaw === "transferred"
        ? reportBucketRaw
        : undefined;

    const filters: LeadListFilters = {
      search: rawSearch.length >= 3 ? rawSearch : undefined,
      assignmentStatus: assignedScope || reportBucket
        ? undefined
        : (req.query.assignmentStatus as string | undefined),
      progressStatus: assignedScope || reportBucket
        ? undefined
        : (req.query.progressStatus as string | undefined),
      eligibilityStatus: req.query.eligibilityStatus as string | undefined,
      leadQuality: req.query.leadQuality as string | undefined,
      currentTelecallerId: telecallerIdFromQuery
        ? Number(telecallerIdFromQuery)
        : undefined,
      currentCounsellorId: counsellorIdFromQuery
        ? Number(counsellorIdFromQuery)
        : undefined,
      isJunk: req.query.isJunk === undefined ? undefined : req.query.isJunk === "true",
      nextFollowupFrom: req.query.nextFollowupFrom as string | undefined,
      nextFollowupTo: req.query.nextFollowupTo as string | undefined,
      leadSource: req.query.leadSource as string | undefined,
      leadType: req.query.leadType as string | undefined,
      createdFrom: req.query.createdFrom as string | undefined,
      createdTo: req.query.createdTo as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      sortBy: (req.query.sortBy as any) || "updated_at",
      sortOrder: (req.query.sortOrder as any) || "desc",
      counsellorListFilter: req.query.counsellorListFilter as
        | "not_contacted"
        | "in_progress"
        | "follow_up"
        | "converted"
        | "dropped"
        | undefined,
      forReport:
        req.query.forReport === "true" ||
        req.query.forReport === "1" ||
        assignedScope ||
        Boolean(reportBucket),
      counsellorOwnList: authReq.user?.role === "counsellor",
      assignedScope,
      reportBucket,
      hasPendingFollowUp:
        req.query.hasPendingFollowUp === "true" || req.query.hasPendingFollowUp === "1"
          ? true
          : undefined,
      withoutTelecaller: req.query.withoutTelecaller === "true",
      withTelecaller: req.query.withTelecaller === "true",
      sentToMeta: req.query.sentToMeta === undefined ? undefined : req.query.sentToMeta === "true",
      metaLeadsOnly: req.query.metaLeadsOnly === "true" ? true : undefined,
      hasQuality: req.query.hasQuality === undefined ? undefined : req.query.hasQuality === "true",
      excludeUnassigned: req.query.excludeUnassigned === "true" ? true : undefined,
    };

    // Telecallers / counsellors only see their assigned leads (search runs within that scope)
    if (authReq.user?.role === "telecaller") {
      filters.currentTelecallerId = authReq.user.id;
    } else if (authReq.user?.role === "counsellor") {
      filters.currentCounsellorId = authReq.user.id;
    }

    // Include the current cache generation in the key so that a single atomic
    // INCR on invalidation makes every stale entry unreadable without needing SCAN.
    const cacheGen = await getLeadListCacheGen();
    const cacheKey = `${LEAD_LIST_CACHE_PREFIX}v${cacheGen}:${JSON.stringify(filters)}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached, cached: true });
    }

    const data = await listLeads(filters);
    await redisSetJson(cacheKey, data, LEAD_CACHE_TTL_SECONDS);
    res.json({ success: true, ...data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getTelecallerIndividualReportController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const telecallerId = Number(req.params.id);
    if (!Number.isFinite(telecallerId) || telecallerId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid telecaller id" });
    }
    if (
      authReq.user?.role === "telecaller" &&
      authReq.user.id !== telecallerId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const createdFrom = req.query.createdFrom
      ? new Date(String(req.query.createdFrom))
      : undefined;
    const createdTo = req.query.createdTo ? new Date(String(req.query.createdTo)) : undefined;
    const data = await getTelecallerIndividualReport(telecallerId, createdFrom, createdTo);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getCounsellorIndividualReportController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const counsellorId =
      authReq.user?.role === "counsellor"
        ? authReq.user.id
        : req.query.counsellorId
          ? Number(req.query.counsellorId)
          : undefined;
    if (!counsellorId || !Number.isFinite(counsellorId)) {
      return res.status(400).json({ success: false, message: "Invalid counsellor id" });
    }
    if (
      authReq.user?.role === "counsellor" &&
      authReq.user.id !== counsellorId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const createdFrom = req.query.createdFrom
      ? new Date(String(req.query.createdFrom))
      : undefined;
    const createdTo = req.query.createdTo ? new Date(String(req.query.createdTo)) : undefined;
    const data = await getCounsellorIndividualReport(counsellorId, createdFrom, createdTo);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getTelecallerLeadSummaryController = async (req: Request, res: Response) => {
  try {
    const createdFrom = req.query.createdFrom
      ? new Date(String(req.query.createdFrom))
      : undefined;
    const createdTo = req.query.createdTo ? new Date(String(req.query.createdTo)) : undefined;
    const data = await getTelecallerLeadSummaryRows(createdFrom, createdTo);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getTelecallerDashboardStatsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const telecallerId =
      authReq.user?.role === "telecaller"
        ? authReq.user.id
        : req.query.telecallerId
          ? Number(req.query.telecallerId)
          : undefined;

    if (!telecallerId || isNaN(telecallerId)) {
      return res.status(400).json({ success: false, message: "telecallerId is required" });
    }

    const createdFrom = req.query.createdFrom
      ? new Date(String(req.query.createdFrom))
      : undefined;
    const createdTo = req.query.createdTo ? new Date(String(req.query.createdTo)) : undefined;
    const followupFrom = req.query.followupFrom
      ? new Date(String(req.query.followupFrom))
      : undefined;
    const followupTo = req.query.followupTo ? new Date(String(req.query.followupTo)) : undefined;

    const data = await getCachedTelecallerDashboardStats({
      telecallerId,
      createdFrom: createdFrom?.toISOString(),
      createdTo: createdTo?.toISOString(),
      followupFrom: followupFrom?.toISOString(),
      followupTo: followupTo?.toISOString(),
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getLeadByIdController = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const authReq = req as AuthenticatedRequest;
    const [lead, allActivities] = await Promise.all([
      getLeadById(id),
      getLeadActivitiesEnriched(id),
    ]);

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const isTelecallerViewer = authReq.user?.role === "telecaller";
    let activities = allActivities;

    const isConvertedLead =
      lead.progressStatus === "converted" || lead.assignmentStatus === "converted";

    if (isTelecallerViewer) {
      if (isConvertedLead) {
        activities = allActivities.filter(
          (a) =>
            a.activityType === "counselor_assign" ||
            a.activityType === "lead_created" ||
            a.activityType === "lead_update" ||
            (a.activityType === "note" &&
              /convert|converted|client/i.test(String(a.message ?? "")))
        );
      } else {
        activities = allActivities.filter(
          (a) =>
            a.activityType === "assignment_change" ||
            a.activityType === "counselor_assign" ||
            a.activityType === "lead_created" ||
            a.activityType === "lead_update" ||
            (a.userId === authReq.user?.id &&
              ["note", "followup", "call_log"].includes(a.activityType))
        );
      }
    }

    const structured = await getLeadStructuredDetails(id);

    const pendingFollowUp = await hasPendingFollowUpForLead(id);
    const counsellorActivity = await hasCounsellorPostTransferActivity(id);
    const isAdminLike = ["admin", "developer", "manager", "superadmin", "marketing_head"].includes(
      authReq.user?.role ?? ""
    );
    const isConverted =
      lead.progressStatus === "converted" || lead.assignmentStatus === "converted";
    const role = authReq.user?.role;
    const leadWithReference = await enrichLeadWithReference(lead);

    res.json({
      success: true,
      data: {
        lead: { ...leadWithReference, pendingFollowUp },
        activities,
        ...structured,
        meta: {
          pendingFollowUp,
          counsellorHasActivity: counsellorActivity,
          canRevertJunk: isAdminLike && isLeadJunkLocked(lead),
          canModify: !isLeadLocked(lead, role),
          canTransfer:
            !isLeadLocked(lead, role) &&
            !pendingFollowUp &&
            !!lead.eligibilityStatus &&
            !!lead.leadQuality &&
            (lead.assignmentStatus !== "transferred" ||
              (!counsellorActivity && isTelecallerViewer)),
          canReassignCounsellor:
            lead.assignmentStatus === "transferred" && !counsellorActivity && isTelecallerViewer,
          isAdminLike,
          isConverted,
        },
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateLeadController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const body = req.body ?? {};
    const {
      reason,
      profile,
      education,
      languageScores,
      familyMembers,
      facebookCreatedAt: _fb,
      customAnswers: _ca,
      campaignId: _cid,
      campaignName: _cn,
      adsetId: _asid,
      adsetName: _asn,
      adId: _aid,
      adName: _an,
      formId: _fid,
      formName: _fn,
      ...patch
    } = body as Record<string, unknown>;

    const role = authReq.user?.role ?? "";
    const performerName = await getUserFullName(authReq.user?.id);

    if (
      requiresReasonForEligibility(role, patch.eligibilityStatus as string | undefined) &&
      !String(reason ?? "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when marking eligibility as future prospect or not eligible",
      });
    }
    if (
      requiresReasonForQuality(role, patch.leadQuality as string | undefined) &&
      !String(reason ?? "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when marking lead quality as bad",
      });
    }

    const previous = await getLeadById(id);
    if (!previous) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    applyAutoContactedProgressIfNeeded(patch, previous);

    if (isLeadLocked(previous, authReq.user?.role)) {
      return res.status(400).json({
        success: false,
        message: isLeadJunkLocked(previous)
          ? "Junk leads are read-only and cannot be modified"
          : "Converted leads cannot be modified by telecallers",
      });
    }

    const isCounsellor = role === "counsellor";
    const marksConverted =
      patch.assignmentStatus === "converted" || patch.progressStatus === "converted";
    if (isCounsellor && marksConverted) {
      if (!previous.eligibilityStatus) {
        return res.status(400).json({
          success: false,
          message: "Set eligibility before converting to client",
        });
      }
      if (!previous.leadQuality) {
        return res.status(400).json({
          success: false,
          message: "Set lead quality before converting to client",
        });
      }
      const pendingFollowUp = await hasPendingFollowUpForLead(id);
      if (pendingFollowUp) {
        return res.status(400).json({
          success: false,
          message: "Complete the pending follow-up before converting to client",
        });
      }
    }

    const normalizedText = normalizeAndValidateLeadPayload(patch);
    if (patch.leadType !== undefined) {
      patch.leadType = (await assertValidSaleTypeLabel(patch.leadType as string)) ?? null;
    }
    const nextSource =
      patch.leadSource !== undefined ? (patch.leadSource as string) : previous.leadSource;
    if (
      patch.referenceMeta !== undefined ||
      patch.reference !== undefined ||
      patch.leadSource !== undefined
    ) {
      if (!requiresReferenceSelection(nextSource)) {
        patch.referenceId = null;
      } else if (patch.referenceMeta !== undefined || patch.reference !== undefined) {
        const refInput = assertReferenceInputForSource(
          nextSource,
          patch.referenceMeta ?? patch.reference
        );
        if (refInput) {
          patch.referenceId = await insertLeadReferenceRow(refInput);
        }
      }
      delete patch.referenceMeta;
      delete patch.reference;
    }
    Object.assign(patch, normalizedText);

    // When explicitly marking as converted via generic update, stamp convertedAt
    if (patch.assignmentStatus === "converted" && !previous.convertedAt) {
      patch.convertedAt = getIndianNow();
    }

    if (Object.keys(patch).length > 0) {
      await updateLeadById(id, patch);
    }

    if (profile || education || languageScores || familyMembers) {
      await updateLeadStructuredDetails(id, {
        profile,
        education,
        languageScores,
        familyMembers,
      } as LeadStructuredDetailsInput);
    }

    const enriched = await getLeadById(id);
    if (!enriched) {
      return res.status(404).json({ success: false, message: "Lead not found after update" });
    }

    const structured = await getLeadStructuredDetails(id);
    const changes = buildLeadFieldChanges(previous as Record<string, unknown>, patch);

    if (changes.length > 0 || profile || education || languageScores || familyMembers) {
      await createLeadUpdateActivity({
        leadId: id,
        userId: authReq.user?.id,
        performerName,
        changes:
          changes.length > 0
            ? changes
            : [{ field: "Personal details", old: "—", new: "Updated" }],
      });
    }

    if (String(reason ?? "").trim()) {
      const touchesEligibility = Object.prototype.hasOwnProperty.call(patch, "eligibilityStatus");
      const touchesQuality = Object.prototype.hasOwnProperty.call(patch, "leadQuality");
      let reasonMsg: string | null = null;
      let reasonType: "eligibility" | "quality" | null = null;

      if (touchesEligibility && patch.eligibilityStatus != null) {
        reasonMsg = buildReasonNoteMessage(
          "eligibility",
          String(patch.eligibilityStatus),
          String(reason)
        );
        reasonType = "eligibility";
      } else if (touchesQuality && patch.leadQuality != null) {
        reasonMsg = buildReasonNoteMessage("quality", String(patch.leadQuality), String(reason));
        reasonType = "quality";
      }

      if (reasonMsg && reasonType) {
        await createLeadReasonNote({
          leadId: id,
          userId: authReq.user?.id,
          performerName,
          message: reasonMsg,
          meta: { reasonType },
        });
      }
    }

    if (authReq.user?.id) {
      await logLeadUpdate(req, {
        previous,
        updated: enriched,
        performedBy: authReq.user.id,
        patch,
      });
    }

    const enrichedWithRef = await enrichLeadWithReference(enriched);
    const changeEvent = patch.assignmentStatus === "converted" ? "lead:converted" : "lead:updated";
    await publishLeadChange(changeEvent, enrichedWithRef as Record<string, unknown>);

    res.json({ success: true, data: { ...enrichedWithRef, ...structured } });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** Search all clients (any counsellor) for lead client-reference picker. */
export const searchLeadReferenceClientsController = async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search ?? req.query.q ?? "").trim();
    if (search.length < 3) {
      return res.json({ success: true, data: [] });
    }
    const rows = await getAllClients(search);
    const data = rows.slice(0, 25).map((c) => ({
      id: Number(c.clientId),
      fullName: c.fullName,
      counsellorId: c.counsellorId ?? null,
      counsellorName: c.counsellorName ?? null,
    }));
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const addLeadActivityController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const body = req.body ?? {};
    if (!body.activityType) {
      return res.status(400).json({ success: false, message: "activityType is required" });
    }

    const existingLead = await getLeadById(leadId);
    if (!existingLead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (isLeadLocked(existingLead, authReq.user?.role)) {
      return res.status(400).json({
        success: false,
        message: isLeadJunkLocked(existingLead)
          ? "Junk leads are read-only"
          : "Converted leads cannot be modified by telecallers",
      });
    }

    const activity = await createLeadActivity({
      leadId,
      userId: authReq.user?.id ?? null,
      activityType: body.activityType,
      message: body.message ?? null,
      followupAt: body.followupAt ? pgNaiveIst(new Date(body.followupAt)) : null,
      status: body.status ?? "pending",
      meta: body.meta ?? {},
      updatedAt: getIndianNow(),
    });

    const leadPatch: Record<string, unknown> = {};
    // Only update latestNote for note activities, not for followup activities
    if (body.message && body.activityType === "note") {
      leadPatch.latestNote = body.message;
    }
    if (body.followupAt) {
      leadPatch.nextFollowupAt = pgNaiveIst(new Date(body.followupAt));
      leadPatch.progressStatus = "follow_up";
    }
    const followupScheduledAt = body.followupAt
      ? pgNaiveIst(new Date(body.followupAt))
      : null;
    // Notes and call logs on a not_contacted lead → contacted
    if (body.activityType === "note" || body.activityType === "call_log") {
      const currentLead = await getLeadById(leadId);
      if (currentLead?.progressStatus === "not_contacted") {
        leadPatch.progressStatus = "contacted";
      }
    }
    let enrichedLead = existingLead;
    if (Object.keys(leadPatch).length) {
      await updateLeadById(leadId, leadPatch);
      enrichedLead = (await getLeadById(leadId)) ?? existingLead;
      await publishLeadChange("lead:updated", enrichedLead as Record<string, unknown>);
    }

    await publishLeadChange("lead:activity", { leadId, activity } as Record<string, unknown>);

    if (followupScheduledAt && enrichedLead) {
      scheduleLeadFollowupReminder(
        {
          id: enrichedLead.id,
          fullName: enrichedLead.fullName,
          currentCounsellorId: enrichedLead.currentCounsellorId,
          currentTelecallerId: enrichedLead.currentTelecallerId,
        },
        followupScheduledAt,
        { alreadyPgNaive: true }
      ).catch((e) => console.error("[notification] followup schedule:", e));
    }

    res.status(201).json({
      success: true,
      data: serializeLeadActivityTimestampsForApi(activity),
      lead: enrichedLead,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const assignLeadController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const { telecallerId, counsellorId } = req.body ?? {};
    if (telecallerId == null && counsellorId == null) {
      return res.status(400).json({
        success: false,
        message: "telecallerId or counsellorId is required",
      });
    }

    const currentLead = await getLeadById(leadId);
    if (!currentLead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const isAdminLike = ["admin", "developer", "manager", "superadmin", "marketing_head"].includes(
      authReq.user?.role ?? ""
    );
    const isTelecaller = authReq.user?.role === "telecaller";
    if (isLeadLocked(currentLead, authReq.user?.role)) {
      return res.status(400).json({
        success: false,
        message: isLeadJunkLocked(currentLead)
          ? "Junk leads are read-only and cannot be transferred"
          : "Converted leads cannot be transferred by telecallers",
      });
    }

    if (counsellorId != null && isTelecaller) {
      try {
        const normalized = assertLeadTransferReady(currentLead);
        await updateLeadById(leadId, normalized);
        Object.assign(currentLead, normalized);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Lead details must be corrected before transfer";
        return res.status(400).json({ success: false, message });
      }
    }

    if (counsellorId != null) {
      if (!currentLead.eligibilityStatus) {
        return res.status(400).json({
          success: false,
          message: "Set eligibility before transferring to counsellor",
        });
      }
      if (!currentLead.leadQuality) {
        return res.status(400).json({
          success: false,
          message: "Set lead quality before transferring to counsellor",
        });
      }

      const pendingFollowUp = await hasPendingFollowUpForLead(leadId);
      if (pendingFollowUp && !isAdminLike) {
        return res.status(400).json({
          success: false,
          message: "Complete the scheduled follow-up before transferring to counsellor",
        });
      }

      const alreadyTransferred = currentLead.assignmentStatus === "transferred";
      if (alreadyTransferred && isTelecaller) {
        const counsellorActivity = await hasCounsellorPostTransferActivity(leadId);
        if (counsellorActivity) {
          return res.status(400).json({
            success: false,
            message:
              "Counsellor has already worked on this lead. Only admin can reassign it.",
          });
        }
      } else if (alreadyTransferred && !isAdminLike) {
        return res.status(400).json({
          success: false,
          message: "Lead is already transferred to a counsellor",
        });
      }
    }

    const assignPatch: Record<string, unknown> =
      counsellorId != null
        ? buildCounsellorAssignPatch(currentLead, counsellorId, authReq.user?.id ?? 0, {
            isAdminLike,
          })
        : {
            assignedBy: authReq.user?.id,
            currentTelecallerId: telecallerId,
            currentCounsellorId: null,
            assignmentStatus: "assigned",
          };

    await updateLeadById(leadId, assignPatch);
    const updated = await getLeadById(leadId);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Lead not found after assign" });
    }

    const performerName = await getUserFullName(authReq.user?.id);
    const nameIds = [telecallerId, counsellorId].filter((id): id is number => id != null);
    const nameRows =
      nameIds.length > 0
        ? await db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(inArray(users.id, nameIds))
        : [];
    const nameMap = new Map(nameRows.map((row) => [row.id, row.fullName]));
    const telecallerName = telecallerId != null ? nameMap.get(telecallerId) ?? null : null;
    const counsellorName = counsellorId != null ? nameMap.get(counsellorId) ?? null : null;

    const assignMessage = counsellorId
      ? `${performerName ?? "Someone"} transferred this lead to counsellor ${counsellorName ?? counsellorId}`
      : `${performerName ?? "Someone"} assigned this lead to telecaller ${telecallerName ?? telecallerId}`;

    await createLeadActivity({
      leadId,
      userId: authReq.user?.id ?? null,
      activityType: counsellorId ? "counselor_assign" : "assignment_change",
      message: assignMessage,
      meta: {
        telecallerId,
        counsellorId,
        telecallerName,
        counsellorName,
        performedByName: performerName,
      },
      updatedAt: getIndianNow(),
    });

    if (authReq.user?.id) {

      await logLeadAssignment(req, {
        lead: updated,
        previous: currentLead,
        performedBy: authReq.user.id,
        telecallerId: telecallerId ?? null,
        counsellorId: counsellorId ?? null,
        telecallerName: telecallerId != null ? nameMap.get(telecallerId) ?? null : null,
        counsellorName: counsellorId != null ? nameMap.get(counsellorId) ?? null : null,
      });
    }

    await publishLeadChange("lead:assigned", updated as Record<string, unknown>, {
      notifyTelecallerId: telecallerId ?? updated.currentTelecallerId ?? null,
      notifyCounsellorId: counsellorId ?? null,
    });

    onLeadAssignmentChange(currentLead, updated, {
      telecallerId: telecallerId ?? null,
      counsellorId: counsellorId ?? null,
      actorUserId: authReq.user?.id ?? null,
      performerName: performerName ?? null,
    }).catch((e) => console.error("[notification] assign lead:", e));

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const markLeadJunkController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.role === "counsellor") {
      return res.status(403).json({
        success: false,
        message: "Counsellors cannot mark leads as junk. Use Client Drop instead.",
      });
    }
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const { reason } = req.body ?? {};
    const previous = await getLeadById(leadId);
    if (!previous) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (isLeadLocked(previous, authReq.user?.role)) {
      return res.status(400).json({
        success: false,
        message: isLeadJunkLocked(previous)
          ? "Lead is already junk"
          : "Converted leads cannot be marked as junk by telecallers",
      });
    }

    const updated = await updateLeadById(leadId, {
      isJunk: true,
      progressStatus: "junk",
    });

    await createLeadActivity({
      leadId,
      userId: authReq.user?.id ?? null,
      activityType: "note",
      message: "Lead marked as junk",
      meta: {},
      updatedAt: getIndianNow(),
    });

    if (authReq.user?.id) {
      await logLeadJunk(req, updated, previous, authReq.user.id, reason);
    }

    const enriched = await getLeadById(leadId);
    await publishLeadChange("lead:junked", (enriched ?? updated) as Record<string, unknown>);
    notifyLeadJunked(
      {
        id: (enriched ?? updated).id,
        fullName: (enriched ?? updated).fullName,
        currentCounsellorId: (enriched ?? updated).currentCounsellorId,
        currentTelecallerId: (enriched ?? updated).currentTelecallerId,
      },
      authReq.user?.id ?? null
    ).catch((e) => console.error("[notification] junk:", e));
    res.json({ success: true, data: enriched ?? updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const revertLeadJunkController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const role = authReq.user?.role ?? "";
    if (!["admin", "developer", "manager", "superadmin"].includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins can restore junk leads",
      });
    }

    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const { telecallerId, counsellorId } = req.body ?? {};
    const hasTelecaller = telecallerId != null && telecallerId !== "";
    const hasCounsellor = counsellorId != null && counsellorId !== "";

    if (hasTelecaller && hasCounsellor) {
      return res.status(400).json({ success: false, message: "Choose either telecaller or counsellor" });
    }

    const parsedTelecallerId = hasTelecaller ? Number(telecallerId) : null;
    const parsedCounsellorId = hasCounsellor ? Number(counsellorId) : null;

    if (
      (hasTelecaller && (parsedTelecallerId == null || isNaN(parsedTelecallerId))) ||
      (hasCounsellor && (parsedCounsellorId == null || isNaN(parsedCounsellorId)))
    ) {
      return res.status(400).json({ success: false, message: "Invalid assignee id" });
    }

    const previous = await getLeadById(leadId);
    const restored = await revertJunkLead(leadId, {
      telecallerId: parsedTelecallerId,
      counsellorId: parsedCounsellorId,
      assignedBy: authReq.user?.id ?? null,
    });

    if ((parsedTelecallerId != null || parsedCounsellorId != null) && previous && authReq.user?.id) {
      const assigneeId = parsedCounsellorId ?? parsedTelecallerId;
      const assigneeName = await getUserFullName(assigneeId);
      await logLeadAssignment(req, {
        lead: restored,
        previous,
        performedBy: authReq.user.id,
        telecallerId: parsedTelecallerId,
        counsellorId: parsedCounsellorId,
        telecallerName: parsedCounsellorId == null ? assigneeName : null,
        counsellorName: parsedCounsellorId != null ? assigneeName : null,
      });
    }

    await publishLeadChange("lead:reverted", restored as Record<string, unknown>);
    res.json({ success: true, data: restored });
  } catch (error: any) {
    const status = error.message?.includes("not found") ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const convertLeadToClientController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (authReq.user.role !== "counsellor") {
      return res.status(403).json({ success: false, message: "Only counsellors can convert leads" });
    }

    const leadId = Number(req.params.id);
    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const previous = await getLeadById(leadId);
    if (!previous) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const { lead, client } = await convertLeadToClient(leadId, authReq.user.id);

    await createLeadActivity({
      leadId,
      userId: authReq.user.id,
      activityType: "note",
      message: "Converted to client",
      meta: { clientId: client?.client?.clientId },
      updatedAt: getIndianNow(),
    });

    const clientId = client?.client?.clientId;
    await logLeadConverted(req, lead, previous, authReq.user.id, clientId);

    await publishLeadChange("lead:converted", lead as Record<string, unknown>);

    notifyLeadConverted(
      {
        id: lead.id,
        fullName: lead.fullName,
        currentCounsellorId: lead.currentCounsellorId,
        currentTelecallerId: lead.currentTelecallerId,
      },
      authReq.user.id
    ).catch((e) => console.error("[notification] convert:", e));

    res.json({ success: true, data: { lead, client } });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const dropLeadByCounsellorController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (authReq.user.role !== "counsellor") {
      return res.status(403).json({ success: false, message: "Only counsellors can drop leads" });
    }

    const leadId = Number(req.params.id);
    const { reason } = req.body ?? {};
    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const previous = await getLeadById(leadId);
    if (!previous) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const updated = await dropLeadByCounsellor(leadId, authReq.user.id, String(reason ?? ""));

    await createLeadActivity({
      leadId,
      userId: authReq.user.id,
      activityType: "note",
      message: `Client dropped: ${String(reason).trim()}`,
      meta: { reason: String(reason).trim() },
      updatedAt: getIndianNow(),
    });

    await logLeadDropped(req, updated, previous, authReq.user.id, String(reason).trim());

    await publishLeadChange("lead:dropped", updated as Record<string, unknown>);

    notifyLeadDropped(
      {
        id: updated.id,
        fullName: updated.fullName,
        currentCounsellorId: updated.currentCounsellorId,
        currentTelecallerId: updated.currentTelecallerId,
      },
      authReq.user.id
    ).catch((e) => console.error("[notification] drop:", e));

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const markLeadFollowupController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const leadId = Number(req.params.id);

    if (isNaN(leadId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const { followupAt, message } = req.body ?? {};

    if (!followupAt) {
      return res.status(400).json({ success: false, message: "followupAt is required" });
    }

    const followupDate = new Date(followupAt);
    if (isNaN(followupDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid followupAt date" });
    }
    if (followupDate.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Follow-up date and time must be in the future",
      });
    }

    const previous = await getLeadById(leadId);
    if (!previous) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (isLeadLocked(previous, authReq.user?.role)) {
      return res.status(400).json({
        success: false,
        message: isLeadJunkLocked(previous)
          ? "Junk leads are read-only"
          : "Converted leads cannot be modified by telecallers",
      });
    }

    await updateLeadById(leadId, {
      nextFollowupAt: pgNaiveIst(followupDate),
      progressStatus: "follow_up",
    });
    const enriched = await getLeadById(leadId);
    if (!enriched) {
      return res.status(404).json({ success: false, message: "Lead not found after follow-up" });
    }

    const performerName = await getUserFullName(authReq.user?.id);
    const followupActivity = await createLeadActivity({
      leadId,
      userId: authReq.user?.id ?? null,
      activityType: "followup",
      message: message?.trim() || null,
      followupAt: pgNaiveIst(followupDate),
      status: "pending",
      meta: { performedByName: performerName },
      updatedAt: getIndianNow(),
    });

    if (authReq.user?.id) {
      await logLeadFollowup(
        req,
        enriched,
        previous,
        authReq.user.id,
        followupDate,
        message?.trim() || null
      );
    }

    await publishLeadChange("lead:followup", enriched as Record<string, unknown>);

    scheduleLeadFollowupReminder(
      {
        id: enriched.id,
        fullName: enriched.fullName,
        currentCounsellorId: enriched.currentCounsellorId,
        currentTelecallerId: enriched.currentTelecallerId,
      },
      pgNaiveIst(followupDate),
      { alreadyPgNaive: true }
    ).catch((e) => console.error("[notification] followup schedule:", e));

    const activities = await getLeadActivitiesEnriched(leadId);
    const createdActivity =
      activities.find((a) => a.id === followupActivity.id) ??
      serializeLeadActivityTimestampsForApi({
        ...followupActivity,
        userName: performerName,
      });

    res.json({ success: true, data: enriched, activity: createdActivity });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const createLeadActivityController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const leadId = Number(req.params.id);

    if (isNaN(leadId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const {
      activityType,
      message,
      followupAt,
      status,
      meta,
    } = req.body ?? {};

    if (!activityType) {
      return res.status(400).json({
        success: false,
        message: "activityType is required",
      });
    }

    let parsedFollowup: Date | null = null;

    if (followupAt) {
      parsedFollowup = new Date(followupAt);

      if (isNaN(parsedFollowup.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid follow-up date",
        });
      }
    }

    // Create activity
    const activity = await createLeadActivity({
      leadId,
      userId: authReq.user?.id ?? null,
      activityType,
      message: message?.trim() || null,
      followupAt: parsedFollowup ? pgNaiveIst(parsedFollowup) : null,
      status: status || "completed",
      meta: meta || {},
      updatedAt: getIndianNow(),
    });

    // If followup activity => update lead main table
    let updatedLead = null;

    if (activityType === "followup" && parsedFollowup) {
      const followupNaive = pgNaiveIst(parsedFollowup);
      updatedLead = await updateLeadById(leadId, {
        nextFollowupAt: followupNaive,
        progressStatus: "follow_up",
        updatedAt: getIndianNow(),
      });
      if (updatedLead) {
        const leadRow = await getLeadById(leadId);
        if (leadRow) {
          scheduleLeadFollowupReminder(
            {
              id: leadRow.id,
              fullName: leadRow.fullName,
              currentCounsellorId: leadRow.currentCounsellorId,
              currentTelecallerId: leadRow.currentTelecallerId,
            },
            followupNaive,
            { alreadyPgNaive: true }
          ).catch((e) => console.error("[notification] followup schedule:", e));
        }
      }
    } else if (activityType === "note" && message?.trim()) {
      const current = await getLeadById(leadId);
      const notePatch: Record<string, unknown> = {
        latestNote: message.trim(),
        updatedAt: getIndianNow(),
      };
      if (current?.progressStatus === "not_contacted") {
        notePatch.progressStatus = "contacted";
      }
      updatedLead = await updateLeadById(leadId, notePatch);
      if (updatedLead) {
        await publishLeadChange("lead:updated", updatedLead as Record<string, unknown>);
      }
    }

    await publishLeadChange("lead:activity_created", {
      leadId,
      lead: updatedLead,
      activity,
    });

    return res.json({
      success: true,
      message: "Activity created successfully",
      data: {
        lead: updatedLead,
        activity: serializeLeadActivityTimestampsForApi(activity),
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create activity",
    });
  }
};

export const getTelecallerLeaderboardController = async (_req: Request, res: Response) => {
  try {
    const data = await getTelecallerLeaderboard();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const bulkAssignLeadsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { leadIds, telecallerId, counsellorId, removeFromCounsellor, removeFromTelecaller } =
      req.body ?? {};

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ success: false, message: "leadIds is required" });
    }

    if (
      (telecallerId == null && counsellorId == null) ||
      (telecallerId != null && counsellorId != null)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide either telecallerId or counsellorId",
      });
    }

    const ids = leadIds.map((id: unknown) => Number(id)).filter((id: number) => !isNaN(id));
    const rows = await getLeadsByIds(ids);
    const rowMap = new Map(rows.map((row) => [row.id, row]));

    const isAdminLike = ["admin", "developer", "manager", "superadmin", "marketing_head"].includes(
      authReq.user?.role ?? ""
    );

    const blocked: number[] = [];
    const missing: number[] = [];
    const toUpdate: number[] = [];

    for (const id of ids) {
      const lead = rowMap.get(id);
      if (!lead) {
        missing.push(id);
        continue;
      }
      if (isLeadTransferBlocked(lead)) {
        blocked.push(id);
        continue;
      }
      if (
        counsellorId != null &&
        !isAdminLike &&
        (!lead.eligibilityStatus || !lead.leadQuality)
      ) {
        blocked.push(id);
        continue;
      }
      toUpdate.push(id);
    }

    const assigneeId = counsellorId ?? telecallerId;
    const [nameRows, performerName] = await Promise.all([
      assigneeId != null
        ? db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(eq(users.id, Number(assigneeId)))
        : Promise.resolve([]),
      getUserFullName(authReq.user?.id),
    ]);
    const assigneeName = nameRows[0]?.fullName ?? null;

    const updatedItems: Awaited<ReturnType<typeof updateLeadById>>[] = [];
    const assigneesToFlush = new Set<number>();

    for (const leadId of toUpdate) {
      const currentLead = rowMap.get(leadId);
      if (!currentLead) continue;

      let assignPatch: Record<string, unknown>;
      if (counsellorId != null) {
        assignPatch = buildCounsellorAssignPatch(currentLead, counsellorId, authReq.user?.id ?? 0, {
          isAdminLike,
        });
        if (removeFromTelecaller === true) {
          assignPatch.currentTelecallerId = null;
        }
      } else {
        assignPatch = {
          assignedBy: authReq.user?.id,
          currentTelecallerId: telecallerId,
          currentCounsellorId:
            removeFromCounsellor === true ? null : (currentLead.currentCounsellorId ?? null),
          assignmentStatus: "assigned",
        };
      }

      const updated = await updateLeadById(leadId, assignPatch);

      await createLeadActivity({
        leadId,
        userId: authReq.user?.id ?? null,
        activityType: counsellorId ? "counselor_assign" : "assignment_change",
        message: counsellorId
          ? `${performerName ?? "Someone"} transferred this lead to counsellor ${assigneeName ?? counsellorId}`
          : `${performerName ?? "Someone"} assigned this lead to telecaller ${assigneeName ?? telecallerId}`,
        meta: {
          telecallerId,
          counsellorId,
          bulk: true,
          telecallerName: counsellorId == null ? assigneeName : null,
          counsellorName: counsellorId != null ? assigneeName : null,
          performedByName: performerName,
        },
        updatedAt: getIndianNow(),
      });

      if (authReq.user?.id) {
        await logLeadAssignment(req, {
          lead: updated,
          previous: currentLead,
          performedBy: authReq.user.id,
          telecallerId: telecallerId ?? null,
          counsellorId: counsellorId ?? null,
          telecallerName: counsellorId == null ? assigneeName : null,
          counsellorName: counsellorId != null ? assigneeName : null,
          bulk: true,
        });
      }

      if (updated) {
        await onLeadAssignmentChange(currentLead, updated, {
          telecallerId: telecallerId ?? null,
          counsellorId: counsellorId ?? null,
          actorUserId: authReq.user?.id ?? null,
          performerName,
          deferDelivery: true,
        });
        if (telecallerId != null) assigneesToFlush.add(Number(telecallerId));
        if (counsellorId != null) assigneesToFlush.add(Number(counsellorId));
      }

      updatedItems.push(updated);
    }

    for (const userId of assigneesToFlush) {
      try {
        await flushLeadAssignmentBatch(userId);
      } catch (e) {
        console.error("[notification] bulk assign flush:", e);
      }
    }

    await publishLeadChange("lead:bulk_assigned", {
      updatedCount: updatedItems.length,
      blocked,
      missing,
    });

    res.json({
      success: true,
      data: {
        updated: updatedItems,
        blocked,
        missing,
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const bulkStrategyAssignLeadsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const {
      leadIds,
      strategy,
      assignedTelecallers = [],
      assignedCounsellors = [],
      priorityWeights = {},
      removeFromPreviousAssignee = false,
      preview = false,
    } = req.body ?? {};

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ success: false, message: "leadIds is required" });
    }

    const validStrategy = assertValidStrategy(String(strategy ?? ""));
    const ids = leadIds.map((id: unknown) => Number(id)).filter((id: number) => !isNaN(id));
    const tcPool = (assignedTelecallers as unknown[])
      .map(Number)
      .filter((id) => Number.isFinite(id));
    const coPool = (assignedCounsellors as unknown[])
      .map(Number)
      .filter((id) => Number.isFinite(id));

    const isAdminLike = ["admin", "developer", "manager", "superadmin", "marketing_head"].includes(
      authReq.user?.role ?? ""
    );

    const plan = await computeBulkStrategyAssignments({
      leadIds: ids,
      strategy: validStrategy,
      assignedTelecallers: tcPool,
      assignedCounsellors: coPool,
      priorityWeights: priorityWeights ?? {},
    });

    if (preview) {
      return res.json({ success: true, data: plan });
    }

    const rowMap = new Map(
      (await getLeadsForStrategyAssign(plan.assignments.map((a) => a.leadId))).map((row) => [
        row.id,
        row,
      ])
    );
    const performerName = await getUserFullName(authReq.user?.id);
    const updatedItems: Awaited<ReturnType<typeof updateLeadById>>[] = [];
    const assigneesToFlush = new Set<number>();

    for (const assignment of plan.assignments) {
      const currentLead = rowMap.get(assignment.leadId);
      if (!currentLead) continue;

      if (
        assignment.role === "counsellor" &&
        !isAdminLike &&
        (!currentLead.eligibilityStatus || !currentLead.leadQuality)
      ) {
        plan.blocked.push(assignment.leadId);
        continue;
      }

      const assignPatch = buildStrategyAssignPatch(currentLead, assignment, authReq.user?.id ?? 0, {
        isAdminLike,
        removeFromPreviousAssignee: removeFromPreviousAssignee === true,
      });

      const updated = await updateLeadById(assignment.leadId, assignPatch);

      await createLeadActivity({
        leadId: assignment.leadId,
        userId: authReq.user?.id ?? null,
        activityType: assignment.role === "counsellor" ? "counselor_assign" : "assignment_change",
        message:
          assignment.role === "counsellor"
            ? `${performerName ?? "Someone"} distributed this lead to counsellor ${assignment.userName}`
            : `${performerName ?? "Someone"} distributed this lead to telecaller ${assignment.userName}`,
        meta: {
          telecallerId: assignment.role === "telecaller" ? assignment.userId : null,
          counsellorId: assignment.role === "counsellor" ? assignment.userId : null,
          bulk: true,
          strategy: validStrategy,
          telecallerName: assignment.role === "telecaller" ? assignment.userName : null,
          counsellorName: assignment.role === "counsellor" ? assignment.userName : null,
          performedByName: performerName,
        },
        updatedAt: getIndianNow(),
      });

      if (authReq.user?.id) {
        await logLeadAssignment(req, {
          lead: updated,
          previous: currentLead,
          performedBy: authReq.user.id,
          telecallerId: assignment.role === "telecaller" ? assignment.userId : null,
          counsellorId: assignment.role === "counsellor" ? assignment.userId : null,
          telecallerName: assignment.role === "telecaller" ? assignment.userName : null,
          counsellorName: assignment.role === "counsellor" ? assignment.userName : null,
          bulk: true,
        });
      }

      await onLeadAssignmentChange(currentLead, updated, {
        telecallerId: assignment.role === "telecaller" ? assignment.userId : null,
        counsellorId: assignment.role === "counsellor" ? assignment.userId : null,
        actorUserId: authReq.user?.id ?? null,
        performerName,
        deferDelivery: true,
      });
      assigneesToFlush.add(assignment.userId);

      updatedItems.push(updated);
    }

    for (const userId of assigneesToFlush) {
      try {
        await flushLeadAssignmentBatch(userId);
      } catch (e) {
        console.error("[notification] strategy assign flush:", e);
      }
    }

    await publishLeadChange("lead:bulk_assigned", {
      updatedCount: updatedItems.length,
      blocked: plan.blocked,
      missing: plan.missing,
      strategy: validStrategy,
    });

    res.json({
      success: true,
      data: {
        ...plan,
        updated: updatedItems,
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateLeadActivityMessageController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const leadId = Number(req.params.id);
    const activityId = Number(req.params.activityId);
    if (isNaN(leadId) || isNaN(activityId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const { message } = req.body ?? {};
    if (!String(message ?? "").trim()) {
      return res.status(400).json({ success: false, message: "Note message is required" });
    }

    const lead = await getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (isLeadLocked(lead, authReq.user?.role)) {
      return res.status(400).json({
        success: false,
        message: isLeadJunkLocked(lead)
          ? "Junk leads are read-only"
          : "Converted leads cannot be modified by telecallers",
      });
    }

    const activities = await getLeadActivities(leadId);
    const target = activities.find((a) => a.id === activityId);
    if (!target || target.activityType !== "note") {
      return res.status(400).json({ success: false, message: "Note activity not found" });
    }

    const updated = await updateLeadActivityMessage(activityId, String(message));

    const latestNoteActivity = activities
      .filter((a) => a.activityType === "note")
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      )[0];
    if (latestNoteActivity?.id === activityId) {
      await updateLeadById(leadId, { latestNote: String(message).trim() });
      const enriched = await getLeadById(leadId);
      if (enriched) {
        await publishLeadChange("lead:updated", enriched as Record<string, unknown>);
      }
    }

    await publishLeadChange("lead:activity_updated", {
      leadId,
      activity: updated,
    } as Record<string, unknown>);

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateLeadActivityStatusController = async (req: Request, res: Response) => {
  try {
    const leadId = Number(req.params.id);
    const activityId = Number(req.params.activityId);
    if (isNaN(leadId) || isNaN(activityId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const { status, message: completionNote } = req.body ?? {};
    if (!["pending", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    // Fetch activities before update so we know the type of the target activity
    const allActivities = await getLeadActivities(leadId);
    const targetActivity = allActivities.find((a: any) => a.id === activityId);

    if (!targetActivity) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    if (
      status === "completed" &&
      targetActivity.activityType === "followup" &&
      !String(completionNote ?? "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Note is required when marking a follow-up as completed",
      });
    }

    const completionMessage =
      status === "completed" && targetActivity.activityType === "followup"
        ? formatFollowUpCompletedMessage(String(completionNote))
        : undefined;

    const updated = await updateActivityStatus(activityId, status, completionMessage);

    // When a follow-up is completed, advance next follow-up or revert progress to contacted
    if (status === "completed" && targetActivity?.activityType === "followup") {
      const stillPending = allActivities.some(
        (a: any) =>
          a.activityType === "followup" && a.status === "pending" && a.id !== activityId
      );
      const nextPending = allActivities
        .filter((a: any) => a.activityType === "followup" && a.status === "pending" && a.id !== activityId)
        .sort((a: any, b: any) => new Date(a.followupAt ?? 0).getTime() - new Date(b.followupAt ?? 0).getTime())[0];

      const leadPatch: Record<string, unknown> = {
        nextFollowupAt: nextPending?.followupAt ? pgNaiveIst(new Date(nextPending.followupAt)) : null,
      };
      if (!stillPending) {
        const current = await getLeadById(leadId);
        if (
          current &&
          current.progressStatus === "follow_up" &&
          current.assignmentStatus !== "converted" &&
          !current.isJunk
        ) {
          leadPatch.progressStatus = "contacted";
        }
      }
      await updateLeadById(leadId, leadPatch);
      await invalidateLeadListCaches();
      const enrichedLead = await getLeadById(leadId);
      if (enrichedLead) {
        await publishLeadChange("lead:updated", enrichedLead as Record<string, unknown>);
      }
    }

    await publishLeadChange("lead:activity_updated", { leadId, activity: updated } as Record<string, unknown>);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const downloadLeadImportTemplateController = async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="lead-import-template.csv"');
  res.send(CSV_IMPORT_TEMPLATE);
};

export const importLeadsCsvController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ success: false, message: "CSV file is required" });
    }

    const result = await importLeadsFromCsvBuffer(file.buffer, {
      userId: authReq.user!.id,
      role: authReq.user!.role,
    });

    if (result.created > 0) {
      await invalidateLeadListCaches();
      await publishLeadChange("lead:bulk_imported", {
        created: result.created,
        failed: result.failed,
      } as Record<string, unknown>);
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getLeadReportController = async (req: Request, res: Response) => {
  try {
    const params = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      assigneeId: req.query.assigneeId ? Number(req.query.assigneeId) : undefined,
      status: req.query.status as string | undefined,
    };

    const cacheKey = `${LEAD_REPORT_CACHE_PREFIX}${JSON.stringify(params)}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    const report = await getLeadReportSummary(params);
    await redisSetJson(cacheKey, report, LEAD_CACHE_TTL_SECONDS);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
