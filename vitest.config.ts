import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never pick up compiled copies of tests, the fixture agent's tree,
    // or transient agent worktrees under .claude/.
    exclude: ["**/node_modules/**", "dist/**", "fixtures/**", "**/.claude/**"],
  },
});
