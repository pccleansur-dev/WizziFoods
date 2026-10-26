import { describe, expect, it } from "vitest";

import {
  parseDinerConsentRequest,
  parseDinerExport,
  parseDinerProfileView,
  parseDinerSessionLinkRequest,
  parseRedeemDinerLoginRequest,
  parseSaveDinerProfileRequest,
  parseStartDinerLoginRequest
} from "./diner-identity.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(64);
const binding = "A".repeat(43);

describe("save profile request", () => {
  it("trims the name and accepts an E.164 phone or none", () => {
    expect(
      parseSaveDinerProfileRequest({
        displayName: "  Ana ",
        whatsappPhone: "+5491112345678"
      })
    ).toEqual({ displayName: "Ana", whatsappPhone: "+5491112345678" });
    expect(parseSaveDinerProfileRequest({ displayName: "Ana" })).toEqual({
      displayName: "Ana",
      whatsappPhone: null
    });
  });

  it("rejects bad phones, empty names, long names and extra fields", () => {
    expect(
      parseSaveDinerProfileRequest({
        displayName: "Ana",
        whatsappPhone: "1234"
      })
    ).toBeNull();
    expect(parseSaveDinerProfileRequest({ displayName: "  " })).toBeNull();
    expect(
      parseSaveDinerProfileRequest({ displayName: "x".repeat(81) })
    ).toBeNull();
    expect(
      parseSaveDinerProfileRequest({ displayName: "Ana", email: "a@b.c" })
    ).toBeNull();
    expect(
      parseSaveDinerProfileRequest({ displayName: "Ana", tenantId: profileId })
    ).toBeNull();
  });
});

describe("consent request", () => {
  const valid = {
    action: "granted",
    commandId,
    kind: "marketing",
    source: "menu",
    textVersion: 1
  };

  it("accepts the two kinds, both actions and the two origins", () => {
    expect(parseDinerConsentRequest(valid)).toEqual(valid);
    expect(
      parseDinerConsentRequest({
        ...valid,
        action: "revoked",
        kind: "whatsapp_verified",
        source: "profile"
      })
    ).not.toBeNull();
  });

  it("rejects unknown kinds, the anonymization origin and bad versions", () => {
    expect(parseDinerConsentRequest({ ...valid, kind: "sms" })).toBeNull();
    expect(
      parseDinerConsentRequest({ ...valid, source: "anonymization" })
    ).toBeNull();
    expect(parseDinerConsentRequest({ ...valid, textVersion: 0 })).toBeNull();
    expect(parseDinerConsentRequest({ ...valid, textVersion: 1.5 })).toBeNull();
    expect(parseDinerConsentRequest({ ...valid, commandId: "x" })).toBeNull();
    expect(
      parseDinerConsentRequest({ ...valid, tenantId: profileId })
    ).toBeNull();
  });
});

describe("login and link requests", () => {
  it("accepts a local return path and a binding hash", () => {
    expect(
      parseStartDinerLoginRequest({
        bindingHash: token,
        returnPath: "/m/" + token
      })
    ).toEqual({ bindingHash: token, returnPath: "/m/" + token });
  });

  it("rejects return paths that could leave the restaurant host", () => {
    for (const returnPath of [
      "//evil.test",
      "https://evil.test",
      "/\\evil.test",
      "m/abc",
      "/a\nb",
      "/" + "x".repeat(300)
    ]) {
      expect(
        parseStartDinerLoginRequest({ bindingHash: token, returnPath })
      ).toBeNull();
    }
    expect(
      parseStartDinerLoginRequest({ bindingHash: "zz", returnPath: "/" })
    ).toBeNull();
  });

  it("redeems with a code and the binding, nothing else", () => {
    expect(parseRedeemDinerLoginRequest({ binding, code: binding })).toEqual({
      binding,
      code: binding
    });
    expect(parseRedeemDinerLoginRequest({ binding, code: "short" })).toBeNull();
    expect(
      parseRedeemDinerLoginRequest({ binding, code: binding, extra: 1 })
    ).toBeNull();
  });

  it("links with a QR token only", () => {
    expect(parseDinerSessionLinkRequest({ token })).toEqual({ token });
    expect(parseDinerSessionLinkRequest({ token: "nope" })).toBeNull();
    expect(
      parseDinerSessionLinkRequest({ token, sessionId: profileId })
    ).toBeNull();
  });
});

describe("responses", () => {
  const consents = {
    marketing: { at: null, granted: false, textVersion: null },
    whatsapp_verified: { at: null, granted: false, textVersion: null }
  };
  const texts = [{ body: "x".repeat(30), kind: "marketing", version: 1 }];

  it("parses a profile view with or without profile", () => {
    expect(parseDinerProfileView({ profile: null, texts })).toEqual({
      profile: null,
      texts
    });
    const profile = {
      consents,
      displayName: "Ana",
      profileId,
      whatsappPhone: null
    };
    expect(
      parseDinerProfileView({ profile, texts })?.profile?.displayName
    ).toBe("Ana");
  });

  it("refuses a profile view that leaks extra fields", () => {
    const profile = {
      accountId: profileId,
      consents,
      displayName: "Ana",
      profileId,
      whatsappPhone: null
    };
    expect(parseDinerProfileView({ profile, texts })).toBeNull();
  });

  it("parses the export", () => {
    expect(
      parseDinerExport({
        account: { createdAt: "2026-10-28T10:00:00Z", email: "a@b.co" },
        restaurants: []
      })
    ).not.toBeNull();
    expect(parseDinerExport({ restaurants: [] })).toBeNull();
  });
});
