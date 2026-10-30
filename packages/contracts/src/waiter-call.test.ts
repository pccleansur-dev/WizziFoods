import { describe, expect, it } from "vitest";

import {
  parseDinerWaiterCallRequest,
  parseDinerWaiterCallResult
} from "./waiter-call.js";

const token = "a".repeat(64);
const callId = "11111111-1111-4111-8111-111111111111";

describe("diner waiter call contract", () => {
  it("accepts only a token and one of the three reasons", () => {
    for (const reason of ["call_waiter", "request_bill", "help"]) {
      expect(parseDinerWaiterCallRequest({ reason, token })).toEqual({
        reason,
        token
      });
    }
    expect(
      parseDinerWaiterCallRequest({ reason: "order_validation", token })
    ).toBeNull();
    expect(
      parseDinerWaiterCallRequest({ reason: "help", token: "x" })
    ).toBeNull();
    expect(parseDinerWaiterCallRequest({ reason: "help" })).toBeNull();
    expect(parseDinerWaiterCallRequest(null)).toBeNull();
  });

  it("never accepts a tenant, a location or a table from the client", () => {
    for (const extra of ["tenantId", "locationId", "tableId", "status"]) {
      expect(
        parseDinerWaiterCallRequest({ [extra]: callId, reason: "help", token })
      ).toBeNull();
    }
  });

  it("parses a canonical result and refuses anything else", () => {
    const result = { callId, created: true, reason: "help", status: "open" };
    expect(parseDinerWaiterCallResult(result)).toEqual(result);
    expect(
      parseDinerWaiterCallResult({ ...result, status: "closed" })
    ).toBeNull();
    expect(
      parseDinerWaiterCallResult({ ...result, reason: "order_validation" })
    ).toBeNull();
    expect(parseDinerWaiterCallResult({ ...result, callId: "x" })).toBeNull();
    expect(parseDinerWaiterCallResult({ ...result, extra: 1 })).toBeNull();
  });
});
