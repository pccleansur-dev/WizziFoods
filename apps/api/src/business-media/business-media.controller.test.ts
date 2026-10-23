import { BadRequestException } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it } from "vitest";

import { BusinessMediaController } from "./business-media.controller.js";
import { BusinessMediaService } from "./business-media.service.js";

describe("BusinessMediaController", () => {
  it("declares its service dependency explicitly", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, BusinessMediaController)
    ).toEqual([{ index: 0, param: BusinessMediaService }]);
  });

  it("rejects a malformed asset identifier at the HTTP boundary", async () => {
    const controller = new BusinessMediaController({} as never);

    await expect(
      controller.queue({} as never, "asset-from-client")
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a malformed status identifier at the HTTP boundary", async () => {
    const controller = new BusinessMediaController({} as never);

    await expect(
      controller.getStatus({} as never, "asset-from-client")
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
