import { describe, expect, it, vi } from "vitest";

import { createWaiterCallRepository } from "./waiter-call-repository.js";

const scope = {
  locationId: "1b000000-0000-4000-8000-000000000001",
  tenantId: "1b000000-0000-4000-8000-000000000002"
};
const token = "c".repeat(64);
const callId = "1b000000-0000-4000-8000-000000000003";

describe("waiter call repository", () => {
  it("creates a call from the scope and the token only", async () => {
    const client = vi.fn(async () => [
      { result: { callId, created: true, reason: "help", status: "open" } }
    ]) as never;
    await expect(
      createWaiterCallRepository(client).create({
        request: { reason: "help", token },
        scope
      })
    ).resolves.toEqual({
      callId,
      created: true,
      reason: "help",
      status: "open"
    });
    const [, ...values] = (client as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(values).toEqual([scope.tenantId, scope.locationId, token, "help"]);
  });

  it("refuses non-canonical input before querying", async () => {
    const client = vi.fn(() => {
      throw new Error("database must not be queried");
    }) as never;
    const repository = createWaiterCallRepository(client);
    await expect(
      repository.create({
        request: { reason: "order_validation", token } as never,
        scope
      })
    ).rejects.toThrow("waiter call request must be canonical");
    await expect(
      repository.create({
        request: { reason: "help", token },
        scope: { ...scope, tenantId: "x" }
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
  });

  it("refuses a non-canonical database result", async () => {
    const client = vi.fn(async () => [
      { result: { callId, created: true, reason: "order_validation" } }
    ]) as never;
    await expect(
      createWaiterCallRepository(client).create({
        request: { reason: "help", token },
        scope
      })
    ).rejects.toThrow("waiter call result must be canonical");
  });
});
