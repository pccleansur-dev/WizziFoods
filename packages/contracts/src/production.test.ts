import { describe, expect, it } from "vitest";

import {
  parseProductionAdvanceRequest,
  parseProductionAdvanceResult,
  parseProductionBoard
} from "./production.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "44444444-4444-4444-8444-444444444444";
const tableId = "55555555-5555-4555-8555-555555555555";

const board = {
  generatedAt: "2026-10-24T12:00:00.000Z",
  sector: "kitchen",
  tickets: [
    {
      attribution: "table",
      confirmedAt: "2026-10-24T11:58:00.000Z",
      dinerName: null,
      items: [
        {
          lineId,
          quantity: 2,
          status: "queued",
          title: "Milanesa",
          variantTitle: null
        }
      ],
      orderId,
      orderStatus: "queued",
      seatLabel: null,
      status: "queued",
      tableId,
      tableLabel: "7"
    }
  ]
};

describe("production contracts", () => {
  it("accepts only a command id and a forward target when advancing an item", () => {
    expect(
      parseProductionAdvanceRequest({ commandId, status: "preparing" })
    ).toEqual({ commandId, status: "preparing" });
    expect(
      parseProductionAdvanceRequest({ commandId, status: "ready" })
    ).toEqual({ commandId, status: "ready" });
  });

  it.each([
    ["a queue target", { commandId, status: "queued" }],
    ["a delivery target", { commandId, status: "delivered" }],
    ["a missing command id", { status: "ready" }],
    ["a client tenant", { commandId, status: "ready", tenantId: orderId }],
    ["a client sector", { commandId, sector: "bar", status: "ready" }]
  ])("rejects %s", (_name, body) => {
    expect(parseProductionAdvanceRequest(body)).toBeNull();
  });

  it("parses a canonical board", () => {
    expect(parseProductionBoard(board)).toEqual(board);
  });

  it.each([
    ["an unknown sector", { ...board, sector: "other" }],
    [
      "a ticket with a price",
      { ...board, tickets: [{ ...board.tickets[0], totalCents: 100 }] }
    ],
    [
      "an item with an unknown status",
      {
        ...board,
        tickets: [
          {
            ...board.tickets[0],
            items: [{ ...board.tickets[0]!.items[0], status: "paid" }]
          }
        ]
      }
    ],
    [
      "a ticket without items",
      { ...board, tickets: [{ ...board.tickets[0], items: [] }] }
    ],
    ["a missing sector", { generatedAt: board.generatedAt, tickets: [] }]
  ])("rejects %s", (_name, value) => {
    expect(parseProductionBoard(value)).toBeNull();
  });

  it("parses an advance result and rejects a status that contradicts it", () => {
    const result = {
      changed: true,
      lineId,
      orderId,
      orderStatus: "in_preparation",
      status: "preparing"
    };
    expect(parseProductionAdvanceResult(result)).toEqual(result);
    expect(
      parseProductionAdvanceResult({ ...result, status: "queued" })
    ).toBeNull();
    expect(
      parseProductionAdvanceResult({ ...result, orderStatus: "paid" })
    ).toBeNull();
  });
});
