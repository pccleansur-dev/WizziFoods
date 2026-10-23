import { BadRequestException } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it } from "vitest";

import { BusinessProfileController } from "./business-profile.controller.js";
import { BusinessProfileService } from "./business-profile.service.js";

describe("BusinessProfileController", () => {
  it("declares its service dependency explicitly", () => {
    expect(
      Reflect.getMetadata(
        SELF_DECLARED_DEPS_METADATA,
        BusinessProfileController
      )
    ).toEqual([{ index: 0, param: BusinessProfileService }]);
  });

  it("maps malformed bodies to a stable bad-request response", async () => {
    const controller = new BusinessProfileController({} as never);

    await expect(
      controller.save({} as never, { tenantId: "from-client" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
