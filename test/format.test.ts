import { describe, expect, it } from "vitest";
import { formatUsd } from "../src/report/format.js";

describe("formatUsd", () => {
  it("renders exact zero as $0.0000", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });

  it("renders tiny positive values below the four-decimal threshold as <$0.0001", () => {
    expect(formatUsd(0.00001)).toBe("<$0.0001");
    expect(formatUsd(0.000099)).toBe("<$0.0001");
    expect(formatUsd(Number.MIN_VALUE)).toBe("<$0.0001");
  });

  it("renders the boundary value 0.0001 as $0.0001", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001");
  });

  it("renders a value that rounds up to the boundary at four decimals as $0.0001", () => {
    // 0.00009999 rounds up to 0.0001 at four decimals, but is still < 0.0001,
    // so it must use the sentinel rather than the misleading rounded value.
    expect(formatUsd(0.00009999)).toBe("<$0.0001");
  });

  it("preserves existing sub-$1 formatting away from the tiny-value boundary", () => {
    expect(formatUsd(0.0300)).toBe("$0.0300");
    expect(formatUsd(0.5)).toBe("$0.5000");
  });

  it("preserves existing $1-and-up formatting", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12)).toBe("$12.00");
  });

  it("does not apply the sentinel to zero or negative values", () => {
    expect(formatUsd(-0.00001)).toBe("$-0.0000");
  });
});
