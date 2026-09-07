import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

/** Keep the sequential pipeline blocking while Eve's direct subagents run in the background. */
export default defineWorkflowTool({
  description:
    "Run a factory station and wait durably for its structured result. Always use this tool instead of calling a station directly. Classifier triages, researcher verifies external facts, analyst plans, implementer edits and publishes, reviewer independently checks the branch. Include all required context in message.",
  inputSchema: z.object({
    station: z.enum(["classifier", "researcher", "analyst", "implementer", "reviewer"]),
    message: z.string().min(1),
    agentId: z.string().optional(),
  }),
  async execute({ station, message, agentId }, ctx) {
    "use workflow";
    return await ctx.agent({ key: "station", target: station, message, agentId });
  },
});
