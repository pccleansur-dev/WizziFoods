import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { DinerDraftController } from "./diner-draft.controller.js";

const token = "ab".repeat(32);

describe("DinerDraftController", () => {
  it("recalculates inside the tenant scope derived from the host", async () => {
    const context = { location: { id: "location" }, tenant: { id: "tenant" } };
    const controller = new DinerDraftController({
      recalculate: (receivedContext: unknown, request: unknown) => {
        expect(receivedContext).toBe(context);
        expect(request).toEqual({ items: [], token });
        return Promise.resolve({ draft: { totalCents: 0 }, status: "ok" });
      }
    } as never);

    await expect(
      controller.recalculate({ tenantHostContext: context } as never, {
        items: [],
        token
      })
    ).resolves.toEqual({ data: { draft: { totalCents: 0 }, status: "ok" } });
  });

  it("answers invalid for a malformed token without querying the service", async () => {
    const controller = new DinerDraftController({} as never);
    await expect(
      controller.recalculate({} as never, { items: [], token: "bad" })
    ).resolves.toEqual({ data: { status: "invalid" } });
  });

  it("rejects client prices and injected scope", async () => {
    const controller = new DinerDraftController({} as never);
    await expect(
      controller.recalculate({} as never, {
        items: [],
        tenantId: crypto.randomUUID(),
        token
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
