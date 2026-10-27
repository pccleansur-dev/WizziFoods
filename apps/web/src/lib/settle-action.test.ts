import { describe, expect, it } from "vitest";

import { UNKNOWN_OUTCOME_MESSAGE } from "./connection-view";
import { settleAction } from "./settle-action";

describe("settleAction", () => {
  it("passes through what the server answered", async () => {
    await expect(
      settleAction(() => Promise.resolve({ data: 1, status: "ok" as const }))
    ).resolves.toEqual({ data: 1, status: "ok" });
    const refusal = {
      code: "NOT_ALLOWED",
      message: "No.",
      status: "error" as const
    };
    await expect(settleAction(() => Promise.resolve(refusal))).resolves.toBe(
      refusal
    );
  });

  it("turns a broken connection into an unknown outcome that keeps the command for the retry", async () => {
    const result = await settleAction(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    expect(result).toEqual({
      code: null,
      message: UNKNOWN_OUTCOME_MESSAGE,
      status: "error"
    });
  });
});
