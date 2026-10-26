import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  createAuditRepository,
  type AuditRepository
} from "./audit-repository.js";
import {
  createBusinessProfileRepository,
  type BusinessProfileRepository
} from "./business-profile-repository.js";
import {
  createBusinessMediaRepository,
  type BusinessMediaRepository
} from "./business-media-repository.js";
import {
  createCatalogRepository,
  type CatalogRepository
} from "./catalog-repository.js";
import {
  createFloorPlanRepository,
  type FloorPlanRepository
} from "./floor-plan-repository.js";
import {
  createPaymentMethodsRepository,
  type PaymentMethodsRepository
} from "./payment-methods-repository.js";
import {
  createOrderIntentRepository,
  type OrderIntentRepository
} from "./order-intent-repository.js";
import {
  createCashRegisterRepository,
  type CashRegisterRepository
} from "./cash-register-repository.js";
import {
  createSplitClaimsRepository,
  type SplitClaimsRepository
} from "./split-claims-repository.js";
import {
  createMercadoPagoRepository,
  type MercadoPagoRepository
} from "./mercado-pago-repository.js";
import {
  createTableAccountsRepository,
  type TableAccountsRepository
} from "./table-accounts-repository.js";
import {
  createTableClosingRepository,
  type TableClosingRepository
} from "./table-closing-repository.js";
import {
  createDinerIdentityRepository,
  type DinerIdentityRepository
} from "./diner-identity-repository.js";
import {
  createLoyaltyRepository,
  type LoyaltyRepository
} from "./loyalty-repository.js";
import {
  createTableRegroupingRepository,
  type TableRegroupingRepository
} from "./table-regrouping-repository.js";
import {
  createOrderAdjustmentsRepository,
  type OrderAdjustmentsRepository
} from "./order-adjustments-repository.js";
import {
  createProductionRepository,
  type ProductionRepository
} from "./production-repository.js";
import {
  createWaiterOperationsRepository,
  type WaiterOperationsRepository
} from "./waiter-operations-repository.js";
import {
  createReadinessRepository,
  type ReadinessRepository
} from "./readiness-repository.js";
import {
  createTeamRepository,
  type TeamRepository
} from "./team-repository.js";
import {
  createCatalogImportRepository,
  type CatalogImportRepository
} from "./catalog-import-repository.js";
import {
  locations,
  platformSuperadmins,
  tenantMemberships,
  tenants
} from "./schema.js";
import {
  createStaffAuthRepository,
  type StaffAuthRepository
} from "./staff-auth-repository.js";
import {
  createSupportAccessRepository,
  type SupportAccessRepository
} from "./support-access-repository.js";
import {
  createTenantDomainRepository,
  type TenantDomainRepository
} from "./tenant-domain-repository.js";
import {
  createTenantProvisioningRepository,
  type TenantProvisioningRepository
} from "./tenant-provisioning-repository.js";
import {
  createTenantSuspensionRepository,
  type TenantSuspensionRepository
} from "./tenant-suspension-repository.js";

export type TenantContext = {
  location: {
    id: string;
    name: string;
  };
  role: "admin";
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "draft" | "suspended";
  };
};

export interface TenantRepository {
  findForIdentity(userId: string): Promise<TenantContext[]>;
}

export type IdentityAccess =
  | { type: "platform_superadmin" }
  | { tenantContexts: TenantContext[]; type: "tenant_admin" }
  | { type: "unassigned" };

export interface IdentityAccessRepository {
  resolveForIdentity(
    userId: string,
    sessionId: string
  ): Promise<IdentityAccess | null>;
}

export type TenantDatabase = {
  auditRepository: AuditRepository;
  businessMediaRepository: BusinessMediaRepository;
  businessProfileRepository: BusinessProfileRepository;
  catalogImportRepository: CatalogImportRepository;
  catalogRepository: CatalogRepository;
  close(): Promise<void>;
  floorPlanRepository: FloorPlanRepository;
  identityAccessRepository: IdentityAccessRepository;
  orderIntentRepository: OrderIntentRepository;
  orderAdjustmentsRepository: OrderAdjustmentsRepository;
  cashRegisterRepository: CashRegisterRepository;
  mercadoPagoRepository: MercadoPagoRepository;
  splitClaimsRepository: SplitClaimsRepository;
  tableAccountsRepository: TableAccountsRepository;
  tableClosingRepository: TableClosingRepository;
  tableRegroupingRepository: TableRegroupingRepository;
  dinerIdentityRepository: DinerIdentityRepository;
  loyaltyRepository: LoyaltyRepository;
  productionRepository: ProductionRepository;
  waiterOperationsRepository: WaiterOperationsRepository;
  paymentMethodsRepository: PaymentMethodsRepository;
  readinessRepository: ReadinessRepository;
  staffAuthRepository: StaffAuthRepository;
  teamRepository: TeamRepository;
  supportAccessRepository: SupportAccessRepository;
  tenantDomainRepository: TenantDomainRepository;
  tenantProvisioningRepository: TenantProvisioningRepository;
  tenantRepository: TenantRepository;
  tenantSuspensionRepository: TenantSuspensionRepository;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

export function createTenantDatabase(databaseUrl: string): TenantDatabase {
  const client = postgres(databaseUrl, { max: 10, prepare: false });
  const database = drizzle(client);
  type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

  async function assumeAuthenticatedIdentity(
    transaction: Transaction,
    userId: string
  ): Promise<void> {
    await transaction.execute(
      sql`select set_config('request.jwt.claim.sub', ${userId}, true)`
    );
    await transaction.execute(sql.raw("set local role authenticated"));
  }

  async function queryTenantContexts(
    transaction: Transaction,
    userId: string
  ): Promise<TenantContext[]> {
    const rows = await transaction
      .select({
        locationId: locations.id,
        locationName: locations.name,
        role: tenantMemberships.role,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        tenantStatus: tenants.status
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .innerJoin(
        locations,
        and(eq(locations.tenantId, tenants.id), eq(locations.isPrimary, true))
      )
      .where(eq(tenantMemberships.userId, userId));

    return rows.map((row) => ({
      location: { id: row.locationId, name: row.locationName },
      role: row.role,
      tenant: {
        id: row.tenantId,
        name: row.tenantName,
        slug: row.tenantSlug,
        status: row.tenantStatus
      }
    }));
  }

  return {
    auditRepository: createAuditRepository(client),
    businessMediaRepository: createBusinessMediaRepository(client),
    businessProfileRepository: createBusinessProfileRepository(client),
    catalogImportRepository: createCatalogImportRepository(client),
    catalogRepository: createCatalogRepository(client),
    close: async () => client.end(),
    floorPlanRepository: createFloorPlanRepository(client),
    orderIntentRepository: createOrderIntentRepository(client),
    orderAdjustmentsRepository: createOrderAdjustmentsRepository(client),
    cashRegisterRepository: createCashRegisterRepository(client),
    mercadoPagoRepository: createMercadoPagoRepository(client),
    splitClaimsRepository: createSplitClaimsRepository(client),
    tableAccountsRepository: createTableAccountsRepository(client),
    tableClosingRepository: createTableClosingRepository(client),
    tableRegroupingRepository: createTableRegroupingRepository(client),
    dinerIdentityRepository: createDinerIdentityRepository(client),
    loyaltyRepository: createLoyaltyRepository(client),
    productionRepository: createProductionRepository(client),
    waiterOperationsRepository: createWaiterOperationsRepository(client),
    paymentMethodsRepository: createPaymentMethodsRepository(client),
    readinessRepository: createReadinessRepository(client),
    teamRepository: createTeamRepository(client),
    identityAccessRepository: {
      async resolveForIdentity(
        userId: string,
        sessionId: string
      ): Promise<IdentityAccess | null> {
        assertUuid(userId, "userId");
        assertUuid(sessionId, "sessionId");

        return database.transaction(async (transaction) => {
          await assumeAuthenticatedIdentity(transaction, userId);
          const activeSession = await transaction.execute<{ active: boolean }>(
            sql`select private.is_auth_session_active(${sessionId}::uuid, ${userId}::uuid) as active`
          );

          if (!activeSession[0]?.active) {
            return null;
          }

          const [platformAssignment] = await transaction
            .select({ userId: platformSuperadmins.userId })
            .from(platformSuperadmins)
            .where(eq(platformSuperadmins.userId, userId))
            .limit(1);

          if (platformAssignment) {
            return { type: "platform_superadmin" };
          }

          const tenantContexts = await queryTenantContexts(transaction, userId);
          return tenantContexts.length > 0
            ? { tenantContexts, type: "tenant_admin" }
            : { type: "unassigned" };
        });
      }
    },
    staffAuthRepository: createStaffAuthRepository(client),
    supportAccessRepository: createSupportAccessRepository(client),
    tenantDomainRepository: createTenantDomainRepository(client),
    tenantProvisioningRepository: createTenantProvisioningRepository(client),
    tenantSuspensionRepository: createTenantSuspensionRepository(client),
    tenantRepository: {
      async findForIdentity(userId: string): Promise<TenantContext[]> {
        assertUuid(userId, "userId");

        return database.transaction(async (transaction) => {
          await assumeAuthenticatedIdentity(transaction, userId);
          return queryTenantContexts(transaction, userId);
        });
      }
    }
  };
}
