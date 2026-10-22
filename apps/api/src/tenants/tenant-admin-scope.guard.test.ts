import type { ExecutionContext } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import type { TenantHostContext } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import { TenantAdminScopeGuard } from "./tenant-admin-scope.guard.js";
import {
  TenantAdminScopeService,
  type TenantAdminRequestContext
} from "./tenant-admin-scope.service.js";

describe("TenantAdminScopeGuard", () => {
  it("declares its scope service dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, TenantAdminScopeGuard)
    ).toEqual([{ index: 0, param: TenantAdminScopeService }]);
  });

  it("uses only contexts attached by authentication and host guards", async () => {
    const adminIdentity: AdminIdentity = {
      assuranceLevel: "aal2",
      sessionId: "97000000-0000-4000-8000-000000000097",
      userId: "96000000-0000-4000-8000-000000000096"
    };
    const tenantHostContext: TenantHostContext = {
      domain: {
        hostname: "tenant-a.plataforma.test",
        id: "98000000-0000-4000-8000-000000000098"
      },
      location: {
        id: "92000000-0000-4000-8000-000000000092",
        name: "Principal"
      },
      tenant: {
        id: "91000000-0000-4000-8000-000000000091",
        name: "Tenant A",
        slug: "tenant-a"
      }
    };
    const tenantAdminContext: TenantAdminRequestContext = {
      ...tenantHostContext,
      identity: {
        assuranceLevel: adminIdentity.assuranceLevel,
        userId: adminIdentity.userId
      },
      role: "admin",
      scope: {
        locationId: tenantHostContext.location.id,
        tenantId: tenantHostContext.tenant.id
      }
    };
    const received: unknown[] = [];
    const guard = new TenantAdminScopeGuard({
      resolve: async (...input: unknown[]) => {
        received.push(input);
        return tenantAdminContext;
      }
    } as TenantAdminScopeService);
    const request: Record<string, unknown> = {
      adminIdentity,
      body: { tenant_id: "93000000-0000-4000-8000-000000000093" },
      tenantHostContext
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(received).toEqual([[adminIdentity, tenantHostContext]]);
    expect(request.tenantAdminContext).toEqual(tenantAdminContext);
  });
});
