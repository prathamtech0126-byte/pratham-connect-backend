import { emitToAll } from "../config/socket";

export interface MaintenanceState {
  isActive: boolean;
  startTime: string | null;
  endTime: string | null;
}

let _state: MaintenanceState = { isActive: false, startTime: null, endTime: null };
let _lastEffectiveActive = false;
let _schedulerStarted = false;

/** Parse "HH:mm" into minutes since midnight. */
const toMinutes = (time: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

export const isWithinMaintenanceWindow = (
  startTime: string,
  endTime: string,
  now: Date = new Date()
): boolean => {
  const startMins = toMinutes(startTime);
  const endMins = toMinutes(endTime);
  if (startMins === null || endMins === null) return false;

  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (startMins <= endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  // Overnight window (e.g. 22:00 – 06:00)
  return nowMins >= startMins || nowMins < endMins;
};

export const getEffectiveIsActive = (state: MaintenanceState = _state): boolean => {
  if (!state.isActive) return false;
  if (state.startTime && state.endTime) {
    return isWithinMaintenanceWindow(state.startTime, state.endTime);
  }
  return true;
};

export const isScheduledMaintenance = (state: MaintenanceState = _state): boolean =>
  state.isActive && !!state.startTime && !!state.endTime;

export const getMaintenanceState = () => _state;

export const getMaintenancePublicState = () => {
  const state = _state;
  return {
    isActive: getEffectiveIsActive(state),
    armed: state.isActive,
    startTime: state.startTime,
    endTime: state.endTime,
    isScheduled: isScheduledMaintenance(state),
  };
};

export const setMaintenanceState = (update: Partial<MaintenanceState>) => {
  _state = { ..._state, ...update };
  _lastEffectiveActive = getEffectiveIsActive();
};

// Keep backward-compat exports
export const getMaintenanceMode = () => getEffectiveIsActive();
export const setMaintenanceMode = (active: boolean) => {
  setMaintenanceState({ isActive: active });
};

const tickScheduledMaintenance = async () => {
  if (!isScheduledMaintenance()) return;

  const effective = getEffectiveIsActive();
  if (effective === _lastEffectiveActive) return;

  const wasActive = _lastEffectiveActive;
  _lastEffectiveActive = effective;
  emitToAll("maintenance:changed", getMaintenancePublicState());

};

/** Re-check every 30s so maintenance turns on/off at scheduled times without a manual toggle. */
export const startMaintenanceScheduler = () => {
  if (_schedulerStarted) return;
  _schedulerStarted = true;
  _lastEffectiveActive = getEffectiveIsActive();
  setInterval(tickScheduledMaintenance, 30_000);
};
