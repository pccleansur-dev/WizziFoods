import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parseClaimShareRequest,
  parseDinerSplitTarget,
  parseReleaseShareRequest
} from "@platform/contracts";
import type { SplitClaimsRepository } from "@platform/database";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";

export const SPLIT_CLAIMS = Symbol("SPLIT_CLAIMS");

type PublicRequest = Pick<TenantHostRequest, "tenantHostContext">;

function scopeOf(request: PublicRequest) {
  return {
    locationId: request.tenantHostContext.location.id,
    tenantId: request.tenantHostContext.tenant.id
  };
}

function invalid(): BadRequestException {
  return new BadRequestException({
    error: { code: "INVALID_SPLIT_REQUEST", message: "Revisá los datos." }
  });
}

function mapFailure(error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  if (code === "PT201") {
    throw new NotFoundException({
      error: {
        code: "SPLIT_NOT_FOUND",
        message: "Esta mesa no tiene una cuenta dividida."
      }
    });
  }
  if (code === "PT260") {
    throw new ConflictException({
      error: {
        code: "SPLIT_SHARE_UNAVAILABLE",
        message: "Esa parte ya la tomó otra persona o la cuenta cambió."
      }
    });
  }
  if (code === "PT212") throw invalid();
  throw error;
}

/**
 * The diner's side of a split: see the shares of the table, reserve one with a name,
 * or give it back. The table comes from the QR token, the business from the host and
 * the phone from a secret only it holds.
 */
@Controller("v1/public/account-splits")
@UseGuards(TenantHostGuard)
export class SplitClaimsController {
  constructor(
    @Inject(SPLIT_CLAIMS) private readonly claims: SplitClaimsRepository
  ) {}

  @Post("view")
  @HttpCode(HttpStatus.OK)
  async view(@Req() request: PublicRequest, @Body() body: unknown) {
    const parsed = parseDinerSplitTarget(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.claims.view({ ...parsed, scope: scopeOf(request) })
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("claim")
  @HttpCode(HttpStatus.OK)
  async claim(@Req() request: PublicRequest, @Body() body: unknown) {
    const parsed = parseClaimShareRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.claims.claim({ ...parsed, scope: scopeOf(request) })
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("release")
  @HttpCode(HttpStatus.OK)
  async release(@Req() request: PublicRequest, @Body() body: unknown) {
    const parsed = parseReleaseShareRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.claims.release({ ...parsed, scope: scopeOf(request) })
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
