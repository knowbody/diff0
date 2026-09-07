import { expect, it } from "vitest";
import { cleanupResources } from "./cleanup.js";

it("attempts remaining cleanup even if the diagnostic callback throws", async () => {
  const attempted: number[] = [];
  await expect(
    cleanupResources(
      [1, 2].map((id) => ({
        cleanup: async () => {
          attempted.push(id);
          throw new Error(`cleanup ${id}`);
        },
      })),
      () => {
        throw new Error("observer failed");
      },
    ),
  ).resolves.toBeUndefined();
  expect(attempted).toEqual([1, 2]);
});
