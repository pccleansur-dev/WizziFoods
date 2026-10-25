import { describe, expect, it } from "vitest";

import {
  parseClaimShareRequest,
  parseDinerSplitTarget,
  parseDinerSplitView,
  parseReleaseShareRequest
} from "./split-claims.js";
import { parseCreateItemSplitRequest } from "./table-accounts.js";

const token = "a".repeat(64);
const secret = "S".repeat(43);
const id = "2b000000-0000-4000-8000-000000000001";

describe("split claims", () => {
  it("validates device requests", () => {
    expect(parseDinerSplitTarget({ secret, token })).toEqual({ secret, token });
    expect(parseDinerSplitTarget({ secret: "short", token })).toBeNull();
    expect(parseDinerSplitTarget({ secret, token, tenantId: id })).toBeNull();
    expect(
      parseClaimShareRequest({ label: " Ana ", position: 2, secret, token })
    ).toEqual({
      label: "Ana",
      position: 2,
      secret,
      token
    });
    expect(
      parseClaimShareRequest({ label: " ", position: 2, secret, token })
    ).toBeNull();
    expect(
      parseClaimShareRequest({
        label: "A".repeat(41),
        position: 2,
        secret,
        token
      })
    ).toBeNull();
    expect(
      parseClaimShareRequest({ label: "Ana", position: 0, secret, token })
    ).toBeNull();
    expect(
      parseReleaseShareRequest({ position: 3, secret, token })
    ).toMatchObject({ position: 3 });
    expect(
      parseReleaseShareRequest({ position: 21, secret, token })
    ).toBeNull();
  });

  it("parses the diner view and refuses malformed shares", () => {
    const share = (position: number, status: string) => ({
      amountCents: 500,
      claimedBy: status === "claimed" ? "Beto" : null,
      items: ["1 × Milanesa"],
      mine: status === "claimed",
      position,
      status
    });
    const view = {
      pendingCents: 1000,
      split: {
        kind: "items",
        shares: [share(1, "open"), share(2, "claimed")],
        splitId: id
      }
    };
    expect(parseDinerSplitView(view)).toEqual(view);
    expect(parseDinerSplitView({ pendingCents: 0, split: null })).toEqual({
      pendingCents: 0,
      split: null
    });
    expect(
      parseDinerSplitView({
        ...view,
        split: { ...view.split, shares: [share(1, "open")] }
      })
    ).toBeNull();
    expect(
      parseDinerSplitView({ ...view, split: { ...view.split, kind: "x" } })
    ).toBeNull();
    expect(
      parseDinerSplitView({
        ...view,
        split: { ...view.split, shares: [share(2, "open"), share(1, "open")] }
      })
    ).toBeNull();
  });

  it("validates an item split request", () => {
    const line = "2b000000-0000-4000-8000-000000000009";
    const request = {
      assignments: [{ lineId: line, position: 1 }],
      commandId: id,
      persons: 2
    };
    expect(parseCreateItemSplitRequest(request)).toEqual(request);
    expect(
      parseCreateItemSplitRequest({ ...request, assignments: [] })
    ).toMatchObject({ persons: 2 });
    expect(
      parseCreateItemSplitRequest({
        ...request,
        assignments: [{ lineId: line, position: 3 }]
      })
    ).toBeNull();
    expect(
      parseCreateItemSplitRequest({
        ...request,
        assignments: [
          { lineId: line, position: 1 },
          { lineId: line, position: 2 }
        ]
      })
    ).toBeNull();
    expect(parseCreateItemSplitRequest({ ...request, persons: 1 })).toBeNull();
  });
});
