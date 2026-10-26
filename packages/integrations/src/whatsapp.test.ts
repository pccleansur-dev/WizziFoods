import { describe, expect, it } from "vitest";

import {
  MetaWhatsappProvider,
  SimulatedWhatsappProvider,
  isOptOutText,
  parseWhatsappWebhook,
  signWebhookBody,
  verifyWebhookBody
} from "./index.js";

const input = {
  accessToken: "EAAG-token-that-must-not-leak",
  language: "es_AR",
  phoneNumberId: "10000000001",
  templateName: "premio_ganado",
  to: "+5491122220001",
  variables: ["Ana", "10%"]
};

function answer(status: number, body: unknown) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status
      })
    );
}

describe("simulated provider", () => {
  it("is refused in production", () => {
    expect(() => new SimulatedWhatsappProvider("production")).toThrow(
      "not allowed in production"
    );
  });

  it("records what it sends and fails on demand", async () => {
    const provider = new SimulatedWhatsappProvider();
    provider.failNext("transient_failure", 2);
    expect((await provider.sendTemplate(input)).status).toBe(
      "transient_failure"
    );
    expect((await provider.sendTemplate(input)).status).toBe(
      "transient_failure"
    );
    expect(await provider.sendTemplate(input)).toMatchObject({
      status: "sent"
    });
    expect(provider.sent).toHaveLength(1);
    expect(
      (await provider.listTemplates({ accessToken: "x", wabaId: "1" })).length
    ).toBeGreaterThan(0);
  });
});

describe("Meta provider", () => {
  it("sends the template with the bearer token and no plus sign", async () => {
    let seen: {
      body: Record<string, unknown>;
      headers: Headers;
      url: string;
    } | null = null;
    const provider = new MetaWhatsappProvider({
      fetch: (url, init) => {
        seen = {
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          headers: new Headers(init.headers),
          url
        };
        return answer(200, { messages: [{ id: "wamid.XYZ" }] })();
      }
    });
    await expect(provider.sendTemplate(input)).resolves.toEqual({
      providerMessageId: "wamid.XYZ",
      status: "sent"
    });
    expect(seen!.url).toBe(
      "https://graph.facebook.com/v21.0/10000000001/messages"
    );
    expect(seen!.headers.get("authorization")).toBe(
      `Bearer ${input.accessToken}`
    );
    expect(seen!.body.to).toBe("5491122220001");
  });

  it("tells a temporary failure from a permanent one, and never echoes the token", async () => {
    const make = (status: number, body: unknown) =>
      new MetaWhatsappProvider({ fetch: answer(status, body) });
    await expect(
      make(500, {
        error: { code: 2, message: "Service temporarily unavailable" }
      }).sendTemplate(input)
    ).resolves.toMatchObject({ status: "transient_failure" });
    await expect(
      make(429, {
        error: { code: 130429, message: "Rate limit" }
      }).sendTemplate(input)
    ).resolves.toMatchObject({ status: "transient_failure" });
    await expect(
      make(400, {
        error: { code: 131026, message: "Message undeliverable" }
      }).sendTemplate(input)
    ).resolves.toMatchObject({
      error: "131026: Message undeliverable",
      status: "permanent_failure"
    });
    const offline = new MetaWhatsappProvider({
      fetch: () => Promise.reject(new Error(`boom ${input.accessToken}`))
    });
    const result = await offline.sendTemplate(input);
    expect(result).toEqual({
      error: "network_error",
      status: "transient_failure"
    });
  });

  it("maps the templates of the account and follows only Meta's own pager", async () => {
    const calls: string[] = [];
    const provider = new MetaWhatsappProvider({
      fetch: (url) => {
        calls.push(url);
        return answer(200, {
          data: [
            {
              category: "MARKETING",
              components: [{ text: "Hola {{1}}", type: "BODY" }],
              language: "es_AR",
              name: "promo_semana",
              status: "APPROVED"
            },
            {
              category: "UTILITY",
              components: [{ text: "Tu premio", type: "BODY" }],
              language: "es_AR",
              name: "premio_ganado",
              status: "REJECTED"
            }
          ],
          paging: { next: "https://evil.example.com/steal" }
        })();
      }
    });
    await expect(
      provider.listTemplates({ accessToken: "t", wabaId: "20000000001" })
    ).resolves.toEqual([
      {
        body: "Hola {{1}}",
        category: "promotional",
        language: "es_AR",
        name: "promo_semana",
        status: "approved"
      },
      {
        body: "Tu premio",
        category: "operational",
        language: "es_AR",
        name: "premio_ganado",
        status: "rejected"
      }
    ]);
    expect(calls).toHaveLength(1);
  });
});

describe("webhook", () => {
  const secret = "an-app-secret-of-16+";
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: "5491122220001",
                  id: "wamid.IN1",
                  text: { body: " Baja. " },
                  type: "text"
                },
                {
                  from: "bad",
                  id: "wamid.IN2",
                  text: { body: "BAJA" },
                  type: "text"
                }
              ],
              metadata: { phone_number_id: "10000000001" },
              statuses: [
                { id: "wamid.OUT1", status: "delivered" },
                {
                  id: "wamid.OUT2",
                  status: "failed",
                  errors: [{ code: 131026, title: "Undeliverable" }]
                },
                { id: "wamid.OUT3", status: "sent" }
              ]
            }
          }
        ]
      }
    ],
    object: "whatsapp_business_account"
  });

  it("checks the signature of the exact bytes", () => {
    const header = signWebhookBody(secret, body);
    expect(verifyWebhookBody({ header, rawBody: body, secret })).toBe(true);
    expect(verifyWebhookBody({ header, rawBody: body + " ", secret })).toBe(
      false
    );
    expect(
      verifyWebhookBody({
        header,
        rawBody: body,
        secret: "other-secret-16-chars"
      })
    ).toBe(false);
    expect(
      verifyWebhookBody({ header: "sha256=zz", rawBody: body, secret })
    ).toBe(false);
    expect(
      verifyWebhookBody({ header: undefined, rawBody: body, secret })
    ).toBe(false);
  });

  it("reads statuses and inbound messages, dropping what it does not understand", () => {
    const events = parseWhatsappWebhook(JSON.parse(body));
    expect(events.map((event) => event.eventKey)).toEqual([
      "status:wamid.OUT1:delivered",
      "status:wamid.OUT2:failed",
      "message:wamid.IN1"
    ]);
    expect(events[1]).toMatchObject({ error: "131026: Undeliverable" });
    expect(events[2]).toMatchObject({
      from: "+5491122220001",
      kind: "message"
    });
    expect(parseWhatsappWebhook({ object: "page" })).toEqual([]);
    expect(parseWhatsappWebhook("nope")).toEqual([]);
  });

  it("recognizes BAJA however it is written", () => {
    for (const text of ["BAJA", " baja ", "Baja.", "¡BAJA!", "stop"]) {
      expect(isOptOutText(text)).toBe(true);
    }
    for (const text of ["no quiero la baja de nadie", "hola", ""]) {
      expect(isOptOutText(text)).toBe(false);
    }
  });
});
