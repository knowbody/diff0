import { defineHook } from "eve/hooks";
import {
  enforceStationRetries,
  recordStationResult,
  stationRetries,
} from "../lib/station-retries.js";

export default defineHook({
  events: {
    "action.result"(event) {
      const result = event.data.result;
      if (result.kind !== "subagent-result") return;
      stationRetries.update((state) =>
        recordStationResult(
          state,
          event.data.turnId,
          result.callId,
          result.subagentName,
          result.isError === true,
        ),
      );
      // Throw at settlement, before the parent can generate a third delegation.
      enforceStationRetries(stationRetries.get());
    },
  },
});
