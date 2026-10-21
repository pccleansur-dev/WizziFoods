import type { TenantRepository } from "@platform/database";
import { describe, expect, it, vi } from "vitest";

import { TenantContextService } from "./tenant-context.service.js";

describe("TenantContextService", () => {
  it("derives tenant context only from the authenticated identity", async () => {
    const findForIdentity = vi.fn<TenantRepository["findForIdentity"]>();
    findForIdentity.mockResolvedValue([]);
    const service = new TenantContextService({ findForIdentity });

    await expect(
      service.getForAuthenticatedIdentity(
        "10000000-0000-4000-8000-000000000001"
      )
    ).resolves.toEqual([]);
    expect(findForIdentity).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001"
    );
  });
});
