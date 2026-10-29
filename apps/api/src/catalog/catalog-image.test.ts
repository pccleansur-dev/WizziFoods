import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CatalogImageController } from "./catalog-image.controller.js";
import { CatalogImageService } from "./catalog-image.service.js";

const id = "3e100000-0000-4000-8000-000000000001";
const asset = "3e100000-0000-4000-8000-0000000000a1";
const scope = { locationId: id, tenantId: id };
const stored = {
  contentType: "image/webp",
  objectPath: `tenants/${id}/locations/${id}/business-profile/product/${asset}.webp`,
  version: "abababababababab"
};
const bytes = Buffer.from("photo");

function setup(image: unknown, download = vi.fn().mockResolvedValue(bytes)) {
  const repository = {
    getPublicProductImage: vi.fn().mockResolvedValue(image)
  };
  const service = new CatalogImageService(repository, { download });
  return { download, repository, service };
}

describe("CatalogImageService", () => {
  it("reads the photo of the restaurant of the host and says which version it is", async () => {
    const { download, repository, service } = setup(stored);
    expect(await service.image(scope, asset)).toEqual({
      bytes,
      contentType: "image/webp",
      version: "abababababababab"
    });
    expect(repository.getPublicProductImage).toHaveBeenCalledWith(scope, asset);
    expect(download).toHaveBeenCalledWith(stored.objectPath);
  });

  it("touches no storage for a photo the published menu does not use", async () => {
    const { download, service } = setup(null);
    expect(await service.image(scope, asset)).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it("treats an unreadable photo as a missing one", async () => {
    const { service } = setup(
      stored,
      vi.fn().mockRejectedValue(new Error("storage down"))
    );
    expect(await service.image(scope, asset)).toBeNull();
  });
});

describe("CatalogImageController", () => {
  const request = {
    tenantHostContext: { location: { id }, tenant: { id } }
  } as never;
  const reply = () => {
    const headers: Record<string, string> = {};
    const self = {
      header(name: string, value: string) {
        headers[name] = value;
        return self;
      }
    };
    return { headers, self: self as never };
  };

  it("serves a cacheable photo taking the restaurant only from the host", async () => {
    const service = { image: vi.fn().mockResolvedValue({ ...stored, bytes }) };
    const out = reply();
    const body = await new CatalogImageController(service as never).image(
      request,
      out.self,
      asset.toUpperCase()
    );
    expect(body).toBe(bytes);
    expect(service.image).toHaveBeenCalledWith(scope, asset);
    expect(out.headers).toMatchObject({
      "cache-control": "public, max-age=86400",
      "content-type": "image/webp",
      etag: '"abababababababab"',
      "x-content-type-options": "nosniff"
    });
  });

  it("answers 404 for a malformed id without asking anyone, and for a photo that is not there", async () => {
    const service = { image: vi.fn().mockResolvedValue(null) };
    const controller = new CatalogImageController(service as never);
    await expect(
      controller.image(request, reply().self, "../etc/passwd")
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.image).not.toHaveBeenCalled();
    await expect(
      controller.image(request, reply().self, asset)
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
