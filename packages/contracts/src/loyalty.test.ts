import { describe, expect, it } from "vitest";

import {
  parseDinerLoyaltyView,
  parseLoyaltySettings,
  parseRedeemRewardRequest,
  parseRedeemRewardResult,
  parseReserveRewardRequest,
  parseSaveDinerBirthdayRequest,
  parseSessionRewards
} from "./loyalty.js";

const id = "3e000000-0000-4000-8000-000000000001";
const other = "3e000000-0000-4000-8000-000000000002";

const settings = {
  birthdayMaxChanges: 1,
  birthdayMinAgeDays: 30,
  enabled: true,
  minSessionMinutes: 0,
  minSpendCents: 5000,
  reservationMinutes: 30,
  rewardKind: "percent",
  rewardValidDays: 90,
  rewardValue: 1000,
  visitsGoal: 5
};

describe("loyalty settings", () => {
  it("accepts the program a manager configures", () => {
    expect(parseLoyaltySettings(settings)).toEqual(settings);
  });

  it("rejects unknown fields, bad ranges and a percent above 100", () => {
    expect(parseLoyaltySettings({ ...settings, tenantId: id })).toBeNull();
    expect(parseLoyaltySettings({ ...settings, visitsGoal: 0 })).toBeNull();
    expect(parseLoyaltySettings({ ...settings, visitsGoal: 51 })).toBeNull();
    expect(
      parseLoyaltySettings({ ...settings, rewardValue: 10_001 })
    ).toBeNull();
    expect(
      parseLoyaltySettings({
        ...settings,
        rewardKind: "amount",
        rewardValue: 10_001
      })
    ).not.toBeNull();
    expect(parseLoyaltySettings({ ...settings, enabled: "yes" })).toBeNull();
    expect(parseLoyaltySettings({ ...settings, rewardKind: "free" })).toBeNull();
  });
});

describe("diner requests", () => {
  it("takes only month and day for the birthday", () => {
    expect(parseSaveDinerBirthdayRequest({ day: 29, month: 2 })).toEqual({
      day: 29,
      month: 2
    });
    expect(parseSaveDinerBirthdayRequest({ day: 1, month: 13 })).toBeNull();
    expect(
      parseSaveDinerBirthdayRequest({ day: 1, month: 1, year: 1990 })
    ).toBeNull();
  });

  it("never lets the browser name a tenant, an amount or an account", () => {
    expect(
      parseReserveRewardRequest({ rewardId: id, sessionId: other })
    ).toEqual({ rewardId: id, sessionId: other });
    expect(
      parseReserveRewardRequest({
        discountCents: 10_000,
        rewardId: id,
        sessionId: other
      })
    ).toBeNull();
    expect(parseReserveRewardRequest({ rewardId: id })).toBeNull();
  });
});

describe("till requests", () => {
  it("accepts the in-person methods and defaults the tip to zero", () => {
    expect(
      parseRedeemRewardRequest({ commandId: id, method: "cash", rewardId: other })
    ).toEqual({ commandId: id, method: "cash", rewardId: other, tipCents: 0 });
    expect(
      parseRedeemRewardRequest({
        commandId: id,
        method: "mercado_pago",
        rewardId: other
      })
    ).toBeNull();
    expect(
      parseRedeemRewardRequest({
        amountCents: 1,
        commandId: id,
        method: "cash",
        rewardId: other
      })
    ).toBeNull();
  });

  it("reads the redemption outcome, including a released reward", () => {
    expect(
      parseRedeemRewardResult({
        failure: "22023",
        redeemed: false,
        released: true,
        rewardId: id,
        sessionId: other
      })
    ).toEqual({
      failure: "22023",
      redeemed: false,
      released: true,
      rewardId: id,
      sessionId: other
    });
    expect(parseRedeemRewardResult({ redeemed: true })).toBeNull();
  });

  it("reads the rewards held at an account", () => {
    const rewards = [
      {
        discountCents: 2500,
        displayName: "Ana",
        kind: "percent",
        reserveExpiresAt: null,
        rewardId: id,
        value: 1000
      }
    ];
    expect(parseSessionRewards(rewards)).toEqual(rewards);
    expect(parseSessionRewards([{ ...rewards[0], email: "a@b.c" }])).toBeNull();
  });
});

describe("diner view", () => {
  const view = {
    birthday: null,
    enabled: true,
    minSpendCents: 5000,
    progress: 2,
    rewardKind: "percent",
    rewardValue: 1000,
    rewards: [],
    visits: 7,
    visitsGoal: 5
  };

  it("accepts the canonical view and refuses extra fields such as an email", () => {
    expect(parseDinerLoyaltyView(view)).toEqual(view);
    expect(parseDinerLoyaltyView({ ...view, email: "a@b.c" })).toBeNull();
    expect(
      parseDinerLoyaltyView({ ...view, birthday: { day: 1, month: 2 } })
    ).toBeNull();
  });
});
