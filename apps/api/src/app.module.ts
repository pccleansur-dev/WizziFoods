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
import { TenantContextController } from "./tenants/tenant-context.controller.js";
import { TenantContextService } from "./tenants/tenant-context.service.js";

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
      controllers: [AppController, TenantContextController],
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
            new TenantContextService(database.tenantRepository)
        },
        {
          provide: AdminAuthService,
          useFactory: () =>
            new AdminAuthService(
              new SupabaseJwtVerifier(`${config.supabaseUrl}/auth/v1`)
            )
        },
        AdminAuthGuard,
        TenantDatabaseLifecycle
      ]
    };
  }
}
