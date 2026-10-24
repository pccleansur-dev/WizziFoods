import { BadRequestException } from "@nestjs/common";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";

import { TableEntryController } from "./table-entry.controller.js";
import { TableEntryService } from "./table-entry.service.js";

const token = "ab".repeat(32);
const request = { tenantHostContext: { tenant: { id: "t" } } } as never;

describe("TableEntryController", () => {
  it("declares the service dependency", () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, TableEntryController)
    ).toEqual([{ index: 0, param: TableEntryService }]);
  });

  it("resolves the token inside the tenant the host proved", async () => {
    const resolve = vi.fn().mockResolvedValue({ status: "invalid" });
    const result = await new TableEntryController({ resolve } as never).enter(
      request,
      { token }
    );
    expect(result).toEqual({ data: { status: "invalid" } });
    expect(resolve).toHaveBeenCalledWith(
      (request as { tenantHostContext: unknown }).tenantHostContext,
      token
    );
  });

  it.each([{ token: "short" }, { token: token.toUpperCase() }, { token: 7 }])(
    "answers a malformed token %j exactly like an unknown one",
    async (body) => {
      const resolve = vi.fn().mockResolvedValue({ status: "invalid" });
      const result = await new TableEntryController({ resolve } as never).enter(
        request,
        body
      );
      expect(result).toEqual({ data: { status: "invalid" } });
    }
  );

  it.each([{}, { token, tenantId: "from-client" }, null, "text"])(
    "rejects a body that is not just a token: %j",
    async (body) => {
      const resolve = vi.fn();
      const error = await new TableEntryController({ resolve } as never)
        .enter(request, body)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(resolve).not.toHaveBeenCalled();
    }
  );
});
