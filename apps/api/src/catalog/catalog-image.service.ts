import type { CatalogRepository } from "@platform/database";
import type { TenantScope } from "@platform/contracts";

/** Reads a stored product photo; only the server ever does. */
export interface CatalogImageStorage {
  download(objectPath: string): Promise<Buffer>;
}

export type PublicCatalogImage = {
  bytes: Buffer;
  contentType: string;
  version: string;
};

/**
 * The photos of the products of the published menu of one restaurant. The diner reads them
 * through here because the bucket is private; a photo is served only while the current
 * published catalog of that restaurant and location points at it.
 */
export class CatalogImageService {
  constructor(
    private readonly repository: Pick<
      CatalogRepository,
      "getPublicProductImage"
    >,
    private readonly storage: CatalogImageStorage
  ) {}

  async image(
    scope: TenantScope,
    assetId: string
  ): Promise<PublicCatalogImage | null> {
    const image = await this.repository.getPublicProductImage(scope, assetId);
    if (!image) return null;
    try {
      return {
        bytes: await this.storage.download(image.objectPath),
        contentType: image.contentType,
        version: image.version
      };
    } catch {
      // A photo that cannot be read is a missing photo, never a broken menu.
      return null;
    }
  }
}
