import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  PaymentSecretSealer,
  SimulatedWhatsappProvider,
  signWebhookBody
} from "@platform/integrations";
import { describe, expect, it, vi } from "vitest";

import { MessagingStaffController } from "./messaging-staff.controller.js";
import { MessagingService } from "./messaging.service.js";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller.js";

const tenantId = "3b000000-0000-4000-8000-000000000001";
const locationId = "3b000000-0000-4000-8000-000000000002";
const templateId = "3b000000-0000-4000-8000-000000000003";
const automationId = "3b000000-0000-4000-8000-000000000004";
const commandId = "3b000000-0000-4000-8000-000000000005";
const profileId = "3b000000-0000-4000-8000-000000000006";

function dbError(code: string) {
  return Object.assign(new Error("db"), { code });
}

function staff(capabilities: string[]) {
  return {
    staffContext: {
      capabilities,
      role: "manager",
      scope: { locationId, tenantId },
      staffId: "3b000000-0000-4000-8000-0000000000aa"
    }
  } as never;
}

const manager = staff(["operations.approve"]);

function controllerWith(service: Record<string, unknown>) {
  return new MessagingStaffController(service as never);
}

describe("MessagingStaffController", () => {
  it("is only for who may approve operations", async () => {
    const service = { getOverview: vi.fn() };
    const controller = controllerWith(service);
    await expect(
      controller.overview(staff(["payments.collect"]))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getOverview).not.toHaveBeenCalled();
  });

  it("takes the restaurant from the session and refuses extra or malformed fields", async () => {
    const service = {
      connect: vi.fn().mockResolvedValue({ connection: null }),
      proposeOneOff: vi.fn(),
      saveAutomation: vi.fn()
    };
    const controller = controllerWith(service);
    const body = {
      accessToken: "EAAG" + "x".repeat(40),
      phoneNumberId: "10000000001",
      wabaId: "20000000001"
    };
    await controller.connect(manager, body);
    expect(service.connect).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { locationId, tenantId } }),
      expect.objectContaining({ displayPhone: null })
    );
    await expect(
      controller.connect(manager, { ...body, tenantId })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.propose(manager, {
        commandId,
        profileIds: [profileId, profileId],
        templateId,
        variables: []
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.saveAutomation(manager, { kind: "weekly", templateId })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.proposeOneOff).not.toHaveBeenCalled();
    expect(service.saveAutomation).not.toHaveBeenCalled();
  });

  it("maps database refusals to readable answers", async () => {
    const service = {
      decideAutomation: vi.fn(),
      decideOneOff: vi.fn(),
      getOverview: vi.fn()
    };
    const controller = controllerWith(service);
    service.getOverview.mockRejectedValue(dbError("PT222"));
    await expect(controller.overview(manager)).rejects.toMatchObject({
      response: { error: { code: "MANAGER_REQUIRED" } }
    });
    service.decideAutomation.mockRejectedValue(dbError("PT296"));
    await expect(
      controller.decideAutomation(manager, automationId, {
        decision: "resume"
      })
    ).rejects.toBeInstanceOf(ConflictException);
    service.decideOneOff.mockRejectedValue(dbError("PT298"));
    await expect(
      controller.decideOneOff(manager, commandId, { decision: "confirm" })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.decideOneOff(manager, "not-a-uuid", { decision: "confirm" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function serviceWith(overrides: {
  provider?: SimulatedWhatsappProvider | null;
  repository?: Record<string, unknown>;
  webhook?: boolean;
}) {
  const repository = {
    claimWebhookEvent: vi.fn().mockResolvedValue("new"),
    connect: vi.fn().mockResolvedValue({}),
    finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
    recordDelivery: vi.fn().mockResolvedValue("applied"),
    recordOptOut: vi.fn().mockResolvedValue("applied"),
    upsertTemplates: vi.fn().mockResolvedValue({ connection: null }),
    ...overrides.repository
  };
  const service = new MessagingService(
    repository as never,
    new PaymentSecretSealer(Buffer.alloc(32, 1)),
    overrides.provider === undefined
      ? new SimulatedWhatsappProvider()
      : overrides.provider,
    overrides.webhook === false
      ? null
      : { appSecret: "an-app-secret-of-16+", verifyToken: "a-verify-token-16+" }
  );
  return { repository, service };
}

const context = {
  capabilities: ["operations.approve"],
  role: "manager",
  scope: { locationId, tenantId },
  staffId: "3b000000-0000-4000-8000-0000000000aa"
} as never;

describe("MessagingService", () => {
  it("stores nothing when Meta rejects the token, and seals it when it accepts", async () => {
    const provider = new SimulatedWhatsappProvider();
    const { repository, service } = serviceWith({ provider });
    const request = {
      accessToken: "EAAG-the-token-0123456789", // secret-scan: allow
      displayPhone: null,
      phoneNumberId: "10000000001",
      wabaId: "20000000001"
    };
    vi.spyOn(provider, "listTemplates").mockRejectedValueOnce(new Error("401"));
    await expect(service.connect(context, request)).rejects.toBeInstanceOf(
      UnprocessableEntityException
    );
    expect(repository.connect).not.toHaveBeenCalled();

    await service.connect(context, request);
    const stored = repository.connect.mock.calls[0]![0] as {
      credential: { ciphertext: Buffer };
    };
    expect(
      stored.credential.ciphertext.includes(Buffer.from(request.accessToken))
    ).toBe(false);
  });

  it("is unavailable, not broken, when WhatsApp is off", async () => {
    const { service } = serviceWith({ provider: null });
    await expect(
      service.connect(context, {
        accessToken: "x".repeat(30),
        displayPhone: null,
        phoneNumberId: "10000000001",
        wabaId: "20000000001"
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("checks the signature before reading anything, then applies each event once", async () => {
    const { repository, service } = serviceWith({});
    const raw = Buffer.from(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "5491122220001",
                      id: "wamid.A",
                      text: { body: "BAJA" },
                      type: "text"
                    },
                    {
                      from: "5491122220001",
                      id: "wamid.B",
                      text: { body: "hola" },
                      type: "text"
                    }
                  ],
                  metadata: { phone_number_id: "10000000001" },
                  statuses: [{ id: "wamid.C", status: "delivered" }]
                }
              }
            ]
          }
        ],
        object: "whatsapp_business_account"
      })
    );
    await expect(
      service.handleWebhook({
        rawBody: raw,
        signature: "sha256=" + "a".repeat(64)
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.handleWebhook({ rawBody: undefined, signature: undefined })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.claimWebhookEvent).not.toHaveBeenCalled();

    repository.claimWebhookEvent.mockImplementation(
      ({ eventKey }: { eventKey: string }) =>
        Promise.resolve(eventKey === "message:wamid.B" ? "duplicate" : "new")
    );
    const result = await service.handleWebhook({
      rawBody: raw,
      signature: signWebhookBody("an-app-secret-of-16+", raw)
    });
    expect(result.received).toBe(3);
    expect(repository.recordDelivery).toHaveBeenCalledTimes(1);
    expect(repository.recordOptOut).toHaveBeenCalledWith({
      phone: "+5491122220001",
      phoneNumberId: "10000000001"
    });
    expect(repository.finishWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it("leaves an event unfinished when applying it fails, so Meta's retry applies it", async () => {
    const { repository, service } = serviceWith({});
    repository.recordOptOut.mockRejectedValue(new Error("db down"));
    const raw = Buffer.from(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "5491122220001",
                      id: "wamid.A",
                      text: { body: "baja" },
                      type: "text"
                    }
                  ],
                  metadata: { phone_number_id: "10000000001" }
                }
              }
            ]
          }
        ],
        object: "whatsapp_business_account"
      })
    );
    await expect(
      service.handleWebhook({
        rawBody: raw,
        signature: signWebhookBody("an-app-secret-of-16+", raw)
      })
    ).rejects.toThrow("db down");
    expect(repository.finishWebhookEvent).not.toHaveBeenCalled();
  });

  it("does not exist as a webhook when WhatsApp is off", async () => {
    const { service } = serviceWith({ webhook: false });
    await expect(
      service.handleWebhook({
        rawBody: Buffer.from("{}"),
        signature: undefined
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(() =>
      service.verifyHandshake({ challenge: "1", mode: "subscribe", token: "x" })
    ).toThrow(NotFoundException);
  });

  it("answers the handshake only for the verify token", () => {
    const { service } = serviceWith({});
    const controller = new WhatsappWebhookController(service);
    const query = (token: string) => ({
      "hub.challenge": "777",
      "hub.mode": "subscribe",
      "hub.verify_token": token
    });
    expect(controller.verify(query("a-verify-token-16+"))).toBe("777");
    expect(() => controller.verify(query("wrong-token-of-length"))).toThrow(
      ForbiddenException
    );
  });
});
