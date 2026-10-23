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

  it("reads the current publication inside the authenticated tenant scope", async () => {
    const current = { revision: 4 };
    const context = { scope: { tenantId: crypto.randomUUID() } };
    const controller = new CatalogAdminController({
      getAdminCurrent: (received: unknown) => {
        expect(received).toBe(context);
        return Promise.resolve(current);
      }
    } as never);

    await expect(
      controller.getCurrent({ tenantAdminContext: context } as never)
    ).resolves.toEqual({ data: current });
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

  it("maps unmet publication requirements without leaking database details", async () => {
    const controller = new CatalogAdminController({
      publish: () =>
        Promise.reject({
          code: "22023",
          message: "catalog publication requirements missing: BUSINESS_IDENTITY"
        })
    } as never);

    const error = await controller
      .publish({ tenantAdminContext: {} } as never, { expectedDraftRevision: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      error: {
        code: "CATALOG_NOT_READY",
        message: "Completá los requisitos mínimos antes de publicar."
      }
    });
  });
});
