import { getOrSetCache } from "../../cache/getOrSetCache";
import { MODULE_CACHE_KEYS, MODULE_CACHE_TTL } from "../../cache/keys";
import {
  getClientJourneySummary,
  getClientJourneyTimeline,
  type JourneySummary,
  type TimelineEvent,
} from "../services/journeyTimeline.service";

export const getCachedClientJourneyTimeline = (clientUuid: string) =>
  getOrSetCache<TimelineEvent[]>(
    `${MODULE_CACHE_KEYS.JOURNEY_TIMELINE}${clientUuid}`,
    MODULE_CACHE_TTL.JOURNEY,
    () => getClientJourneyTimeline(clientUuid)
  );

export const getCachedClientJourneySummary = (clientUuid: string) =>
  getOrSetCache<JourneySummary>(
    `${MODULE_CACHE_KEYS.JOURNEY_SUMMARY}${clientUuid}`,
    MODULE_CACHE_TTL.JOURNEY,
    () => getClientJourneySummary(clientUuid)
  );
