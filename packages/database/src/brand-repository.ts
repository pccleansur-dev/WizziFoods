import {
  parsePublicBrand,
  parseTenantScope,
  type PublicBrand,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

/** The public brand of one restaurant: name, colors and the logo it chose. */
export interface BrandRepository {
  getBrand(scope: TenantScope): Promise<PublicBrand | null>;
}

export function createBrandRepository(client: Sql): BrandRepository {
  return {
    async getBrand(rawScope) {
      const scope = parseTenantScope(rawScope);
      if (!scope) throw new Error("tenant scope must be canonical");
      const [row] = await client<{ result: unknown }[]>`
        select private.get_public_brand(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid
        ) as result
      `;
      if (row?.result === null || row?.result === undefined) return null;
      const brand = parsePublicBrand(row.result);
      if (!brand) throw new Error("public brand must be canonical");
      return brand;
    }
  };
}
