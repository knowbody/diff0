import { defineState } from "eve/context";

export interface StationRetries {
  turnId: string;
  seen: string[];
  failures: Record<string, number>;
}

export const stationRetries = defineState<StationRetries>("diff0.station-retries", () => ({
  turnId: "",
  seen: [],
  failures: {},
}));

/** Count completed failed calls, not replayed events or review revision requests. */
export function recordStationResult(
  current: StationRetries,
  turnId: string,
  callId: string,
  station: string,
  failed: boolean,
): StationRetries {
  const state = current.turnId === turnId ? current : { turnId, seen: [], failures: {} };
  if (state.seen.includes(callId)) return state;
  return {
    turnId,
    seen: [...state.seen, callId],
    failures: { ...state.failures, [station]: failed ? (state.failures[station] ?? 0) + 1 : 0 },
  };
}

export function enforceStationRetries(state: StationRetries): void {
  for (const [station, failures] of Object.entries(state.failures)) {
    if (failures >= 2) {
      throw new Error(
        `Station ${station} failed twice. Its one retry is exhausted; stopping this turn.`,
      );
    }
  }
}
