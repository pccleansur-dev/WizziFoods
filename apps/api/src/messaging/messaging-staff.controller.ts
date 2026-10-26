import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  isWaiterUuid,
  parseConnectWhatsappRequest,
  parseDecideAutomationRequest,
  parseDecideOneOffRequest,
  parseProposeOneOffRequest,
  parseSaveAutomationRequest,
  parseSavePushTemplateRequest,
  parseSetSendingRequest,
  parseSetTemplateCostRequest
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { mapMessagingFailure } from "./messaging-errors.js";
import { MessagingService } from "./messaging.service.js";

type MessagingRequest = Pick<StaffSessionRequest, "staffContext">;

function invalid(): BadRequestException {
  return new BadRequestException({
    error: { code: "INVALID_MESSAGING_REQUEST", message: "Revisá los datos." }
  });
}

/** Messaging is the Encargado's: the same capability that approves operations. */
function manager(request: MessagingRequest): MessagingRequest["staffContext"] {
  if (!request.staffContext.capabilities.includes("operations.approve")) {
    throw new ForbiddenException({
      error: {
        code: "STAFF_FORBIDDEN",
        message: "Tu rol no puede realizar esta operación."
      }
    });
  }
  return request.staffContext;
}

@Controller("v1/staff/messaging")
@UseGuards(StaffSessionGuard)
export class MessagingStaffController {
  constructor(
    @Inject(MessagingService) private readonly service: MessagingService
  ) {}

  @Get()
  async overview(@Req() request: MessagingRequest) {
    const context = manager(request);
    try {
      return { data: await this.service.getOverview(context) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Get("events")
  async events(
    @Req() request: MessagingRequest,
    @Query("limit") limit?: string
  ) {
    const context = manager(request);
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      throw invalid();
    }
    try {
      return { data: await this.service.listEvents(context, parsed) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Get("audience")
  async audience(@Req() request: MessagingRequest) {
    const context = manager(request);
    try {
      return { data: await this.service.listAudience(context) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  /** The token travels in this body once; it is sealed and never comes back. */
  @Put("connection")
  async connect(@Req() request: MessagingRequest, @Body() body: unknown) {
    const context = manager(request);
    const parsed = parseConnectWhatsappRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.connect(context, parsed) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Delete("connection")
  async disconnect(@Req() request: MessagingRequest) {
    const context = manager(request);
    try {
      return { data: await this.service.disconnect(context) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Put("sending")
  async sending(@Req() request: MessagingRequest, @Body() body: unknown) {
    const context = manager(request);
    const parsed = parseSetSendingRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.setSending(context, parsed.enabled)
      };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  /** Notifications of the PWA: a switch of their own, off by default. */
  @Put("push/sending")
  async pushSending(@Req() request: MessagingRequest, @Body() body: unknown) {
    const context = manager(request);
    const parsed = parseSetSendingRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.setPushSending(context, parsed.enabled)
      };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  /** The restaurant writes its own push messages: no Meta approval involved. */
  @Put("push/templates")
  async pushTemplate(@Req() request: MessagingRequest, @Body() body: unknown) {
    const context = manager(request);
    const parsed = parseSavePushTemplateRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.savePushTemplate(context, parsed) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Post("templates/sync")
  @HttpCode(HttpStatus.OK)
  async sync(@Req() request: MessagingRequest) {
    const context = manager(request);
    try {
      return { data: await this.service.syncTemplates(context) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Put("templates/:templateId/cost")
  async templateCost(
    @Req() request: MessagingRequest,
    @Param("templateId") templateId: string,
    @Body() body: unknown
  ) {
    const context = manager(request);
    const parsed = parseSetTemplateCostRequest(body);
    if (!parsed || !isWaiterUuid(templateId)) throw invalid();
    try {
      return {
        data: await this.service.setTemplateCost(
          context,
          templateId,
          parsed.estimatedCostCents
        )
      };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Put("automations")
  async saveAutomation(
    @Req() request: MessagingRequest,
    @Body() body: unknown
  ) {
    const context = manager(request);
    const parsed = parseSaveAutomationRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.saveAutomation(context, parsed) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  /** Approving is deliberate: the automation runs by itself only after this. */
  @Post("automations/:automationId/decision")
  @HttpCode(HttpStatus.OK)
  async decideAutomation(
    @Req() request: MessagingRequest,
    @Param("automationId") automationId: string,
    @Body() body: unknown
  ) {
    const context = manager(request);
    const parsed = parseDecideAutomationRequest(body);
    if (!parsed || !isWaiterUuid(automationId)) throw invalid();
    try {
      return {
        data: await this.service.decideAutomation(context, automationId, parsed)
      };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  /** A one-off event is only proposed here; nothing is sent until it is confirmed. */
  @Post("one-off-events")
  @HttpCode(HttpStatus.OK)
  async propose(@Req() request: MessagingRequest, @Body() body: unknown) {
    const context = manager(request);
    const parsed = parseProposeOneOffRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.proposeOneOff(context, parsed) };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }

  @Post("one-off-events/:batchId/decision")
  @HttpCode(HttpStatus.OK)
  async decideOneOff(
    @Req() request: MessagingRequest,
    @Param("batchId") batchId: string,
    @Body() body: unknown
  ) {
    const context = manager(request);
    const parsed = parseDecideOneOffRequest(body);
    if (!parsed || !isWaiterUuid(batchId)) throw invalid();
    try {
      return {
        data: await this.service.decideOneOff(context, batchId, parsed)
      };
    } catch (error) {
      return mapMessagingFailure(error);
    }
  }
}
