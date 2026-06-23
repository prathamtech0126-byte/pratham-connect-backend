import { publishReportsRefresh } from "../reports/services/reportsRealtime.service";
import {
  publishVisaCaseAssigned,
  publishVisaCaseRefresh,
  publishVisaCaseUpdated,
} from "../visaCase/services/visaCaseRealtime.service";

export type ModulesRealtimeVisaCaseMeta = {
  id: string;
  clientId?: string | null;
  assignedUserId?: number | null;
  assignedTeam?: string | null;
  currentStage?: string | null;
  currentSubStatus?: string | null;
  /** When true, emit assignment-specific event to assignee rooms. */
  assignment?: {
    previousUserId?: number | null;
    previousTeam?: string | null;
    assignmentType?: string;
  };
};

export type ModulesRealtimeWriteMeta = {
  reason?: string;
  clientId?: string | null;
  visaCase?: ModulesRealtimeVisaCaseMeta;
  /** Skip reports refresh (rare — default publishes both). */
  skipReports?: boolean;
  /** Skip visa case refresh (rare — default publishes both). */
  skipVisaCase?: boolean;
};

/**
 * Publish Socket.io refresh/update events after a modules DB write.
 * Called from invalidateModulesCachesOnWrite() — never throws.
 */
export const publishModulesRealtimeOnWrite = (
  meta: ModulesRealtimeWriteMeta = {}
): void => {
  const reason = meta.reason?.trim() || "modules:write";
  const clientId = meta.clientId ?? meta.visaCase?.clientId ?? undefined;
  const visaCaseId = meta.visaCase?.id;

  if (!meta.skipReports) {
    publishReportsRefresh({ reason, clientId, visaCaseId });
  }

  if (!meta.skipVisaCase) {
    publishVisaCaseRefresh({ reason, clientId, visaCaseId });
  }

  if (meta.visaCase) {
    publishVisaCaseUpdated({
      reason,
      visaCaseId: meta.visaCase.id,
      clientId: meta.visaCase.clientId,
      assignedUserId: meta.visaCase.assignedUserId,
      assignedTeam: meta.visaCase.assignedTeam,
      currentStage: meta.visaCase.currentStage,
      currentSubStatus: meta.visaCase.currentSubStatus,
    });

    const assignment = meta.visaCase.assignment;
    if (
      assignment &&
      meta.visaCase.assignedUserId != null &&
      meta.visaCase.assignedTeam
    ) {
      publishVisaCaseAssigned({
        reason,
        visaCaseId: meta.visaCase.id,
        clientId: meta.visaCase.clientId,
        assignedUserId: meta.visaCase.assignedUserId,
        assignedTeam: meta.visaCase.assignedTeam,
        previousUserId: assignment.previousUserId,
        previousTeam: assignment.previousTeam,
        assignmentType: assignment.assignmentType,
      });
    }
  }
};
