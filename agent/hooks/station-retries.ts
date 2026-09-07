import { defineHook } from "eve/hooks";
import {
  enforceStationRetries,
  recordStationResult,
  stationInFlight,
  stationInvocations,
  stationRetries,
} from "../lib/station-retries.js";

export default defineHook({
  events: {
    "turn.started"(event) {
      if (stationRetries.get().turnId !== event.data.turnId) {
        stationRetries.update(() => ({ turnId: event.data.turnId, seen: [], failures: {} }));
        stationInvocations.update(() => ({}));
        stationInFlight.update(() => null);
      }
    },
    "actions.requested"(event) {
      enforceStationRetries(stationRetries.get());
      for (const action of event.data.actions) {
        if (
          action.kind === "subagent-call" ||
          (action.kind === "tool-call" &&
            ["classifier", "analyst", "implementer", "reviewer", "researcher"].includes(
              action.toolName,
            ))
        )
          throw new Error("Factory stations must be invoked through run_station.");
        if (
          (action.kind === "tool-call" || action.kind === "workflow-tool-call") &&
          action.toolName === "run_station" &&
          typeof action.input.station === "string"
        ) {
          const active = stationInFlight.get();
          if (active !== null && active !== action.callId)
            throw new Error("Run factory stations sequentially, one run_station call at a time.");
          stationInFlight.update(() => action.callId);
          stationInvocations.update((state) => ({
            ...state,
            [action.callId]: action.input.station as string,
            [`${action.callId}:station`]: action.input.station as string,
          }));
        }
      }
    },
    "subagent.called"(event) {
      enforceStationRetries(stationRetries.get());
      if (stationInvocations.get()[event.data.callId] !== event.data.name)
        throw new Error(
          "Factory stations must be invoked through run_station so their results and retry limits remain enforced.",
        );
    },
    "action.result"(event) {
      const result = event.data.result;
      if (result.kind !== "tool-result") return;
      const station = stationInvocations.get()[result.callId];
      if (!station) return;
      if (stationInFlight.get() === result.callId) stationInFlight.update(() => null);
      stationRetries.update((state) =>
        recordStationResult(
          state,
          event.data.turnId,
          result.callId,
          station,
          result.isError === true,
        ),
      );
      // Throw at settlement, before the parent can generate a third delegation.
      enforceStationRetries(stationRetries.get());
    },
  },
});
