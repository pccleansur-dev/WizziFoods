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
import { BrandController } from "./brand/brand.controller.js";
import { createBrandLogoStorage } from "./brand/brand-logo-storage.js";
import { BrandService } from "./brand/brand.service.js";
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
import { DinerDraftController } from "./diner-draft/diner-draft.controller.js";
import { DinerDraftService } from "./diner-draft/diner-draft.service.js";
import { OrderIntentController } from "./order-intent/order-intent.controller.js";
import { OrderIntentService } from "./order-intent/order-intent.service.js";
import { FloorPlanAdminController } from "./floor-plan/floor-plan.controller.js";
import { FloorPlanService } from "./floor-plan/floor-plan.service.js";
import { TableEntryController } from "./table-entry/table-entry.controller.js";
import { TableEntryService } from "./table-entry/table-entry.service.js";
import { PaymentMethodsAdminController } from "./payment-methods/payment-methods.controller.js";
import { PaymentMethodsService } from "./payment-methods/payment-methods.service.js";
import {
  MetaWhatsappProvider,
  SimulatedWhatsappProvider
} from "@platform/integrations";

import { PaymentSecretSealer } from "./payment-methods/payment-secret-sealer.js";
import { ReadinessAdminController } from "./readiness/readiness.controller.js";
import { ReadinessService } from "./readiness/readiness.service.js";
import {
  StaffAuthController,
  StaffSessionController
} from "./staff-auth/staff-auth.controller.js";
import { StaffAuthService } from "./staff-auth/staff-auth.service.js";
import { StaffSessionGuard } from "./staff-auth/staff-session.guard.js";
import {
  FakeMercadoPagoController,
  FAKE_MERCADO_PAGO
} from "./mercado-pago/fake-mercado-pago.controller.js";
import {
  MercadoPagoAdminController,
  OnlineRefundsController
} from "./mercado-pago/mercado-pago-admin.controller.js";
import { MercadoPagoWebhookController } from "./mercado-pago/mercado-pago-webhook.controller.js";
import {
  MercadoPagoCallbackController,
  OnlinePaymentsController
} from "./mercado-pago/online-payments.controller.js";
import { DinerAccountController } from "./diner-identity/diner-account.controller.js";
import {
  DINER_AUTH_AVAILABLE,
  DinerAuthCallbackController,
  DinerAuthController,
  FakeGoogleController
} from "./diner-identity/diner-auth.controller.js";
import { DinerIdentityService } from "./diner-identity/diner-identity.service.js";
import { createDinerIdentityRuntime } from "./diner-identity/diner-identity.runtime.js";
import { createMercadoPagoRuntime } from "./mercado-pago/mercado-pago.runtime.js";
import { MercadoPagoService } from "./mercado-pago/mercado-pago.service.js";
import {
  SPLIT_CLAIMS,
  SplitClaimsController
} from "./split-claims/split-claims.controller.js";
import { CashRegisterController } from "./cash-register/cash-register.controller.js";
import { CashRegisterService } from "./cash-register/cash-register.service.js";
import { TableAccountsController } from "./table-accounts/table-accounts.controller.js";
import { TableAccountsService } from "./table-accounts/table-accounts.service.js";
import { LoyaltyDinerController } from "./loyalty/loyalty-diner.controller.js";
import { LoyaltyStaffController } from "./loyalty/loyalty-staff.controller.js";
import { LoyaltyService } from "./loyalty/loyalty.service.js";
import { MessagingStaffController } from "./messaging/messaging-staff.controller.js";
import { MessagingService } from "./messaging/messaging.service.js";
import {
  DINER_QR_RESOLVER,
  DinerRealtimeController
} from "./realtime/diner-realtime.controller.js";
import { RealtimeController } from "./realtime/realtime.controller.js";
import { RealtimeTokenService } from "./realtime/realtime-token.service.js";
import { PushDinerController } from "./messaging/push-diner.controller.js";
import { WhatsappWebhookController } from "./messaging/whatsapp-webhook.controller.js";
import { TableClosingController } from "./table-closing/table-closing.controller.js";
import { TableClosingService } from "./table-closing/table-closing.service.js";
import { TableRegroupingController } from "./table-regrouping/table-regrouping.controller.js";
import { TableRegroupingService } from "./table-regrouping/table-regrouping.service.js";
import { OrderAdjustmentsController } from "./order-adjustments/order-adjustments.controller.js";
import { OrderAdjustmentsService } from "./order-adjustments/order-adjustments.service.js";
import { ProductionController } from "./production/production.controller.js";
import { ProductionService } from "./production/production.service.js";
import { WaiterController } from "./waiter/waiter.controller.js";
import { WaiterService } from "./waiter/waiter.service.js";
import { AnthropicTranslationGateway } from "./translation/anthropic-translation.gateway.js";
import { TranslationAdminController } from "./translation/translation.controller.js";
import { TranslationService } from "./translation/translation.service.js";
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
    const mercadoPago = createMercadoPagoRuntime(config);
    const dinerIdentity = createDinerIdentityRuntime(config);
    return {
      controllers: [
        AppController,
        BusinessMediaController,
        BusinessProfileController,
        CatalogImportController,
        CatalogAdminController,
        DinerDraftController,
        FloorPlanAdminController,
        OrderIntentController,
        PaymentMethodsAdminController,
        PublicCatalogController,
        ReadinessAdminController,
        StaffAuthController,
        StaffSessionController,
        TableEntryController,
        SupportAccessController,
        PlatformOperationsController,
        TenantAdminScopeController,
        TenantContextController,
        TenantHostController,
        TenantProvisioningController,
        TeamAdminController,
        TranslationAdminController,
        TenantSuspensionController,
        OrderAdjustmentsController,
        CashRegisterController,
        SplitClaimsController,
        MercadoPagoAdminController,
        MercadoPagoCallbackController,
        MercadoPagoWebhookController,
        OnlinePaymentsController,
        OnlineRefundsController,
        // The sandbox exists only with the simulator, which production refuses.
        ...(mercadoPago.fake ? [FakeMercadoPagoController] : []),
        DinerAuthController,
        DinerAuthCallbackController,
        DinerAccountController,
        // Google's stand-in exists only with the simulator, which production refuses.
        ...(dinerIdentity.fake ? [FakeGoogleController] : []),
        TableAccountsController,
        LoyaltyDinerController,
        LoyaltyStaffController,
        MessagingStaffController,
        BrandController,
        RealtimeController,
        DinerRealtimeController,
        WhatsappWebhookController,
        PushDinerController,
        TableClosingController,
        TableRegroupingController,
        ProductionController,
        WaiterController
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
          provide: TableEntryService,
          useFactory: (database: TenantDatabase) =>
            new TableEntryService(database.floorPlanRepository)
        },
        {
          inject: [TableEntryService, TENANT_DATABASE],
          provide: DinerDraftService,
          useFactory: (
            tableEntryService: TableEntryService,
            database: TenantDatabase
          ) =>
            new DinerDraftService(tableEntryService, database.catalogRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: OrderIntentService,
          useFactory: (database: TenantDatabase) =>
            new OrderIntentService(database.orderIntentRepository)
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
          provide: TranslationService,
          useFactory: () =>
            new TranslationService(
              config.anthropicApiKey
                ? new AnthropicTranslationGateway(config.anthropicApiKey)
                : null
            )
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
        { provide: FAKE_MERCADO_PAGO, useValue: mercadoPago.fake },
        { provide: DINER_AUTH_AVAILABLE, useValue: dinerIdentity.available },
        {
          inject: [TENANT_DATABASE],
          provide: DinerIdentityService,
          useFactory: (database: TenantDatabase) =>
            new DinerIdentityService(
              database.dinerIdentityRepository,
              dinerIdentity.google,
              {
                scheme: dinerIdentity.scheme,
                stateSecret: dinerIdentity.stateSecret,
                subPepper: dinerIdentity.subPepper
              }
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: SPLIT_CLAIMS,
          useFactory: (database: TenantDatabase) =>
            database.splitClaimsRepository
        },
        {
          inject: [TENANT_DATABASE],
          provide: MercadoPagoService,
          useFactory: (database: TenantDatabase) =>
            new MercadoPagoService(
              database.mercadoPagoRepository,
              config.paymentSecretKey
                ? new PaymentSecretSealer(config.paymentSecretKey)
                : null,
              mercadoPago.gateway,
              {
                returnUrl: mercadoPago.returnUrl,
                webhookSecret: mercadoPago.webhookSecret
              }
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: CashRegisterService,
          useFactory: (database: TenantDatabase) =>
            new CashRegisterService(database.cashRegisterRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: TableAccountsService,
          useFactory: (database: TenantDatabase) =>
            new TableAccountsService(database.tableAccountsRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: DINER_QR_RESOLVER,
          useFactory: (database: TenantDatabase) => database.floorPlanRepository
        },
        {
          provide: RealtimeTokenService,
          useValue: new RealtimeTokenService(config.realtimeJwtSecret ?? null)
        },
        {
          inject: [TENANT_DATABASE],
          provide: BrandService,
          useFactory: (database: TenantDatabase) =>
            new BrandService(
              database.brandRepository,
              createBrandLogoStorage(
                config.supabaseUrl,
                config.supabaseSecretKey
              )
            )
        },
        {
          inject: [TENANT_DATABASE],
          provide: MessagingService,
          useFactory: (database: TenantDatabase) => {
            const whatsapp = config.whatsapp ?? { mode: "off" as const };
            const pushPublicKey =
              config.webPush && config.webPush.mode !== "off"
                ? config.webPush.publicKey
                : null;
            if (whatsapp.mode === "off") {
              return new MessagingService(
                database.messagingRepository,
                null,
                null,
                null,
                pushPublicKey
              );
            }
            return new MessagingService(
              database.messagingRepository,
              config.paymentSecretKey
                ? new PaymentSecretSealer(config.paymentSecretKey)
                : null,
              // The simulator refuses to exist in production.
              whatsapp.mode === "simulated"
                ? new SimulatedWhatsappProvider(config.environment)
                : new MetaWhatsappProvider({
                    graphVersion: whatsapp.graphVersion
                  }),
              {
                appSecret: whatsapp.appSecret,
                verifyToken: whatsapp.verifyToken
              },
              pushPublicKey
            );
          }
        },
        {
          inject: [TENANT_DATABASE],
          provide: LoyaltyService,
          useFactory: (database: TenantDatabase) =>
            new LoyaltyService(database.loyaltyRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: TableClosingService,
          useFactory: (database: TenantDatabase) =>
            new TableClosingService(database.tableClosingRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: TableRegroupingService,
          useFactory: (database: TenantDatabase) =>
            new TableRegroupingService(database.tableRegroupingRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: OrderAdjustmentsService,
          useFactory: (database: TenantDatabase) =>
            new OrderAdjustmentsService(database.orderAdjustmentsRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: ProductionService,
          useFactory: (database: TenantDatabase) =>
            new ProductionService(database.productionRepository)
        },
        {
          inject: [TENANT_DATABASE],
          provide: WaiterService,
          useFactory: (database: TenantDatabase) =>
            new WaiterService(
              database.waiterOperationsRepository,
              database.catalogRepository
            )
        },
        AdminAuthGuard,
        StaffSessionGuard,
        TenantHostGuard,
        TenantDatabaseLifecycle
      ]
    };
  }
}
