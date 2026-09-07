import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never pick up compiled copies of tests, the fixture agent's tree,
    // transient agent worktrees under .claude/, or the website's separate Node test suite.
    exclude: ["**/node_modules/**", "dist/**", "fixtures/**", "**/.claude/**", "website/**"],
  },
});
