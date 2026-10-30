import { describe, expect, it, vi } from "vitest";

import {
  sendWaiterCall,
  waiterCallFailureMessage,
  waiterCallReasons
} from "./waiter-call";

const token = "d".repeat(64);
const callId = "1c000000-0000-4000-8000-000000000001";

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("waiterCallReasons", () => {
  it("offers nothing when the table does not allow calling", () => {
    expect(waiterCallReasons({ canCallWaiter: false, mode: "join" })).toEqual(
      []
    );
  });

  it("offers the bill only on an open table", () => {
    expect(waiterCallReasons({ canCallWaiter: true, mode: "join" })).toEqual([
      "call_waiter",
      "request_bill",
      "help"
    ]);
    for (const mode of ["start", "view_only"] as const) {
      expect(waiterCallReasons({ canCallWaiter: true, mode })).toEqual([
        "call_waiter",
        "help"
      ]);
    }
  });
});

describe("sendWaiterCall", () => {
  it("sends only the token and the reason to the same-origin route", async () => {
    const fetcher = answer(200, {
      data: { callId, created: true, reason: "help", status: "open" }
    });
    const outcome = await sendWaiterCall(token, "help", fetcher as never);
    expect(outcome).toMatchObject({ result: { callId }, status: "sent" });
    expect(fetcher).toHaveBeenCalledWith("/api/waiter-calls", {
      body: JSON.stringify({ reason: "help", token }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
  });

  it.each([
    ["WAITER_CALL_RATE_LIMITED", 429, "Ya avisamos varias veces"],
    ["WAITER_CALL_NO_OPEN_TABLE", 409, "no hay una cuenta abierta"],
    ["WAITER_CALL_TABLE_CHANGED", 409, "Escaneá nuevamente"],
    ["OTHER", 500, waiterCallFailureMessage]
  ])(
    "explains %s without pretending it was sent",
    async (code, status, text) => {
      const outcome = await sendWaiterCall(
        token,
        "call_waiter",
        answer(status, { error: { code } }) as never
      );
      expect(outcome.status).toBe("error");
      expect(outcome.status === "error" && outcome.message).toContain(text);
    }
  );

  it("does not trust a non-canonical answer", async () => {
    const outcome = await sendWaiterCall(
      token,
      "help",
      answer(200, { data: { callId: "x" } }) as never
    );
    expect(outcome).toEqual({
      message: waiterCallFailureMessage,
      status: "error"
    });
  });

  it("reports a network failure as not sent", async () => {
    const outcome = await sendWaiterCall(
      token,
      "help",
      vi.fn().mockRejectedValue(new Error("offline")) as never
    );
    expect(outcome.status).toBe("error");
  });
});
