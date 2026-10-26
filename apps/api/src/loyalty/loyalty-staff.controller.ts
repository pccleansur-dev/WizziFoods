import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  isWaiterUuid,
  parseLoyaltySettings,
  parseRedeemRewardRequest,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { mapLoyaltyStaffFailure } from "./loyalty-errors.js";
import { LoyaltyService } from "./loyalty.service.js";

type LoyaltyRequest = Pick<StaffSessionRequest, "staffContext">;

function invalid(): BadRequestException {
  return new BadRequestException({
    error: { code: "INVALID_LOYALTY_REQUEST", message: "Revisá los datos." }
  });
}

function needs(
  request: LoyaltyRequest,
  capability: StaffCapability
): LoyaltyRequest["staffContext"] {
  if (!request.staffContext.capabilities.includes(capability)) {
    throw new ForbiddenException({
      error: {
        code: "STAFF_FORBIDDEN",
        message: "Tu rol no puede realizar esta operación."
      }
    });
  }
  return request.staffContext;
}

@Controller("v1/staff")
@UseGuards(StaffSessionGuard)
export class LoyaltyStaffController {
  constructor(
    @Inject(LoyaltyService) private readonly service: LoyaltyService
  ) {}

  /** The manager reads the program: goal, minimum, reward and birthday rules. */
  @Get("loyalty/settings")
  async settings(@Req() request: LoyaltyRequest) {
    const context = needs(request, "operations.approve");
    try {
      return { data: await this.service.getSettings(context) };
    } catch (error) {
      return mapLoyaltyStaffFailure(error);
    }
  }

  @Put("loyalty/settings")
  async saveSettings(@Req() request: LoyaltyRequest, @Body() body: unknown) {
    const context = needs(request, "operations.approve");
    const parsed = parseLoyaltySettings(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.saveSettings(context, parsed) };
    } catch (error) {
      return mapLoyaltyStaffFailure(error);
    }
  }

  /** Rewards a diner is holding for this account, with the discount they would get. */
  @Get("accounts/:sessionId/rewards")
  async rewards(
    @Req() request: LoyaltyRequest,
    @Param("sessionId") sessionId: string
  ) {
    const context = needs(request, "payments.collect");
    if (!isWaiterUuid(sessionId)) throw invalid();
    try {
      return {
        data: await this.service.getSessionRewards(context, sessionId)
      };
    } catch (error) {
      return mapLoyaltyStaffFailure(error);
    }
  }

  /**
   * Discount + payment + redemption in one step. If the payment cannot be recorded,
   * the answer says the reward went back to the diner.
   */
  @Post("accounts/:sessionId/reward-redemptions")
  @HttpCode(HttpStatus.OK)
  async redeem(
    @Req() request: LoyaltyRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "payments.collect");
    const parsed = parseRedeemRewardRequest(body);
    if (!parsed || !isWaiterUuid(sessionId)) throw invalid();
    try {
      return {
        data: await this.service.redeemReward(context, sessionId, parsed)
      };
    } catch (error) {
      return mapLoyaltyStaffFailure(error);
    }
  }
}
