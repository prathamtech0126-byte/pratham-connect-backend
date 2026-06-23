import type { Role } from "../../../types/role";
import { inArray } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";
import {
  DECISION_LABELS,
  formatProcessingLabel,
  isBindingApplicationRole,
  REASON_OF_TRAVEL_LABELS,
  SPONSOR_RELATIONSHIP_LABELS,
  VISA_CASE_VIEW_ALL_ROLES,
  VISA_CATEGORY_LABELS,
  toDisplayAssignedTeam,
} from "../constants/visaCase.constants";
import {
  getVisaCaseById,
  getVisaCaseBySaleId,
  insertVisaCase,
  insertVisaCaseStatusEvent,
  listVisaCaseStatusEvents,
  listVisaCases,
  updateVisaCase,
  type VisaCaseListFilters,
} from "../models/visaCase.model";
import {
  countOpenVisaCaseDocumentRequests,
  createVisaCaseDocumentRequest,
  fulfillVisaCaseDocumentRequest,
  resolveClientForDocumentRequest,
  getVisaCaseDocumentRequestById,
  listVisaCaseDocumentRequestHistory,
  listVisaCaseDocumentRequests,
  type DocumentRequestHistoryFilters,
} from "../models/visaCaseDocumentRequest.model";
import { visaCases } from "../schemas/visaCase.schema";
import {
  resolveDirectStatusChange,
  type VisaProcessingSubStatus,
} from "./visaCaseStateMachine";
import {
  syncClientJourneyOnProcessingStatusChange,
  syncClientJourneyOnVisaCaseCreated,
} from "../../journey/services/clientJourney.service";
import {
  emitVisaCaseCreatedEvent,
  emitVisaCaseTeamRoutedEvent,
} from "../../journey/services/journeyEvent.service";
import {
  buildVisaCaseFinancialKey,
  getFinancialSummariesForVisaCases,
  getFinancialSummaryForClient,
  type VisaCaseFinancialSummary,
} from "./visaCaseFinancial.service";
import {
  getStudentApplicationForVisaCase,
  getStudentApplicationsForVisaCases,
  type VisaCaseStudentApplicationSummary,
} from "./visaCaseStudentApplication.service";
import {
  getAccessibleLegacyClientIdsForCounsellor,
} from "../../clients/services/clientAccess.service";
import { notifyVisaCaseDocumentRequested } from "../../../notification/integrations/visaCaseNotifications";
import { assignVisaCaseInTransaction } from "../models/visaCaseAssignment.model";
import {
  assertOpsAssigneeAccess,
  assertOpsViewAccess,
  buildAssignmentMeta,
  getUserById,
  isOpsRole,
  isStrictAssignmentVisibility,
  resolveCxDocumentRequestHandler,
} from "./visaCaseAssignment.service";
import { teamForStage } from "./visaCaseStateMachine";

type ViewerContext = {
  userId: number;
  role: Role;
};

type CounsellorSummary = {
  counsellorId: number;
  counsellorName: string;
};

const getCounsellorSummariesByLegacyClientIds = async (
  legacyClientIds: Array<number | null | undefined>
): Promise<Map<number, CounsellorSummary>> => {
  const uniqueLegacyClientIds = [
    ...new Set(
      legacyClientIds.filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0
      )
    ),
  ];
  const result = new Map<number, CounsellorSummary>();
  if (uniqueLegacyClientIds.length === 0) return result;

  const clientRows = await db
    .select({
      legacyClientId: clientInformation.clientId,
      counsellorId: clientInformation.counsellorId,
    })
    .from(clientInformation)
    .where(inArray(clientInformation.clientId, uniqueLegacyClientIds));

  const counsellorIds = [
    ...new Set(
      clientRows
        .map((row) => row.counsellorId)
        .filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0)
    ),
  ];
  if (counsellorIds.length === 0) return result;

  const counsellorRows = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, counsellorIds));

  const counsellorNameMap = new Map(
    counsellorRows.map((row) => [row.id, row.fullName])
  );

  for (const row of clientRows) {
    const counsellorName = counsellorNameMap.get(row.counsellorId);
    if (!counsellorName) continue;
    result.set(row.legacyClientId, {
      counsellorId: row.counsellorId,
      counsellorName,
    });
  }

  return result;
};

export type CreateVisaCaseInput = {
  clientId: string;
  saleId: string;
  userId: number;
};

export const ensureVisaCaseForSale = async (
  input: CreateVisaCaseInput
) => {
  const existing = await getVisaCaseBySaleId(input.saleId);
  if (existing) {
    void syncClientJourneyOnVisaCaseCreated({
      clientId: input.clientId,
      visaCaseId: existing.id,
      changedBy: input.userId,
      processingStage: existing.currentStage,
      processingSubStatus: existing.currentSubStatus,
    });
    return existing;
  }

  const created = await insertVisaCase({
    clientId: input.clientId,
    saleId: input.saleId,
    userId: input.userId,
    assignedTeam: "cx",
    currentStage: "DOCUMENTATION",
    currentSubStatus: "CHECKLIST_SHARED",
    decision: "PENDING",
    accompanyingMembersCount: 0,
  });

  // Emit VISA_CASE_CREATED — fire-and-forget, never throws.
  const caseCreatedAt = created.createdAt ?? new Date();
  void emitVisaCaseCreatedEvent({
    clientId: input.clientId,
    visaCaseId: created.id,
    actorId: input.userId,
    createdAt: caseCreatedAt,
  });

  void emitVisaCaseTeamRoutedEvent({
    clientId: input.clientId,
    visaCaseId: created.id,
    team: "cx",
    actorId: input.userId,
    occurredAt: new Date(caseCreatedAt.getTime() + 1000),
  });

  void syncClientJourneyOnVisaCaseCreated({
    clientId: input.clientId,
    visaCaseId: created.id,
    changedBy: input.userId,
    processingStage: "DOCUMENTATION",
    processingSubStatus: "CHECKLIST_SHARED",
  });

  return created;
};

const buildCategoryFields = (slug: string | null | undefined) => {
  const category = slug ?? null;
  return {
    category,
    categoryLabel: category ? (VISA_CATEGORY_LABELS[category] ?? category) : null,
  };
};

const buildStudentApplicationField = (
  category: string | null,
  studentApplication: VisaCaseStudentApplicationSummary | null | undefined
) => {
  if (category !== "student") return null;
  return studentApplication ?? null;
};

type CountryFields = {
  id: string | null;
  name: string | null;
  isoCode: string | null;
} | null;

const normalizeCountry = (country: CountryFields) => {
  if (!country?.id || !country.name) return null;
  return {
    id: country.id,
    name: country.name,
    isoCode: country.isoCode ?? null,
  };
};

/** Travel destination when set; otherwise sale type country (e.g. Canada Student → Canada). */
const resolveDisplayCountry = (
  destinationCountry: CountryFields,
  saleTypeCountry: CountryFields
) =>
  normalizeCountry(destinationCountry) ?? normalizeCountry(saleTypeCountry);

const mapRowToListItem = (
  row: Awaited<ReturnType<typeof listVisaCases>>["rows"][number],
  rowNumber: number,
  financial: VisaCaseFinancialSummary,
  studentApplication?: VisaCaseStudentApplicationSummary | null,
  counsellor?: CounsellorSummary | null
) => {
  const { category, categoryLabel } = buildCategoryFields(row.visaCategorySlug);
  const isDecisionStage = row.visaCase.currentStage === "DECISION";

  return {
    rowNumber,
    visaCaseId: row.visaCase.id,
    clientId: row.client.id,
    legacyClientId: row.client.legacyClientId,
    clientName: row.person.fullName,
    enrollmentDate: row.client.enrollmentDate,
    passportNumber: row.passportNumber ?? null,
    saleTypeId: row.saleTypeId,
    saleType: row.saleTypeName,
    legacySaleTypeId: row.legacySaleTypeId ?? null,
    category,
    categoryLabel,
    financial,
    country: resolveDisplayCountry(
      row.destinationCountry,
      row.saleTypeCountry
    ),
    travel: {
      reason: row.visaCase.reasonOfTravel,
      reasonLabel: row.visaCase.reasonOfTravel
        ? REASON_OF_TRAVEL_LABELS[row.visaCase.reasonOfTravel]
        : null,
      destinationCountry: normalizeCountry(row.destinationCountry),
      saleTypeCountry: normalizeCountry(row.saleTypeCountry),
    },
    sponsorship: {
      relationship: row.visaCase.sponsorRelationship,
      relationshipLabel: row.visaCase.sponsorRelationship
        ? SPONSOR_RELATIONSHIP_LABELS[row.visaCase.sponsorRelationship]
        : null,
      accompanyingMembersCount: row.visaCase.accompanyingMembersCount,
    },
    studentApplication: buildStudentApplicationField(category, studentApplication),
    processing: {
      stage: row.visaCase.currentStage,
      subStatus: row.visaCase.currentSubStatus,
      label: formatProcessingLabel(
        row.visaCase.currentStage,
        row.visaCase.currentSubStatus
      ),
      assignedTeam: toDisplayAssignedTeam(row.visaCase.assignedTeam),
      assignedUserId: row.visaCase.assignedUserId,
      decision: isDecisionStage
        ? {
            submissionDate: row.visaCase.submissionDate,
            decisionDate: row.visaCase.decisionDate,
            outcome: row.visaCase.decision,
            outcomeLabel:
              DECISION_LABELS[row.visaCase.decision] ?? row.visaCase.decision,
            remarks: row.visaCase.remarks,
          }
        : null,
    },
    counsellorId: counsellor?.counsellorId ?? null,
    counsellorName: counsellor?.counsellorName ?? null,
    createdAt: row.visaCase.createdAt,
    updatedAt: row.visaCase.updatedAt,
  };
};

const resolveListFilters = async (
  viewer: ViewerContext,
  query: Partial<VisaCaseListFilters>
): Promise<VisaCaseListFilters> => {
  const canViewAll = (VISA_CASE_VIEW_ALL_ROLES as readonly string[]).includes(
    viewer.role
  );

  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  let userId = query.userId;
  let legacyClientIds = query.legacyClientIds;

  if (!canViewAll && viewer.role === "counsellor") {
    legacyClientIds = await getAccessibleLegacyClientIdsForCounsellor(
      viewer.userId
    );
    userId = undefined;
  }

  let assignedTeam = query.assignedTeam;
  if (assignedTeam === "application") {
    assignedTeam = "binding";
  }
  let assignedUserId = query.assignedUserId;
  let involvedUserId = query.involvedUserId;
  let unassigned = query.unassigned;

  if (isStrictAssignmentVisibility() && isOpsRole(viewer.role)) {
    involvedUserId = viewer.userId;
    assignedUserId = undefined;
    assignedTeam = undefined;
    unassigned = false;
  } else if (!canViewAll && viewer.role === "cx") {
    assignedTeam = "cx";
  } else if (!canViewAll && isBindingApplicationRole(viewer.role)) {
    assignedUserId = viewer.userId;
  }

  if (canViewAll && query.unassigned === true) {
    unassigned = true;
    assignedUserId = undefined;
    involvedUserId = undefined;
  }

  if (canViewAll && query.assignedUserId != null) {
    assignedUserId = query.assignedUserId;
    involvedUserId = undefined;
  }

  return {
    ...query,
    userId,
    legacyClientIds,
    assignedTeam,
    assignedUserId,
    involvedUserId,
    unassigned,
    limit,
    offset,
  };
};

export const getVisaCaseList = async (
  viewer: ViewerContext,
  query: Partial<VisaCaseListFilters>
) => {
  const filters = await resolveListFilters(viewer, query);
  const { rows, total } = await listVisaCases(filters);

  const studentPairs = rows
    .filter(
      (row) =>
        row.visaCategorySlug === "student" &&
        row.client.legacyClientId != null &&
        row.legacySaleTypeId != null
    )
    .map((row) => ({
      legacyClientId: row.client.legacyClientId as number,
      legacySaleTypeId: row.legacySaleTypeId as number,
    }));

  const [studentApplicationMap, financialMap, counsellorMap] = await Promise.all([
    getStudentApplicationsForVisaCases(studentPairs),
    getFinancialSummariesForVisaCases(
      rows.map((row) => ({
        clientId: row.client.id,
        legacyClientId: row.client.legacyClientId,
        legacySaleTypeId: row.legacySaleTypeId,
      }))
    ),
    getCounsellorSummariesByLegacyClientIds(
      rows.map((row) => row.client.legacyClientId)
    ),
  ]);

  const data = rows.map((row, index) => {
    const studentApplication =
      row.visaCategorySlug === "student" &&
      row.client.legacyClientId != null &&
      row.legacySaleTypeId != null
        ? studentApplicationMap.get(
            `${row.client.legacyClientId}:${row.legacySaleTypeId}`
          ) ?? null
        : null;

    const financial =
      financialMap.get(
        buildVisaCaseFinancialKey(
          row.client.id,
          row.client.legacyClientId,
          row.legacySaleTypeId
        )
      ) ??
      ({
        totalCharges: "0.00",
        initialCharges: "0.00",
        financeCharges: "0.00",
        balanceDue: "0.00",
      } satisfies VisaCaseFinancialSummary);

    const counsellor =
      row.client.legacyClientId != null
        ? counsellorMap.get(row.client.legacyClientId) ?? null
        : null;

    return mapRowToListItem(
      row,
      filters.offset + index + 1,
      financial,
      studentApplication,
      counsellor
    );
  });

  return {
    data,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
    },
  };
};

export const getVisaCaseDetail = async (
  visaCaseId: string,
  viewer?: ViewerContext
) => {
  const row = await getVisaCaseById(visaCaseId);
  if (!row) return null;

  if (viewer) {
    await assertOpsViewAccess(
      viewer,
      visaCaseId,
      row.visaCase.assignedUserId
    );
  }

  const financial = await getFinancialSummaryForClient({
    clientId: row.client.id,
    legacyClientId: row.client.legacyClientId,
    legacySaleTypeId: row.saleType.legacySaleTypeId,
  });
  const [events, documentRequests] = await Promise.all([
    listVisaCaseStatusEvents(visaCaseId),
    listVisaCaseDocumentRequests(visaCaseId),
  ]);
  const { category, categoryLabel } = buildCategoryFields(row.visaCategorySlug);

  const studentApplication =
    category === "student" &&
    row.client.legacyClientId != null &&
    row.saleType.legacySaleTypeId != null
      ? await getStudentApplicationForVisaCase(
          row.client.legacyClientId,
          row.saleType.legacySaleTypeId
        )
      : null;

  const [assignedUser, counsellorMap] = await Promise.all([
    row.visaCase.assignedUserId
      ? getUserById(row.visaCase.assignedUserId)
      : Promise.resolve(null),
    getCounsellorSummariesByLegacyClientIds([row.client.legacyClientId]),
  ]);
  const counsellor =
    row.client.legacyClientId != null
      ? counsellorMap.get(row.client.legacyClientId) ?? null
      : null;
  const isDecisionStage = row.visaCase.currentStage === "DECISION";

  const assignmentMeta = viewer
    ? buildAssignmentMeta(viewer, {
        assignedUserId: row.visaCase.assignedUserId,
        assignedTeam: row.visaCase.assignedTeam,
      })
    : null;

  return {
    visaCaseId: row.visaCase.id,
    client: {
      id: row.client.id,
      legacyClientId: row.client.legacyClientId,
      clientCode: row.client.clientCode,
      enrollmentDate: row.client.enrollmentDate,
      fullName: row.person.fullName,
      passportNumber: row.passportNumber ?? null,
      counsellorId: counsellor?.counsellorId ?? null,
      counsellorName: counsellor?.counsellorName ?? null,
    },
    sale: {
      id: row.sale.id,
      saleId: row.sale.saleId,
      saleTypeId: row.saleType.saleTypeId,
      saleType: row.saleType.saleType,
      legacySaleTypeId: row.saleType.legacySaleTypeId ?? null,
    },
    category,
    categoryLabel,
    financial,
    country: resolveDisplayCountry(
      row.destinationCountry,
      row.saleTypeCountry
    ),
    travel: {
      reason: row.visaCase.reasonOfTravel,
      reasonLabel: row.visaCase.reasonOfTravel
        ? REASON_OF_TRAVEL_LABELS[row.visaCase.reasonOfTravel]
        : null,
      destinationCountry: normalizeCountry(row.destinationCountry),
      saleTypeCountry: normalizeCountry(row.saleTypeCountry),
    },
    sponsorship: {
      relationship: row.visaCase.sponsorRelationship,
      relationshipLabel: row.visaCase.sponsorRelationship
        ? SPONSOR_RELATIONSHIP_LABELS[row.visaCase.sponsorRelationship]
        : null,
      accompanyingMembersCount: row.visaCase.accompanyingMembersCount,
    },
    studentApplication: buildStudentApplicationField(
      category,
      studentApplication
    ),
    processing: {
      stage: row.visaCase.currentStage,
      subStatus: row.visaCase.currentSubStatus,
      label: formatProcessingLabel(
        row.visaCase.currentStage,
        row.visaCase.currentSubStatus
      ),
      assignedTeam: toDisplayAssignedTeam(row.visaCase.assignedTeam),
      assignedUserId: row.visaCase.assignedUserId,
      assignedUser: assignedUser
        ? {
            id: assignedUser.id,
            fullName: assignedUser.fullName,
            role: assignedUser.role,
            empId: assignedUser.empId,
          }
        : null,
      decision: isDecisionStage
        ? {
            submissionDate: row.visaCase.submissionDate,
            decisionDate: row.visaCase.decisionDate,
            outcome: row.visaCase.decision,
            outcomeLabel: DECISION_LABELS[row.visaCase.decision],
            remarks: row.visaCase.remarks,
          }
        : null,
    },
    assignment: assignmentMeta,
    documentRequests,
    counsellorId: counsellor?.counsellorId ?? null,
    counsellorName: counsellor?.counsellorName ?? null,
    statusHistory: events,
    createdAt: row.visaCase.createdAt,
    updatedAt: row.visaCase.updatedAt,
  };
};

export type UpdateTravelInput = {
  reasonOfTravel?: (typeof visaCases.$inferInsert)["reasonOfTravel"];
  destinationCountryId?: string | null;
};

export const updateVisaCaseTravel = async (
  visaCaseId: string,
  input: UpdateTravelInput,
  viewer?: ViewerContext
) => {
  if (viewer && isOpsRole(viewer.role)) {
    const existing = await getVisaCaseById(visaCaseId);
    if (!existing) throw new Error("Visa case not found");
    assertOpsAssigneeAccess(viewer, existing.visaCase.assignedUserId);
  }

  return updateVisaCase(visaCaseId, {
    reasonOfTravel: input.reasonOfTravel,
    destinationCountryId: input.destinationCountryId ?? undefined,
  });
};

export type UpdateSponsorshipInput = {
  sponsorRelationship?: (typeof visaCases.$inferInsert)["sponsorRelationship"];
  accompanyingMembersCount?: number;
};

export const updateVisaCaseSponsorship = async (
  visaCaseId: string,
  input: UpdateSponsorshipInput,
  viewer?: ViewerContext
) => {
  if (viewer && isOpsRole(viewer.role)) {
    const existing = await getVisaCaseById(visaCaseId);
    if (!existing) throw new Error("Visa case not found");
    assertOpsAssigneeAccess(viewer, existing.visaCase.assignedUserId);
  }

  const count = input.accompanyingMembersCount;
  if (count != null && (!Number.isFinite(count) || count < 0)) {
    throw new Error("accompanyingMembersCount must be a non-negative number");
  }

  return updateVisaCase(visaCaseId, {
    sponsorRelationship: input.sponsorRelationship,
    accompanyingMembersCount: count,
  });
};

export type UpdateStatusInput = {
  subStatus: VisaProcessingSubStatus;
  notes?: string;
};

export type CreateVisaCaseDocumentRequestInput = {
  /** Modules DB client UUID */
  clientId?: string | number;
  /** Main CRM client_information.id */
  legacyClientId?: string | number;
  documentType: string;
  notes?: string;
};

const isPaymentFullyReceived = async (visaCaseId: string): Promise<boolean> => {
  const existing = await getVisaCaseById(visaCaseId);
  if (!existing) throw new Error("Visa case not found");

  const financial = await getFinancialSummaryForClient({
    clientId: existing.client.id,
    legacyClientId: existing.client.legacyClientId,
    legacySaleTypeId: existing.saleType.legacySaleTypeId,
  });
  return Number.parseFloat(financial.balanceDue) <= 0;
};

export const requestVisaCaseDocument = async (
  visaCaseId: string,
  viewer: ViewerContext,
  input: CreateVisaCaseDocumentRequestInput
) => {
  const existing = await getVisaCaseById(visaCaseId);
  if (!existing) throw new Error("Visa case not found");

  if (isOpsRole(viewer.role)) {
    assertOpsAssigneeAccess(viewer, existing.visaCase.assignedUserId);
  }

  const documentType = input.documentType?.trim();
  const hasClientId =
    input.clientId != null && String(input.clientId).trim() !== "";
  const hasLegacyClientId =
    input.legacyClientId != null && String(input.legacyClientId).trim() !== "";

  if (!hasClientId && !hasLegacyClientId) {
    throw new Error("clientId or legacyClientId is required");
  }
  if (!documentType) throw new Error("documentType is required");

  const resolvedClient = await resolveClientForDocumentRequest({
    clientId: input.clientId,
    legacyClientId: input.legacyClientId,
  });
  if (!resolvedClient) {
    throw new Error(
      "Client not found. Provide modules clientId (UUID) or legacyClientId from main CRM."
    );
  }

  const cxHandlerUserId = await resolveCxDocumentRequestHandler(
    visaCaseId,
    existing.visaCase.assignedUserId
  );
  if (cxHandlerUserId == null) {
    throw new Error(
      "No CX team member is assigned to handle this client. Assign the case to CX first."
    );
  }

  const request = await createVisaCaseDocumentRequest({
    visaCaseId,
    clientId: resolvedClient.id,
    personLabel: resolvedClient.fullName,
    documentType,
    notes: input.notes?.trim() || null,
    raisedBy: viewer.userId,
    raisedByRole: viewer.role,
    targetTeam: "cx",
    sourceStage: existing.visaCase.currentStage,
    sourceSubStatus: existing.visaCase.currentSubStatus,
    sourceTeam: existing.visaCase.assignedTeam,
  });

  const assignmentResult = await assignVisaCaseInTransaction({
    visaCaseId,
    assignedUserId: cxHandlerUserId,
    assignedTeam: "cx",
    previousUserId: existing.visaCase.assignedUserId,
    previousTeam: existing.visaCase.assignedTeam,
    assignedBy: viewer.userId,
    assignedByRole: viewer.role,
    assignmentType: "document_request_to_cx",
    notes: `Document request routed to CX for ${documentType}`,
  });
  if (!assignmentResult) {
    throw new Error("Failed to route document request to CX assignee");
  }

  const updated = await updateVisaCase(visaCaseId, {
    currentStage: "DOCUMENTATION",
    currentSubStatus: "ADDITIONAL_DOCUMENTS_REQUESTED",
    assignedTeam: "cx",
    assignedUserId: cxHandlerUserId,
  });

  await insertVisaCaseStatusEvent({
    visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: "DOCUMENTATION",
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: "ADDITIONAL_DOCUMENTS_REQUESTED",
    changedBy: viewer.userId,
    changedByRole: viewer.role,
    notes: `Document requested for ${resolvedClient.fullName}: ${documentType}`,
  });

  const journeyNotes = [
    `Document requested: ${documentType}`,
    `for ${resolvedClient.fullName}`,
    input.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join(" — ");

  void syncClientJourneyOnProcessingStatusChange({
    clientId: existing.client.id,
    visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: "DOCUMENTATION",
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: "ADDITIONAL_DOCUMENTS_REQUESTED",
    changedBy: viewer.userId,
    notes: journeyNotes,
  });

  void notifyVisaCaseDocumentRequested({
    requestId: request.id,
    visaCaseId,
    cxHandlerUserId,
    legacyClientId: existing.client.legacyClientId,
    clientName: existing.person.fullName,
    clientCode: existing.client.clientCode,
    personLabel: resolvedClient.fullName,
    documentType,
    sourceTeam: existing.visaCase.assignedTeam,
    actorUserId: viewer.userId,
    actorRole: viewer.role,
  }).catch((err) => {
    console.error("[visaCase] document request notification failed:", err);
  });

  return { request, visaCase: updated };
};

export const fulfillVisaCaseDocument = async (
  requestId: string,
  viewer: ViewerContext,
  fulfilmentNotes?: string
) => {
  const request = await getVisaCaseDocumentRequestById(requestId);
  if (!request) throw new Error("Document request not found");

  const existing = await getVisaCaseById(request.visaCaseId);
  if (!existing) throw new Error("Visa case not found");

  if (isOpsRole(viewer.role)) {
    assertOpsAssigneeAccess(viewer, existing.visaCase.assignedUserId);
  }

  const fulfilled = await fulfillVisaCaseDocumentRequest({
    id: requestId,
    fulfilledBy: viewer.userId,
    fulfilmentNotes: fulfilmentNotes?.trim() || null,
  });
  if (!fulfilled) throw new Error("Document request is already closed");

  const openCount = await countOpenVisaCaseDocumentRequests(request.visaCaseId);
  if (openCount > 0) {
    return { request: fulfilled, visaCase: existing.visaCase };
  }

  const fullyReceived = await isPaymentFullyReceived(request.visaCaseId);
  const nextStage = fullyReceived ? request.sourceStage : "DOCUMENTATION";
  const nextSubStatus = fullyReceived ? request.sourceSubStatus : "PARTIALLY_RECEIVED";
  const nextTeam = fullyReceived ? request.sourceTeam : "cx";

  let updated = existing.visaCase;

  if (fullyReceived && request.sourceTeam !== "cx") {
    const returned = await assignVisaCaseInTransaction({
      visaCaseId: request.visaCaseId,
      assignedUserId: request.raisedBy,
      assignedTeam: request.sourceTeam,
      previousUserId: existing.visaCase.assignedUserId,
      previousTeam: existing.visaCase.assignedTeam,
      assignedBy: viewer.userId,
      assignedByRole: viewer.role,
      assignmentType: "document_request_resolved",
      notes:
        fulfilmentNotes?.trim() ||
        "Document received; case returned to requesting team member",
    });
    if (!returned) {
      throw new Error("Failed to return visa case to requesting team member");
    }
    updated =
      (await updateVisaCase(request.visaCaseId, {
        currentStage: nextStage,
        currentSubStatus: nextSubStatus,
        assignedTeam: nextTeam,
        assignedUserId: request.raisedBy,
      })) ?? returned.visaCase;
  } else {
    const patched = await updateVisaCase(request.visaCaseId, {
      currentStage: nextStage,
      currentSubStatus: nextSubStatus,
      assignedTeam: nextTeam,
    });
    if (patched) updated = patched;
  }

  await insertVisaCaseStatusEvent({
    visaCaseId: request.visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: nextStage,
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: nextSubStatus,
    changedBy: viewer.userId,
    changedByRole: viewer.role,
    notes: fullyReceived
      ? "Document received and payments fully received; resumed previous stage"
      : "Document received; waiting for full payment",
  });

  void syncClientJourneyOnProcessingStatusChange({
    clientId: existing.client.id,
    visaCaseId: request.visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: nextStage,
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: nextSubStatus,
    changedBy: viewer.userId,
    notes: fulfilmentNotes ?? null,
  });

  return { request: fulfilled, visaCase: updated };
};

export const getVisaCaseDocumentRequests = async (
  visaCaseId: string,
  viewer: ViewerContext
) => {
  const existing = await getVisaCaseById(visaCaseId);
  if (!existing) throw new Error("Visa case not found");
  if (isOpsRole(viewer.role)) {
    await assertOpsViewAccess(
      viewer,
      visaCaseId,
      existing.visaCase.assignedUserId
    );
  }
  return listVisaCaseDocumentRequests(visaCaseId);
};

export type DocumentRequestHistoryQuery = Partial<
  Omit<DocumentRequestHistoryFilters, "limit" | "offset">
>;

const resolveDocumentRequestHistoryFilters = async (
  viewer: ViewerContext,
  query: DocumentRequestHistoryQuery & { limit?: number; offset?: number }
): Promise<DocumentRequestHistoryFilters> => {
  const canViewAll = (VISA_CASE_VIEW_ALL_ROLES as readonly string[]).includes(
    viewer.role
  );

  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  let involvedUserId = query.involvedUserId;
  let legacyClientIds = query.legacyClientIds;
  let raisedBy = query.raisedBy;
  let targetTeam = query.targetTeam;
  let sourceTeam = query.sourceTeam;

  if (!canViewAll && viewer.role === "counsellor") {
    legacyClientIds = await getAccessibleLegacyClientIdsForCounsellor(
      viewer.userId
    );
  }

  if (isStrictAssignmentVisibility() && isOpsRole(viewer.role)) {
    involvedUserId = viewer.userId;
  } else if (!canViewAll) {
    if (viewer.role === "cx") {
      targetTeam = targetTeam ?? "cx";
    } else if (viewer.role === "binding" || viewer.role === "application") {
      raisedBy = raisedBy ?? viewer.userId;
    }
  }

  if (canViewAll && query.raisedBy != null) {
    raisedBy = query.raisedBy;
  }

  return {
    status: query.status,
    sourceTeam,
    targetTeam,
    raisedByRole: query.raisedByRole,
    raisedBy,
    visaCaseId: query.visaCaseId,
    fromDate: query.fromDate,
    toDate: query.toDate,
    involvedUserId,
    legacyClientIds,
    limit,
    offset,
  };
};

const mapDocumentRequestHistoryRow = (
  row: Awaited<
    ReturnType<typeof listVisaCaseDocumentRequestHistory>
  >["rows"][number],
  userMap: Map<
    number,
    { id: number; fullName: string; role: string; empId: string | null }
  >
) => {
  const raisedByUser = userMap.get(row.request.raisedBy);
  const fulfilledByUser =
    row.request.fulfilledBy != null
      ? userMap.get(row.request.fulfilledBy)
      : null;
  const cancelledByUser =
    row.request.cancelledBy != null
      ? userMap.get(row.request.cancelledBy)
      : null;

  return {
    id: row.request.id,
    visaCaseId: row.request.visaCaseId,
    clientId: row.request.clientId,
    personLabel: row.request.personLabel,
    documentType: row.request.documentType,
    notes: row.request.notes,
    requestStatus: row.request.requestStatus,
    raisedBy: row.request.raisedBy,
    raisedByRole: row.request.raisedByRole,
    raisedByUser: raisedByUser
      ? {
          id: raisedByUser.id,
          fullName: raisedByUser.fullName,
          role: raisedByUser.role,
          empId: raisedByUser.empId,
        }
      : null,
    targetTeam: row.request.targetTeam,
    sourceStage: row.request.sourceStage,
    sourceSubStatus: row.request.sourceSubStatus,
    sourceTeam: row.request.sourceTeam,
    fulfilledBy: row.request.fulfilledBy,
    fulfilledByUser: fulfilledByUser
      ? {
          id: fulfilledByUser.id,
          fullName: fulfilledByUser.fullName,
          role: fulfilledByUser.role,
          empId: fulfilledByUser.empId,
        }
      : null,
    fulfilledAt: row.request.fulfilledAt,
    fulfilmentNotes: row.request.fulfilmentNotes,
    cancelledBy: row.request.cancelledBy,
    cancelledByUser: cancelledByUser
      ? {
          id: cancelledByUser.id,
          fullName: cancelledByUser.fullName,
          role: cancelledByUser.role,
          empId: cancelledByUser.empId,
        }
      : null,
    cancelledAt: row.request.cancelledAt,
    createdAt: row.request.createdAt,
    updatedAt: row.request.updatedAt,
    visaCase: row.visaCase,
    client: {
      ...row.client,
      fullName: row.person.fullName,
    },
  };
};

export const getVisaCaseDocumentRequestHistory = async (
  viewer: ViewerContext,
  query: DocumentRequestHistoryQuery & { limit?: number; offset?: number }
) => {
  const filters = await resolveDocumentRequestHistoryFilters(viewer, query);
  const { rows, total } = await listVisaCaseDocumentRequestHistory(filters);

  const userIds = new Set<number>();
  for (const row of rows) {
    userIds.add(row.request.raisedBy);
    if (row.request.fulfilledBy != null) userIds.add(row.request.fulfilledBy);
    if (row.request.cancelledBy != null) userIds.add(row.request.cancelledBy);
  }

  const userMap = new Map<
    number,
    { id: number; fullName: string; role: string; empId: string | null }
  >();

  if (userIds.size > 0) {
    const userRows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        role: users.role,
        empId: users.emp_id,
      })
      .from(users)
      .where(inArray(users.id, [...userIds]));

    for (const user of userRows) {
      userMap.set(user.id, user);
    }
  }

  return {
    items: rows.map((row) => mapDocumentRequestHistoryRow(row, userMap)),
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
};

export const updateVisaCaseStatus = async (
  visaCaseId: string,
  viewer: ViewerContext,
  input: UpdateStatusInput
) => {
  const existing = await getVisaCaseById(visaCaseId);
  if (!existing) {
    throw new Error("Visa case not found");
  }

  const transition = resolveDirectStatusChange(input.subStatus);

  if (!transition.ok) {
    throw new Error(transition.message);
  }

  const submissionDate =
    input.subStatus === "FILE_SUBMITTED"
      ? new Date().toISOString().slice(0, 10)
      : existing.visaCase.submissionDate;

  const decisionBySubStatus: Partial<
    Record<VisaProcessingSubStatus, UpdateDecisionInput["decision"]>
  > = {
    DECISION_PENDING: "PENDING",
    DECISION_APPROVED: "APPROVED",
    DECISION_REFUSED: "REFUSED",
    DECISION_WITHDRAWN: "WITHDRAWN",
  };

  const decisionOutcome = decisionBySubStatus[input.subStatus];

  const updated = await updateVisaCase(visaCaseId, {
    currentStage: transition.nextStage,
    currentSubStatus: transition.nextSubStatus,
    assignedTeam: transition.assignedTeam,
    submissionDate: submissionDate ?? undefined,
    ...(decisionOutcome ? { decision: decisionOutcome } : {}),
  });

  await insertVisaCaseStatusEvent({
    visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: transition.nextStage,
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: transition.nextSubStatus,
    changedBy: viewer.userId,
    changedByRole: viewer.role,
    notes: input.notes ?? null,
  });

  void syncClientJourneyOnProcessingStatusChange({
    clientId: existing.client.id,
    visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: transition.nextStage,
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: transition.nextSubStatus,
    changedBy: viewer.userId,
    notes: input.notes ?? null,
  });

  return updated;
};

export type UpdateDecisionInput = {
  decision: "PENDING" | "APPROVED" | "REFUSED" | "WITHDRAWN";
  decisionDate?: string | null;
  remarks?: string | null;
};

export const updateVisaCaseDecision = async (
  visaCaseId: string,
  input: UpdateDecisionInput,
  viewer?: ViewerContext
) => {
  const existing = await getVisaCaseById(visaCaseId);
  if (!existing) {
    throw new Error("Visa case not found");
  }

  if (viewer && isOpsRole(viewer.role)) {
    assertOpsAssigneeAccess(viewer, existing.visaCase.assignedUserId);
  }

  if (
    input.decision !== "WITHDRAWN" &&
    input.decision !== "PENDING" &&
    existing.visaCase.currentSubStatus !== "FILE_SUBMITTED" &&
    !existing.visaCase.submissionDate
  ) {
    throw new Error(
      "Decision requires file submission unless marking as withdrawn"
    );
  }

  if (
    ["APPROVED", "REFUSED", "WITHDRAWN"].includes(input.decision) &&
    !input.decisionDate
  ) {
    throw new Error("decisionDate is required for final decisions");
  }

  const decisionSubStatusByOutcome: Record<
    UpdateDecisionInput["decision"],
    VisaProcessingSubStatus
  > = {
    PENDING: "DECISION_PENDING",
    APPROVED: "DECISION_APPROVED",
    REFUSED: "DECISION_REFUSED",
    WITHDRAWN: "DECISION_WITHDRAWN",
  };

  const decisionSubStatus = decisionSubStatusByOutcome[input.decision];
  const nextStage = "DECISION";
  const changedBy = viewer?.userId ?? existing.visaCase.userId;
  const changedByRole = viewer?.role ?? "developer";

  const updated = await updateVisaCase(visaCaseId, {
    currentStage: nextStage,
    currentSubStatus: decisionSubStatus,
    assignedTeam: teamForStage(nextStage),
    decision: input.decision,
    decisionDate: input.decisionDate ?? undefined,
    remarks: input.remarks ?? undefined,
  });

  await insertVisaCaseStatusEvent({
    visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: nextStage,
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: decisionSubStatus,
    changedBy,
    changedByRole,
    notes: `Decision updated to ${input.decision}`,
  });

  void syncClientJourneyOnProcessingStatusChange({
    clientId: existing.client.id,
    visaCaseId,
    fromStage: existing.visaCase.currentStage,
    toStage: nextStage,
    fromSubStatus: existing.visaCase.currentSubStatus,
    toSubStatus: decisionSubStatus,
    changedBy,
    notes: `Decision updated to ${input.decision}`,
  });

  return updated;
};
