import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown
} from "@nestjs/common";
import type { ApiRuntimeConfig } from "@platform/config";
import { createTenantDatabase, type TenantDatabase } from "@platform/database";

import { AppController } from "./app.controller.js";
import { AdminAuthGuard } from "./auth/admin-auth.guard.js";
import { AdminAuthService } from "./auth/admin-auth.service.js";
import { SupabaseJwtVerifier } from "./auth/supabase-jwt.verifier.js";
import {
  StaffAuthController,
  StaffSessionController
} from "./staff-auth/staff-auth.controller.js";
import { StaffAuthService } from "./staff-auth/staff-auth.service.js";
import { TenantContextController } from "./tenants/tenant-context.controller.js";
import { TenantContextService } from "./tenants/tenant-context.service.js";
import { TenantHostController } from "./tenants/tenant-host.controller.js";
import { TenantHostGuard } from "./tenants/tenant-host.guard.js";
import { TenantHostService } from "./tenants/tenant-host.service.js";
import { createTenantAdminInvitationGateway } from "./tenant-provisioning/tenant-admin-invitation.gateway.js";
import { TenantProvisioningController } from "./tenant-provisioning/tenant-provisioning.controller.js";
import { TenantProvisioningService } from "./tenant-provisioning/tenant-provisioning.service.js";

const TENANT_DATABASE = Symbol("TENANT_DATABASE");

@Injectable()
class TenantDatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(TENANT_DATABASE) private readonly database: TenantDatabase
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}

@Module({})
export class AppModule {
  static register(config: ApiRuntimeConfig): DynamicModule {
    return {
      controllers: [
        AppController,
        StaffAuthController,
        StaffSessionController,
        TenantContextController,
        TenantHostController,
        TenantProvisioningController
      ],
      module: AppModule,
      providers: [
        {
          provide: TENANT_DATABASE,
          useFactory: () => createTenantDatabase(config.databaseUrl)
        },
        {
          inject: [TENANT_DATABASE],
          provide: TenantContextService,
          useFactory: (database: TenantDatabase) =>
            new TenantContextService(
              database.identityAccessRepository,
              database.tenantProvisioningRepository
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: TenantHostService,
          useFactory: (database: TenantDatabase) =>
            new TenantHostService(database.tenantDomainRepository)
        },
        {
          provide: AdminAuthService,
          useFactory: () =>
            new AdminAuthService(
              new SupabaseJwtVerifier(`${config.supabaseUrl}/auth/v1`)
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: StaffAuthService,
          useFactory: (database: TenantDatabase) =>
            new StaffAuthService(
              database.staffAuthRepository,
              config.staffPinPepper
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: TenantProvisioningService,
          useFactory: (database: TenantDatabase) =>
            new TenantProvisioningService(
              database.identityAccessRepository,
              database.tenantProvisioningRepository,
              createTenantAdminInvitationGateway(
                config.supabaseUrl,
                config.supabaseSecretKey
              ),
              config.adminInviteRedirectUrl
            )
        },
        AdminAuthGuard,
        TenantHostGuard,
        TenantDatabaseLifecycle
      ]
    };
  }
}
