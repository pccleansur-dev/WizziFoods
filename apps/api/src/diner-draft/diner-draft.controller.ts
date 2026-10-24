import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { parseDinerDraftRequest } from "@platform/contracts";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { DinerDraftService } from "./diner-draft.service.js";

const tokenPattern = /^[0-9a-f]{64}$/u;

function hasDraftEnvelope(body: unknown): body is {
  items: unknown;
  token: unknown;
} {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).sort().join() === "items,token"
  );
}

@Controller("v1/public/drafts/recalculate")
@UseGuards(TenantHostGuard)
export class DinerDraftController {
  constructor(
    @Inject(DinerDraftService) private readonly service: DinerDraftService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async recalculate(
    @Req() request: Pick<TenantHostRequest, "tenantHostContext">,
    @Body() body: unknown
  ) {
    if (!hasDraftEnvelope(body)) {
      throw new BadRequestException({
        error: { code: "INVALID_DINER_DRAFT", message: "Pedido inválido." }
      });
    }
    if (typeof body.token !== "string" || !tokenPattern.test(body.token)) {
      return { data: { status: "invalid" } };
    }
    const parsed = parseDinerDraftRequest(body);
    if (!parsed) {
      throw new BadRequestException({
        error: { code: "INVALID_DINER_DRAFT", message: "Pedido inválido." }
      });
    }
    return {
      data: await this.service.recalculate(request.tenantHostContext, parsed)
    };
  }
}
