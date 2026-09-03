import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import { getDiff0Version } from "./collect/cache.js";

describe("diff0 CLI metadata", () => {
  it("prints the installed package version", async () => {
    let stdout = "";
    const code = await runCli(["node", "diff0", "--version"], {
      out: (text) => {
        stdout += text;
      },
      err: () => {},
    });

    expect(code).toBe(0);
    expect(stdout.trim()).toBe(getDiff0Version());
  });
});
