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
import { BusinessMediaController } from "./business-media/business-media.controller.js";
import { createBusinessMediaStorageGateway } from "./business-media/business-media-storage.gateway.js";
import { BusinessMediaService } from "./business-media/business-media.service.js";
import { BusinessProfileController } from "./business-profile/business-profile.controller.js";
import { BusinessProfileService } from "./business-profile/business-profile.service.js";
import {
  CatalogAdminController,
  PublicCatalogController
} from "./catalog/catalog.controller.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { CatalogImportController } from "./catalog-import/catalog-import.controller.js";
import { CatalogImportService } from "./catalog-import/catalog-import.service.js";
import { FloorPlanAdminController } from "./floor-plan/floor-plan.controller.js";
import { FloorPlanService } from "./floor-plan/floor-plan.service.js";
import { PaymentMethodsAdminController } from "./payment-methods/payment-methods.controller.js";
import { PaymentMethodsService } from "./payment-methods/payment-methods.service.js";
import { PaymentSecretSealer } from "./payment-methods/payment-secret-sealer.js";
import { ReadinessAdminController } from "./readiness/readiness.controller.js";
import { ReadinessService } from "./readiness/readiness.service.js";
import {
  StaffAuthController,
  StaffSessionController
} from "./staff-auth/staff-auth.controller.js";
import { StaffAuthService } from "./staff-auth/staff-auth.service.js";
import { TeamAdminController } from "./team/team.controller.js";
import { TeamService } from "./team/team.service.js";
import { SupportAccessController } from "./support-access/support-access.controller.js";
import { SupportAccessService } from "./support-access/support-access.service.js";
import { TenantContextController } from "./tenants/tenant-context.controller.js";
import { TenantContextService } from "./tenants/tenant-context.service.js";
import { TenantAdminScopeController } from "./tenants/tenant-admin-scope.controller.js";
import { TenantAdminScopeGuard } from "./tenants/tenant-admin-scope.guard.js";
import { TenantAdminScopeService } from "./tenants/tenant-admin-scope.service.js";
import { TenantHostController } from "./tenants/tenant-host.controller.js";
import { TenantHostGuard } from "./tenants/tenant-host.guard.js";
import { TenantHostService } from "./tenants/tenant-host.service.js";
import { createTenantAdminInvitationGateway } from "./tenant-provisioning/tenant-admin-invitation.gateway.js";
import { TenantProvisioningController } from "./tenant-provisioning/tenant-provisioning.controller.js";
import { TenantProvisioningService } from "./tenant-provisioning/tenant-provisioning.service.js";
import { PlatformOperationsController } from "./tenant-suspension/platform-operations.controller.js";
import { TenantSuspensionController } from "./tenant-suspension/tenant-suspension.controller.js";
import { TenantSuspensionService } from "./tenant-suspension/tenant-suspension.service.js";

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
        BusinessMediaController,
        BusinessProfileController,
        CatalogImportController,
        CatalogAdminController,
        FloorPlanAdminController,
        PaymentMethodsAdminController,
        PublicCatalogController,
        ReadinessAdminController,
        StaffAuthController,
        StaffSessionController,
        SupportAccessController,
        PlatformOperationsController,
        TenantAdminScopeController,
        TenantContextController,
        TenantHostController,
        TenantProvisioningController,
        TeamAdminController,
        TenantSuspensionController
      ],
      module: AppModule,
      providers: [
        {
          provide: TENANT_DATABASE,
          useFactory: () => createTenantDatabase(config.databaseUrl)
        },
        TenantAdminScopeGuard,
        TenantAdminScopeService,
        {
          inject: [TENANT_DATABASE],
          provide: CatalogImportService,
          useFactory: (database: TenantDatabase) =>
            new CatalogImportService(
              database.catalogImportRepository,
              database.catalogRepository
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: BusinessMediaService,
          useFactory: (database: TenantDatabase) =>
            new BusinessMediaService(
              database.businessMediaRepository,
              createBusinessMediaStorageGateway(
                config.supabaseUrl,
                config.supabaseSecretKey
              )
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: BusinessProfileService,
          useFactory: (database: TenantDatabase) =>
            new BusinessProfileService(database.businessProfileRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: CatalogService,
          useFactory: (database: TenantDatabase) =>
            new CatalogService(database.catalogRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: FloorPlanService,
          useFactory: (database: TenantDatabase) =>
            new FloorPlanService(database.floorPlanRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: PaymentMethodsService,
          useFactory: (database: TenantDatabase) =>
            new PaymentMethodsService(
              database.paymentMethodsRepository,
              config.paymentSecretKey
                ? new PaymentSecretSealer(config.paymentSecretKey)
                : null
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: ReadinessService,
          useFactory: (database: TenantDatabase) =>
            new ReadinessService(database.readinessRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: TeamService,
          useFactory: (database: TenantDatabase) =>
            new TeamService(database.teamRepository, config.staffPinPepper)
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
          provide: SupportAccessService,
          useFactory: (database: TenantDatabase) =>
            new SupportAccessService(database.supportAccessRepository)
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
              config.adminInviteRedirectUrl,
              config.platformBaseDomain
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: TenantSuspensionService,
          useFactory: (database: TenantDatabase) =>
            new TenantSuspensionService(
              database.identityAccessRepository,
              database.tenantSuspensionRepository
            )
        },
        AdminAuthGuard,
        TenantHostGuard,
        TenantDatabaseLifecycle
      ]
    };
  }
}
