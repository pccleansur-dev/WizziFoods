import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { LoyaltyDinerController } from "./loyalty-diner.controller.js";
import { LoyaltyStaffController } from "./loyalty-staff.controller.js";

const tenantId = "3e000000-0000-4000-8000-000000000001";
const locationId = "3e000000-0000-4000-8000-000000000002";
const accountId = "3e000000-0000-4000-8000-000000000003";
const rewardId = "3e000000-0000-4000-8000-000000000004";
const sessionId = "3e000000-0000-4000-8000-000000000005";
const commandId = "3e000000-0000-4000-8000-000000000006";
const authorization = `Bearer ${"T".repeat(43)}`;
const hostRequest = {
  tenantHostContext: {
    location: { id: locationId },
    tenant: { id: tenantId }
  }
} as never;

function dbError(code: string) {
  return Object.assign(new Error("db"), { code });
}

function dinerControllers() {
  const diners = { authenticate: vi.fn().mockResolvedValue(accountId) };
  const loyalty = {
    getDinerLoyalty: vi.fn().mockResolvedValue({ rewards: [] }),
    releaseReward: vi.fn().mockResolvedValue({ released: true, rewardId }),
    reserveReward: vi.fn().mockResolvedValue({ rewardId }),
    saveBirthday: vi.fn().mockResolvedValue({ day: 1, month: 1, changes: 0 })
  };
  return {
    controller: new LoyaltyDinerController(diners as never, loyalty as never),
    diners,
    loyalty
  };
}

describe("LoyaltyDinerController", () => {
  it("takes the account from the session and the restaurant from the host", async () => {
    const { controller, diners, loyalty } = dinerControllers();
    await controller.view(hostRequest, authorization);
    expect(diners.authenticate).toHaveBeenCalledWith(tenantId, "T".repeat(43));
    expect(loyalty.getDinerLoyalty).toHaveBeenCalledWith(
      { locationId, tenantId },
      accountId
    );
  });

  it("refuses a body that tries to name an amount or an account before touching the session", async () => {
    const { controller, diners } = dinerControllers();
    await expect(
      controller.reserve(hostRequest, authorization, {
        accountId,
        discountCents: 1,
        rewardId,
        sessionId
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.birthday(hostRequest, authorization, { day: 40, month: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(diners.authenticate).not.toHaveBeenCalled();
  });

  it("answers a diner without a session with 401 and never reaches loyalty", async () => {
    const { controller, diners, loyalty } = dinerControllers();
    diners.authenticate.mockRejectedValue(dbError("PT281"));
    await expect(
      controller.view(hostRequest, undefined)
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(loyalty.getDinerLoyalty).not.toHaveBeenCalled();
  });

  it("maps a reward that is gone and the birthday limits to readable conflicts", async () => {
    const { controller, loyalty } = dinerControllers();
    loyalty.reserveReward.mockRejectedValue(dbError("PT290"));
    await expect(
      controller.reserve(hostRequest, authorization, { rewardId, sessionId })
    ).rejects.toMatchObject({
      response: { error: { code: "REWARD_UNAVAILABLE" } }
    });
    loyalty.saveBirthday.mockRejectedValue(dbError("PT289"));
    await expect(
      controller.birthday(hostRequest, authorization, { day: 1, month: 1 })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function staff(capabilities: string[]) {
  return {
    staffContext: {
      capabilities,
      role: "waiter",
      scope: { locationId, tenantId },
      staffId: "staff"
    }
  } as never;
}

const settings = {
  birthdayMaxChanges: 1,
  birthdayMinAgeDays: 30,
  enabled: true,
  minSessionMinutes: 0,
  minSpendCents: 0,
  reservationMinutes: 30,
  rewardKind: "percent",
  rewardValidDays: 90,
  rewardValue: 1000,
  visitsGoal: 5
};

describe("LoyaltyStaffController", () => {
  function controller() {
    const service = {
      getSessionRewards: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue(settings),
      redeemReward: vi.fn().mockResolvedValue({ redeemed: true }),
      saveSettings: vi.fn().mockResolvedValue(settings)
    };
    return { controller: new LoyaltyStaffController(service as never), service };
  }

  it("only the manager reads and changes the program", async () => {
    const { controller: c } = controller();
    await expect(
      c.settings(staff(["payments.collect"]))
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      c.saveSettings(staff(["payments.collect"]), settings)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      c.saveSettings(staff(["operations.approve"]), settings)
    ).resolves.toEqual({ data: settings });
  });

  it("the till redeems with payment from the session context only", async () => {
    const { controller: c, service } = controller();
    const context = staff(["payments.collect"]);
    await c.redeem(context, sessionId, {
      commandId,
      method: "cash",
      rewardId
    });
    expect(service.redeemReward).toHaveBeenCalledWith(
      (context as never as { staffContext: unknown }).staffContext,
      sessionId,
      { commandId, method: "cash", rewardId, tipCents: 0 }
    );
    await expect(
      c.redeem(context, sessionId, {
        amountCents: 1,
        commandId,
        method: "cash",
        rewardId
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      c.redeem(staff(["production.kitchen.manage"]), sessionId, {
        commandId,
        method: "cash",
        rewardId
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a reward that was taken is a conflict, not a server error", async () => {
    const { controller: c, service } = controller();
    service.redeemReward.mockRejectedValue(dbError("PT290"));
    await expect(
      c.redeem(staff(["payments.collect"]), sessionId, {
        commandId,
        method: "cash",
        rewardId
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
