import { ServiceUnavailableException } from "@nestjs/common";
import type {
  PaymentMethodKey,
  PaymentMethodStatus,
  PaymentMethodUpdate
} from "@platform/contracts";
import type { PaymentMethodsRepository } from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import type { PaymentSecretSealer } from "./payment-secret-sealer.js";

export class PaymentMethodsService {
  constructor(
    private readonly repository: PaymentMethodsRepository,
    private readonly sealer: PaymentSecretSealer | null
  ) {}

  list(context: TenantAdminRequestContext): Promise<PaymentMethodStatus[]> {
    return this.repository.list(context.scope, context.identity.userId);
  }

  update(
    context: TenantAdminRequestContext,
    method: PaymentMethodKey,
    update: PaymentMethodUpdate
  ): Promise<PaymentMethodStatus[]> {
    return this.repository.update({
      enabled: update.enabled,
      method,
      publicConfig: update.publicConfig,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  /** Seals the credential in memory; only ciphertext is persisted. */
  storeCredential(
    context: TenantAdminRequestContext,
    method: PaymentMethodKey,
    secret: string
  ): Promise<PaymentMethodStatus[]> {
    if (!this.sealer) {
      throw new ServiceUnavailableException({
        error: {
          code: "PAYMENT_SECRETS_UNAVAILABLE",
          message:
            "El almacenamiento seguro de credenciales no está configurado en este entorno."
        }
      });
    }
    return this.repository.storeSecret({
      method,
      requesterId: context.identity.userId,
      scope: context.scope,
      sealed: this.sealer.seal(secret, context.scope, method)
    });
  }

  clearCredential(
    context: TenantAdminRequestContext,
    method: PaymentMethodKey
  ): Promise<PaymentMethodStatus[]> {
    return this.repository.clearSecret({
      method,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }
}
