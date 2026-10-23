import { BadRequestException, ConflictException } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it } from "vitest";

import {
  CatalogAdminController,
  PublicCatalogController
} from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";

describe("catalog controllers", () => {
  it.each([CatalogAdminController, PublicCatalogController])(
    "%s declares the catalog service dependency",
    (controller) => {
      expect(
        Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, controller)
      ).toEqual([{ index: 0, param: CatalogService }]);
    }
  );

  it("maps a malformed draft to a stable bad-request response", async () => {
    const controller = new CatalogAdminController({} as never);

    await expect(
      controller.saveDraft({} as never, { tenantId: "from-client" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps a malformed availability body to a bad request", async () => {
    const controller = new CatalogAdminController({} as never);

    await expect(
      controller.setAvailability({} as never, crypto.randomUUID(), {
        expectedVersion: 0,
        isAvailable: false
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps a stale database revision to a conflict response", async () => {
    const controller = new CatalogAdminController({
      saveDraft: () => Promise.reject({ code: "40001" })
    } as never);

    await expect(
      controller.saveDraft({ tenantAdminContext: {} } as never, {
        baseRevision: null,
        categories: [],
        products: [],
        sectors: []
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
