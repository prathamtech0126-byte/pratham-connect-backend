import {
  publishFrontDeskRefresh,
  publishFrontDeskUpdated,
} from "../../Leads/frontdesk/services/frontdeskRealtime.service";

export type ModulesRealtimeFrontDeskMeta = {
  leadId: number;
  /** When set, emit detail update with optional snapshot. */
  snapshot?: Record<string, unknown>;
};

export type FrontDeskRealtimeWriteMeta = {
  reason?: string;
  leadId?: number | null;
  frontDesk?: ModulesRealtimeFrontDeskMeta;
  /** Skip list refresh (rare — default publishes refresh). */
  skipRefresh?: boolean;
  /** Skip detail update (default skips unless frontDesk meta is set). */
  skipUpdated?: boolean;
};

/**
 * Publish Socket.io refresh/update events after a front desk CRM write.
 * Never throws.
 */
export const publishFrontDeskRealtimeOnWrite = (
  meta: FrontDeskRealtimeWriteMeta = {}
): void => {
  const reason = meta.reason?.trim() || "frontdesk:write";
  const leadId = meta.frontDesk?.leadId ?? meta.leadId ?? undefined;

  if (!meta.skipRefresh) {
    publishFrontDeskRefresh({ reason, leadId });
  }

  if (!meta.skipUpdated && meta.frontDesk) {
    publishFrontDeskUpdated({
      reason,
      leadId: meta.frontDesk.leadId,
      snapshot: meta.frontDesk.snapshot,
    });
  }
};
