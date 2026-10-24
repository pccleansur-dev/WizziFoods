import { describe, expect, it } from "vitest";

import {
  parseTeamMember,
  parseTeamMemberActivation,
  parseTeamMemberCreate,
  parseTeamMemberUpdate,
  parseTeamPinReset
} from "./team.js";

const sector = "f1000000-0000-4000-8000-000000000001";
const valid = {
  displayName: "Ana Pérez",
  pin: "123456",
  role: "waiter",
  sectorIds: [sector],
  username: "ana.perez"
};

describe("team member contracts", () => {
  it("accepts a canonical creation request", () => {
    expect(parseTeamMemberCreate(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([
    ["tenantId", { ...valid, tenantId: sector }],
    ["locationId", { ...valid, locationId: sector }],
    ["unknown", { ...valid, isActive: true }]
  ])("rejects an injected %s", (_name, body) => {
    const result = parseTeamMemberCreate(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "UNKNOWN_FIELD")).toBe(
        true
      );
    }
  });

  it.each([
    ["short pin", { ...valid, pin: "12345" }],
    ["alphabetic pin", { ...valid, pin: "12345a" }],
    ["numeric pin", { ...valid, pin: 123456 }],
    ["uppercase username", { ...valid, username: "Ana" }],
    ["short username", { ...valid, username: "an" }],
    ["unknown role", { ...valid, role: "owner" }],
    ["blank name", { ...valid, displayName: " " }],
    ["control char", { ...valid, displayName: "Ana\u0000" }],
    ["sector for kitchen", { ...valid, role: "kitchen" }],
    ["repeated sector", { ...valid, sectorIds: [sector, sector] }],
    ["bad sector", { ...valid, sectorIds: ["x"] }],
    ["array body", []],
    ["null body", null]
  ])("rejects %s", (_name, body) => {
    expect(parseTeamMemberCreate(body).ok).toBe(false);
  });

  it("never echoes the PIN in an issue", () => {
    const result = parseTeamMemberCreate({ ...valid, pin: "9999x9" });
    expect(JSON.stringify(result)).not.toContain("9999x9");
  });

  it("validates updates, activation and PIN reset strictly", () => {
    expect(
      parseTeamMemberUpdate({ displayName: "Ana", role: "kitchen", sectorIds: [] })
        .ok
    ).toBe(true);
    expect(
      parseTeamMemberUpdate({
        displayName: "Ana",
        role: "manager",
        sectorIds: [sector]
      }).ok
    ).toBe(false);
    expect(parseTeamMemberUpdate({ ...valid }).ok).toBe(false);
    expect(parseTeamMemberActivation({ active: false }).ok).toBe(true);
    expect(parseTeamMemberActivation({ active: "no" }).ok).toBe(false);
    expect(parseTeamPinReset({ pin: "000000" }).ok).toBe(true);
    expect(parseTeamPinReset({ pin: "000000", extra: 1 }).ok).toBe(false);
  });

  it("rejects database rows that carry credential fields", () => {
    const row = {
      createdAt: "2026-10-24T00:00:00Z",
      displayName: "Ana",
      id: sector,
      isActive: true,
      role: "waiter",
      sectorIds: [],
      username: "ana"
    };
    expect(parseTeamMember(row)).toEqual(row);
    expect(parseTeamMember({ ...row, pinHash: "scrypt-v1$x$y" })).toBeNull();
  });
});
