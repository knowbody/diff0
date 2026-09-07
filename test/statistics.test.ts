import { describe, expect, it } from "vitest";
import {
  fisherExactDirectional,
  fisherExactTwoSided,
  holmAdjusted,
} from "../src/analyze/statistics.js";
import { median, metricStats, sequencesEqual } from "../src/numeric.js";
import { sortKeysDeep, stableStringify } from "../src/serialization.js";

describe("statistical primitives", () => {
  it("retains directional and two-sided Fisher tail conventions", () => {
    expect(fisherExactDirectional(3, 3, 0, 3)).toBeCloseTo(0.05, 12);
    expect(fisherExactDirectional(0, 3, 3, 3)).toBeCloseTo(0.05, 12);
    expect(fisherExactTwoSided(3, 3, 0, 3)).toBeCloseTo(0.1, 12);
    expect(fisherExactTwoSided(1, 2, 1, 2)).toBeCloseTo(1, 12);
  });
  it("applies monotonic Holm correction in original hypothesis order", () => {
    const adjusted = holmAdjusted([0.04, 0.01, 0.03]);
    expect(adjusted[0]).toBeCloseTo(0.06);
    expect(adjusted[1]).toBeCloseTo(0.03);
    expect(adjusted[2]).toBeCloseTo(0.06);
    expect(holmAdjusted([])).toEqual([]);
  });
  it("shares empty-sample and sequence semantics without mutating samples", () => {
    const values = [3, 1, 2, 4];
    expect(median(values)).toBe(2.5);
    expect(values).toEqual([3, 1, 2, 4]);
    expect(() => median([])).toThrow("empty input");
    expect(metricStats([])).toBeNull();
    expect(sequencesEqual(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("serialization compatibility", () => {
  it("preserves legacy lexical fingerprint keys and undefined semantics", () => {
    expect(
      stableStringify({ 2: "two", 10: "ten", z: undefined, nested: [undefined, { b: 1, a: 2 }] }),
    ).toBe('{"10":"ten","2":"two","nested":[null,{"a":2,"b":1}]}');
    const sparse = Array(2);
    sparse[1] = 1;
    expect(stableStringify(sparse)).toBe("[,1]");
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify(new Date("2020-01-01"))).toBe("{}");
  });
  it("retains JSON presentation semantics for numeric keys and special property names", () => {
    const input = JSON.parse('{"z":1,"__proto__":{"b":2,"a":1},"2":"two","10":"ten"}');
    expect(JSON.stringify(sortKeysDeep(input))).toBe(
      '{"2":"two","10":"ten","__proto__":{"a":1,"b":2},"z":1}',
    );
  });
});

it("keeps finite extreme medians in range without overflow or subnormal underflow", () => {
  expect(median([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
  expect(median([-Number.MAX_VALUE, Number.MAX_VALUE])).toBe(0);
  expect(median([Number.MIN_VALUE, Number.MIN_VALUE])).toBe(Number.MIN_VALUE);
});
