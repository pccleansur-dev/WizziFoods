import { describe, expect, it } from "vitest";

import {
  parseBeginSendResult,
  parseConnectWhatsappRequest,
  parseMessagingOverview,
  parseProposeOneOffRequest,
  parseProviderTemplates,
  parseSetTemplateCostRequest
} from "./messaging.js";

const id = "3d200000-0000-4000-8000-000000000001";

describe("messaging contracts", () => {
  it("accepts a connection request and refuses extra or malformed fields", () => {
    const valid = {
      accessToken: "EAAG" + "x".repeat(40),
      displayPhone: "+5491100000001",
      phoneNumberId: "10000000001",
      wabaId: "20000000001"
    };
    expect(parseConnectWhatsappRequest(valid)).toEqual(valid);
    expect(parseConnectWhatsappRequest({ ...valid, tenantId: id })).toBeNull();
    expect(
      parseConnectWhatsappRequest({ ...valid, phoneNumberId: "abc" })
    ).toBeNull();
    expect(
      parseConnectWhatsappRequest({ ...valid, accessToken: " short" })
    ).toBeNull();
    expect(
      parseConnectWhatsappRequest({ ...valid, displayPhone: "11-2222" })
    ).toBeNull();
  });

  it("limits a one-off event to 200 distinct people and ten variables", () => {
    const request = {
      commandId: id,
      profileIds: [id],
      templateId: id,
      variables: ["Hola"]
    };
    expect(parseProposeOneOffRequest(request)).toEqual(request);
    expect(
      parseProposeOneOffRequest({ ...request, profileIds: [] })
    ).toBeNull();
    expect(
      parseProposeOneOffRequest({ ...request, profileIds: [id, id] })
    ).toBeNull();
    expect(
      parseProposeOneOffRequest({ ...request, variables: Array(11).fill("x") })
    ).toBeNull();
    expect(parseProposeOneOffRequest({ ...request, extra: 1 })).toBeNull();
  });

  it("accepts a cost with up to three decimals and refuses a negative one", () => {
    expect(parseSetTemplateCostRequest({ estimatedCostCents: 4.5 })).toEqual({
      estimatedCostCents: 4.5
    });
    expect(parseSetTemplateCostRequest({ estimatedCostCents: -1 })).toBeNull();
    expect(
      parseSetTemplateCostRequest({ estimatedCostCents: 0.0001 })
    ).toBeNull();
  });

  it("validates what the provider reports about templates", () => {
    const template = {
      body: "Hola {{1}}",
      category: "promotional",
      language: "es_AR",
      name: "promo_semana",
      status: "approved"
    };
    expect(parseProviderTemplates([template])).toEqual([template]);
    expect(
      parseProviderTemplates([{ ...template, name: "Mal Nombre" }])
    ).toBeNull();
    expect(
      parseProviderTemplates([{ ...template, status: "weird" }])
    ).toBeNull();
  });

  it("reads the decision to send only when every field is present", () => {
    expect(parseBeginSendResult({ action: "skip" })).toEqual({
      action: "skip"
    });
    expect(
      parseBeginSendResult({ action: "blocked", reason: "weekly_cap" })
    ).toEqual({
      action: "blocked",
      reason: "weekly_cap"
    });
    expect(parseBeginSendResult({ action: "send", phone: "123" })).toBeNull();
    expect(
      parseBeginSendResult({
        action: "send",
        attempt: 1,
        category: "operational",
        language: "es_AR",
        phone: "+5491122220001",
        phoneNumberId: "10000000001",
        templateName: "premio_ganado",
        variables: ["Ana"]
      })
    ).toMatchObject({ action: "send" });
  });

  it("parses an overview with no connection", () => {
    const overview = parseMessagingOverview({
      automations: [
        {
          approvedAt: null,
          id: null,
          kind: "birthday",
          status: "not_configured",
          templateId: null,
          templateName: null
        }
      ],
      connection: null,
      oneOffEvents: [],
      templates: [],
      usage: { estimatedCostCents: 0, sentThisMonth: 0 }
    });
    expect(overview?.connection).toBeNull();
    expect(parseMessagingOverview({ connection: null })).toBeNull();
  });
});
