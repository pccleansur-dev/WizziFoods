import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { parseTranslationRequest } from "@platform/contracts";
import { describe, expect, it, vi } from "vitest";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { TenantAdminScopeGuard } from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import {
  AnthropicTranslationGateway,
  TranslationFailedError
} from "./anthropic-translation.gateway.js";
import { TranslationAdminController } from "./translation.controller.js";
import { TranslationService } from "./translation.service.js";

const id = "a1000000-0000-4000-8000-000000000001";
const apiKey = "sk-ant-secret-0123456789";
const body = {
  sourceLanguage: "es",
  targetLanguage: "en",
  texts: [
    { key: `product:${id}:title`, text: "Milanesa" },
    { key: `product:${id}:description`, text: "Con papas" }
  ]
};
const request = parseTranslationRequest(body)!;

function providerReply(text: string, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify({ content: [{ text, type: "text" }] }), {
      status
    })
  );
}

const goodJson = JSON.stringify({
  translations: [
    { key: `product:${id}:title`, text: "Milanese" },
    { key: `product:${id}:description`, text: "With fries" }
  ]
});

describe("AnthropicTranslationGateway", () => {
  it("sends only the keyed texts and languages, with the key in the header", async () => {
    const fetcher = vi.fn(() => providerReply(goodJson));
    const result = await new AnthropicTranslationGateway(
      apiKey,
      fetcher as never
    ).translate(request);
    expect(result).toEqual([
      { key: `product:${id}:title`, text: "Milanese" },
      { key: `product:${id}:description`, text: "With fries" }
    ]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> }
    ];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe(apiKey);
    expect(init.body).not.toContain(apiKey);
    expect(init.body).toContain("Milanesa");
    expect(init.body).not.toMatch(/tenant|location|session/iu);
  });

  it("accepts a JSON answer wrapped in a code fence", async () => {
    const fetcher = vi.fn(() =>
      providerReply("```json\n" + goodJson + "\n```")
    );
    await expect(
      new AnthropicTranslationGateway(apiKey, fetcher as never).translate(
        request
      )
    ).resolves.toHaveLength(2);
  });

  it("fails without leaking the key or the provider detail", async () => {
    const cases = [
      () => providerReply("no es json"),
      () => providerReply(JSON.stringify({ translations: [] })),
      () => providerReply("{}", 401),
      () => Promise.reject(new Error(`boom ${apiKey}`))
    ];
    for (const makeReply of cases) {
      const error = await new AnthropicTranslationGateway(apiKey, (() =>
        makeReply()) as never)
        .translate(request)
        .then(
          () => null,
          (thrown: unknown) => thrown
        );
      expect(error).toBeInstanceOf(TranslationFailedError);
      expect(String((error as Error).message)).not.toContain(apiKey);
    }
  });
});

const context = {
  identity: { userId: "f3000000-0000-4000-8000-000000000003" },
  scope: {
    locationId: "f4000000-0000-4000-8000-000000000004",
    tenantId: "f5000000-0000-4000-8000-000000000005"
  }
};
const httpRequest = { tenantAdminContext: context } as never;

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

describe("TranslationAdminController", () => {
  it("requires authentication, the tenant host and administrator scope", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TranslationAdminController)
    ).toEqual([AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard]);
  });

  it("rejects bodies that carry a tenant or instructions", async () => {
    const translate = vi.fn();
    const controller = new TranslationAdminController({ translate } as never);
    expect(
      await failure(
        controller.translate(httpRequest, { ...body, tenantId: "x" })
      )
    ).toBeInstanceOf(BadRequestException);
    expect(translate).not.toHaveBeenCalled();
  });

  it("returns translations keyed like the request", async () => {
    const translate = vi.fn().mockResolvedValue([{ key: "k", text: "t" }]);
    const controller = new TranslationAdminController({ translate } as never);
    expect(await controller.translate(httpRequest, body)).toEqual({
      data: { translations: [{ key: "k", text: "t" }] }
    });
    expect(translate).toHaveBeenCalledWith(request);
  });

  it("answers 502 on provider failure without detail", async () => {
    const controller = new TranslationAdminController({
      translate: () => Promise.reject(new TranslationFailedError())
    } as never);
    const error = (await failure(
      controller.translate(httpRequest, body)
    )) as BadGatewayException;
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.getResponse()).toEqual({
      error: { code: "TRANSLATION_FAILED", message: expect.any(String) }
    });
  });
});

describe("TranslationService", () => {
  it("fails closed with 503 when no provider key is configured", async () => {
    const error = await failure(
      new TranslationService(null).translate(request)
    );
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      error: { code: "TRANSLATION_UNAVAILABLE", message: expect.any(String) }
    });
  });

  it("delegates to the gateway when configured", async () => {
    const translate = vi.fn().mockResolvedValue([]);
    await new TranslationService({ translate }).translate(request);
    expect(translate).toHaveBeenCalledWith(request);
  });
});
