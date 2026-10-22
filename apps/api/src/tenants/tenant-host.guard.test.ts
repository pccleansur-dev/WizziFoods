import type { ExecutionContext } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import type { TenantHostContext } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { TenantHostGuard } from "./tenant-host.guard.js";
import { TenantHostService } from "./tenant-host.service.js";

describe("TenantHostGuard", () => {
  it("declares its resolver dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, TenantHostGuard)
    ).toEqual([{ index: 0, param: TenantHostService }]);
  });

  it("attaches context derived only from Host", async () => {
    const tenantHostContext: TenantHostContext = {
      domain: { hostname: "real.plataforma.test", id: "domain-a" },
      location: { id: "location-a", name: "Principal" },
      tenant: { id: "tenant-a", name: "Tenant A", slug: "tenant-a" }
    };
    const authorities: unknown[] = [];
    const guard = new TenantHostGuard({
      resolve: async (authority) => {
        authorities.push(authority);
        return tenantHostContext;
      }
    } as TenantHostService);
    const request: {
      headers: Record<string, string>;
      tenantHostContext?: TenantHostContext;
    } = {
      headers: {
        host: "real.plataforma.test:3001",
        "x-forwarded-host": "attacker.plataforma.test"
      }
    };
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(authorities).toEqual(["real.plataforma.test:3001"]);
    expect(request.tenantHostContext).toEqual(tenantHostContext);
  });
});
