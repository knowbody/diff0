import { defineTool } from "eve/tools";
import { z } from "zod";
export default defineTool({
  description: "Look up the fixed calibration value.",
  inputSchema: z.object({ requestId: z.string() }),
  execute: async () => ({ value: 42 }),
});
