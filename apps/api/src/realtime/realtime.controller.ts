import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { RealtimeTokenService } from "./realtime-token.service.js";

/**
 * Gives the signed-in staff member a token to listen to the "something changed" channels
 * of their own restaurant. The restaurant, the person and the channels come from the staff
 * session; nothing in the request can widen them.
 */
@Controller("v1/staff/realtime")
@UseGuards(StaffSessionGuard)
export class RealtimeController {
  constructor(
    @Inject(RealtimeTokenService) private readonly tokens: RealtimeTokenService
  ) {}

  @Post("token")
  @HttpCode(HttpStatus.OK)
  async token(@Req() request: Pick<StaffSessionRequest, "staffContext">) {
    const { capabilities, scope, staffId } = request.staffContext;
    return { data: await this.tokens.issue({ capabilities, scope, staffId }) };
  }
}
