import {
  toPublicBrandView,
  type BrandIconSize,
  type PublicBrandView,
  type TenantScope
} from "@platform/contracts";
import type { BrandRepository } from "@platform/database";

import { renderBrandIcon } from "./brand-icon.js";

/** Reads the private logo of a restaurant; only the server ever does. */
export interface BrandLogoStorage {
  download(objectPath: string): Promise<Buffer>;
}

const cacheLimit = 64;

/**
 * The public face of a restaurant for the installed app: its name, colors and an icon
 * made from its logo. Nothing here can fail a page: a missing or unreadable logo is a
 * plain tile, and a restaurant with no profile uses its name.
 */
export class BrandService {
  private readonly icons = new Map<string, Buffer>();

  constructor(
    private readonly repository: BrandRepository,
    private readonly storage: BrandLogoStorage
  ) {}

  async view(scope: TenantScope): Promise<PublicBrandView | null> {
    const brand = await this.repository.getBrand(scope);
    return brand ? toPublicBrandView(brand) : null;
  }

  async icon(
    scope: TenantScope,
    size: BrandIconSize,
    maskable: boolean
  ): Promise<Buffer | null> {
    const brand = await this.repository.getBrand(scope);
    if (!brand) return null;
    const key = [
      scope.tenantId,
      brand.logo?.version ?? "none",
      brand.name,
      brand.primaryColor,
      brand.backgroundColor,
      size,
      maskable
    ].join("|");
    const cached = this.icons.get(key);
    if (cached) return cached;
    let logo: Buffer | null = null;
    if (brand.logo) {
      try {
        logo = await this.storage.download(brand.logo.objectPath);
      } catch {
        logo = null;
      }
    }
    const png = await renderBrandIcon({
      backgroundColor: brand.backgroundColor,
      logo,
      maskable,
      name: brand.name,
      primaryColor: brand.primaryColor,
      size
    });
    // A fallback made because the storage hiccuped is not remembered.
    if (logo !== null || brand.logo === null) {
      if (this.icons.size >= cacheLimit) {
        const oldest = this.icons.keys().next().value;
        if (oldest !== undefined) this.icons.delete(oldest);
      }
      this.icons.set(key, png);
    }
    return png;
  }
}
