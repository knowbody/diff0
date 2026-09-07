import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
export default defineAgent({
  modelContextWindowTokens: 200000,
  model: mockModel(({ lastUserMessage, toolResults, userMessageCount }) => {
    if (lastUserMessage === "success") {
      const completed = toolResults.filter((result) => !result.isError).length;
      if (completed >= userMessageCount * 2) return "Completed two stations.";
      return { toolCalls: [{ name: "run_station", input: { station: "analyst", message: "succeed" } }] };
    }
    if (lastUserMessage === "direct") {
      return { toolCalls: [{ name: "analyst", input: { message: "deliberate failure" } }] };
    }
    const call = { name: "run_station", input: { station: "analyst", message: "deliberate failure" } };
    return { toolCalls: lastUserMessage === "parallel" ? [call, call, call] : [call] };
  }),
});
