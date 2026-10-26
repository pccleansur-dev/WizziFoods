import { timingSafeEqual } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import type {
  ConnectWhatsappRequest,
  DecideAutomationRequest,
  DecideOneOffRequest,
  DecidedOneOff,
  DinerPushConfig,
  DinerPushState,
  MessagingAudienceMember,
  MessagingEvent,
  MessagingOverview,
  ProposeOneOffRequest,
  ProposedOneOff,
  PushSubscriptionRequest,
  SavePushTemplateRequest,
  SaveAutomationRequest,
  TenantScope
} from "@platform/contracts";
import type {
  MessagingRepository,
  MessagingWebhookOutcome
} from "@platform/database";
import {
  WHATSAPP_SECRET_METHOD,
  isOptOutText,
  parseWhatsappWebhook,
  verifyWebhookBody,
  type PaymentSecretSealer,
  type WhatsappProvider
} from "@platform/integrations";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export type MessagingWebhookSettings = {
  appSecret: string;
  verifyToken: string;
};

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: {
      code: "MESSAGING_NOT_AVAILABLE",
      message: "Los mensajes de WhatsApp no están disponibles en este entorno."
    }
  });
}

function sameText(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * WhatsApp for one restaurant. The tenant and location come from the staff session;
 * the access token is sealed here and never returned. Whether a message may leave is
 * decided in the database when the worker is about to send it, not here.
 */
export class MessagingService {
  constructor(
    private readonly repository: MessagingRepository,
    private readonly sealer: PaymentSecretSealer | null,
    private readonly provider: WhatsappProvider | null,
    private readonly webhook: MessagingWebhookSettings | null,
    /** The VAPID public key; null when the PWA does not offer notifications. */
    private readonly pushPublicKey: string | null = null
  ) {}

  getOverview(context: StaffRequestContext): Promise<MessagingOverview> {
    return this.repository.getOverview(this.staff(context));
  }

  listEvents(
    context: StaffRequestContext,
    limit: number
  ): Promise<MessagingEvent[]> {
    return this.repository.listEvents({ ...this.staff(context), limit });
  }

  listAudience(
    context: StaffRequestContext
  ): Promise<MessagingAudienceMember[]> {
    return this.repository.listAudience(this.staff(context));
  }

  /** Meta must accept the token before anything is stored. */
  async connect(
    context: StaffRequestContext,
    request: ConnectWhatsappRequest
  ): Promise<MessagingOverview> {
    if (!this.sealer || !this.provider) throw unavailable();
    let templates;
    try {
      templates = await this.provider.listTemplates({
        accessToken: request.accessToken,
        wabaId: request.wabaId
      });
    } catch {
      throw new UnprocessableEntityException({
        error: {
          code: "WHATSAPP_CREDENTIALS_REJECTED",
          message: "Meta no aceptó el token o el ID de la cuenta."
        }
      });
    }
    const credential = this.sealer.seal(
      request.accessToken,
      context.scope,
      WHATSAPP_SECRET_METHOD
    );
    await this.repository.connect({
      ...this.staff(context),
      credential,
      displayPhone: request.displayPhone,
      phoneNumberId: request.phoneNumberId,
      wabaId: request.wabaId
    });
    return this.repository.upsertTemplates({
      ...this.staff(context),
      templates
    });
  }

  disconnect(context: StaffRequestContext): Promise<MessagingOverview> {
    return this.repository.disconnect(this.staff(context));
  }

  setSending(
    context: StaffRequestContext,
    enabled: boolean
  ): Promise<MessagingOverview> {
    return this.repository.setSending({ ...this.staff(context), enabled });
  }

  async syncTemplates(
    context: StaffRequestContext
  ): Promise<MessagingOverview> {
    if (!this.sealer || !this.provider) throw unavailable();
    const credentials = await this.repository.readCredentials(context.scope);
    if (!credentials) {
      throw new ConflictException({
        error: {
          code: "WHATSAPP_NOT_CONNECTED",
          message: "Primero conectá el número de WhatsApp del restaurante."
        }
      });
    }
    const templates = await this.provider.listTemplates({
      accessToken: this.sealer.open(
        credentials.ciphertext,
        context.scope,
        WHATSAPP_SECRET_METHOD
      ),
      wabaId: credentials.wabaId
    });
    return this.repository.upsertTemplates({
      ...this.staff(context),
      templates
    });
  }

  setTemplateCost(
    context: StaffRequestContext,
    templateId: string,
    estimatedCostCents: number
  ): Promise<MessagingOverview> {
    return this.repository.setTemplateCost({
      ...this.staff(context),
      estimatedCostCents,
      templateId
    });
  }

  saveAutomation(
    context: StaffRequestContext,
    request: SaveAutomationRequest
  ): Promise<MessagingOverview> {
    return this.repository.saveAutomation({
      ...this.staff(context),
      ...request
    });
  }

  decideAutomation(
    context: StaffRequestContext,
    automationId: string,
    request: DecideAutomationRequest
  ): Promise<MessagingOverview> {
    return this.repository.decideAutomation({
      ...this.staff(context),
      automationId,
      decision: request.decision
    });
  }

  proposeOneOff(
    context: StaffRequestContext,
    request: ProposeOneOffRequest
  ): Promise<ProposedOneOff> {
    return this.repository.proposeOneOff({
      ...this.staff(context),
      ...request
    });
  }

  decideOneOff(
    context: StaffRequestContext,
    batchId: string,
    request: DecideOneOffRequest
  ): Promise<DecidedOneOff> {
    return this.repository.decideOneOff({
      ...this.staff(context),
      batchId,
      decision: request.decision
    });
  }

  setPushSending(
    context: StaffRequestContext,
    enabled: boolean
  ): Promise<MessagingOverview> {
    return this.repository.setPushSending({ ...this.staff(context), enabled });
  }

  savePushTemplate(
    context: StaffRequestContext,
    request: SavePushTemplateRequest
  ): Promise<MessagingOverview> {
    return this.repository.savePushTemplate({
      ...this.staff(context),
      request
    });
  }

  pushConfig(): DinerPushConfig {
    return {
      available: this.pushPublicKey !== null,
      publicKey: this.pushPublicKey
    };
  }

  registerPush(
    scope: TenantScope,
    accountId: string,
    request: PushSubscriptionRequest
  ): Promise<DinerPushState> {
    if (this.pushPublicKey === null) throw unavailable();
    return this.repository.registerPush({ accountId, request, scope });
  }

  pushState(
    scope: TenantScope,
    accountId: string,
    endpoint: string
  ): Promise<DinerPushState> {
    return this.repository.getPushState({ accountId, endpoint, scope });
  }

  unregisterPush(
    scope: TenantScope,
    accountId: string,
    endpoint: string
  ): Promise<DinerPushState> {
    return this.repository.unregisterPush({ accountId, endpoint, scope });
  }

  /** Meta's handshake when the webhook is registered. */
  verifyHandshake(input: {
    challenge: string | undefined;
    mode: string | undefined;
    token: string | undefined;
  }): string {
    if (!this.webhook) throw new NotFoundException();
    if (
      input.mode !== "subscribe" ||
      !input.challenge ||
      !input.token ||
      !sameText(input.token, this.webhook.verifyToken)
    ) {
      throw new ForbiddenException();
    }
    return input.challenge;
  }

  /**
   * Delivery statuses and "BAJA" replies. The signature of the exact bytes is checked
   * first; every notification is recorded once; an unfinished one is retried when Meta
   * sends it again.
   */
  async handleWebhook(input: {
    rawBody: Buffer | undefined;
    signature: string | undefined;
  }): Promise<{ received: number }> {
    if (!this.webhook) throw new NotFoundException();
    if (
      !input.rawBody ||
      !verifyWebhookBody({
        header: input.signature,
        rawBody: input.rawBody,
        secret: this.webhook.appSecret
      })
    ) {
      throw new UnauthorizedException({
        error: {
          code: "WEBHOOK_SIGNATURE_INVALID",
          message: "La firma de la notificación no es válida."
        }
      });
    }
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      return { received: 0 };
    }
    const events = parseWhatsappWebhook(body).slice(0, 200);
    for (const event of events) {
      const claim = await this.repository.claimWebhookEvent({
        eventKey: event.eventKey,
        topic: event.kind
      });
      if (claim === "duplicate") continue;
      let outcome: MessagingWebhookOutcome;
      if (event.kind === "status") {
        outcome = await this.repository.recordDelivery({
          error: event.error,
          phoneNumberId: event.phoneNumberId,
          providerMessageId: event.providerMessageId,
          status: event.status
        });
      } else if (isOptOutText(event.text)) {
        outcome = await this.repository.recordOptOut({
          phone: event.from,
          phoneNumberId: event.phoneNumberId
        });
      } else {
        outcome = "ignored";
      }
      await this.repository.finishWebhookEvent({
        eventKey: event.eventKey,
        outcome
      });
    }
    return { received: events.length };
  }

  private staff(context: StaffRequestContext): {
    scope: TenantScope;
    staffId: string;
  } {
    return { scope: context.scope, staffId: context.staffId };
  }
}
