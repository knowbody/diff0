import { defineTool } from "eve/tools";
import { z } from "zod";

/** Deterministic fake warehouse: every query returns the same single row. */
export default defineTool({
  description: "Run a read-only SQL query against the demo revenue warehouse.",
  inputSchema: z.object({ query: z.string().min(1) }),
  execute({ query }) {
    return {
      query,
      rows: [{ total_revenue: 42 }],
      rowCount: 1,
    };
  },
});
