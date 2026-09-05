import { describe, expect, it } from "vitest";
import { formatUsd } from "../src/report/format.js";

describe("formatUsd", () => {
  it("renders exact zero as $0.0000", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });

  it("renders finite positive values below the $0.0001 threshold as <$0.0001", () => {
    expect(formatUsd(0.00005)).toBe("<$0.0001");
    expect(formatUsd(0.000099999)).toBe("<$0.0001");
    expect(formatUsd(Number.MIN_VALUE)).toBe("<$0.0001");
  });

  it("renders the exact boundary value as $0.0001", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001");
  });

  it("preserves existing sub-$1 and $1-and-up formatting", () => {
    expect(formatUsd(0.03)).toBe("$0.0300");
    expect(formatUsd(0.0414)).toBe("$0.0414");
    expect(formatUsd(0.5)).toBe("$0.5000");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12)).toBe("$12.00");
  });

  it("does not special-case zero or negative values (unchanged behavior)", () => {
    expect(formatUsd(-0.00005)).toBe("$-0.0001");
    expect(formatUsd(-1)).toBe("$-1.0000");
  });
});
