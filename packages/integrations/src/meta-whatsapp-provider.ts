import {
  parseProviderTemplates,
  type ProviderTemplate
} from "@platform/contracts";

import type {
  ListTemplatesInput,
  SendTemplateInput,
  SendTemplateResult,
  WhatsappProvider
} from "./whatsapp-provider.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type MetaWhatsappOptions = {
  fetch?: FetchLike;
  graphVersion?: string;
  timeoutMs?: number;
};

/** Meta error codes that mean "try again later" rather than "this will never work". */
const transientCodes = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131056]);

function categoryOf(value: unknown): ProviderTemplate["category"] {
  return value === "MARKETING" ? "promotional" : "operational";
}

function statusOf(value: unknown): ProviderTemplate["status"] {
  if (value === "APPROVED") return "approved";
  if (value === "PENDING" || value === "IN_APPEAL") return "pending";
  return "rejected";
}

/** The WhatsApp Cloud API of Meta. The token is only ever used as a bearer header. */
export class MetaWhatsappProvider implements WhatsappProvider {
  private readonly fetcher: FetchLike;
  private readonly version: string;
  private readonly timeoutMs: number;

  constructor(options: MetaWhatsappOptions = {}) {
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.version = options.graphVersion ?? "v21.0";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!/^v\d+\.\d+$/u.test(this.version)) {
      throw new Error("graph version must look like v21.0");
    }
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://graph.facebook.com/${this.version}/${encodeURIComponent(input.phoneNumberId)}/messages`,
        {
          body: JSON.stringify({
            messaging_product: "whatsapp",
            template: {
              components:
                input.variables.length > 0
                  ? [
                      {
                        parameters: input.variables.map((text) => ({
                          text,
                          type: "text"
                        })),
                        type: "body"
                      }
                    ]
                  : [],
              language: { code: input.language },
              name: input.templateName
            },
            to: input.to.replace(/^\+/u, ""),
            type: "template"
          }),
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            "content-type": "application/json"
          },
          method: "POST",
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      );
    } catch {
      // No answer at all: the network or the timeout, never the token.
      return { error: "network_error", status: "transient_failure" };
    }
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: number; message?: string };
      messages?: Array<{ id?: string }>;
    } | null;
    const id = body?.messages?.[0]?.id;
    if (response.ok && typeof id === "string" && id.length > 0) {
      return { providerMessageId: id, status: "sent" };
    }
    const code = body?.error?.code;
    const message = String(body?.error?.message ?? response.statusText).slice(
      0,
      200
    );
    const transient =
      response.status === 429 ||
      response.status >= 500 ||
      (typeof code === "number" && transientCodes.has(code));
    return {
      error: `${code ?? response.status}: ${message}`,
      status: transient ? "transient_failure" : "permanent_failure"
    };
  }

  async listTemplates(input: ListTemplatesInput): Promise<ProviderTemplate[]> {
    const found: ProviderTemplate[] = [];
    let url: string | null =
      `https://graph.facebook.com/${this.version}/${encodeURIComponent(input.wabaId)}/message_templates?fields=name,language,category,status,components&limit=100`;
    for (let page = 0; url && page < 5; page += 1) {
      const response: Response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${input.accessToken}` },
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) {
        throw new Error(`templates request failed (${response.status})`);
      }
      const body = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
        paging?: { next?: string };
      };
      for (const entry of body.data ?? []) {
        const components = Array.isArray(entry.components)
          ? (entry.components as Array<Record<string, unknown>>)
          : [];
        const bodyText = components.find((part) => part.type === "BODY")?.text;
        if (typeof bodyText !== "string" || bodyText.length === 0) continue;
        found.push({
          body: bodyText.slice(0, 1024),
          category: categoryOf(entry.category),
          language: String(entry.language),
          name: String(entry.name),
          status: statusOf(entry.status)
        });
      }
      const next: string | undefined = body.paging?.next;
      // Only follow the pager inside Meta's own host.
      url = next?.startsWith("https://graph.facebook.com/") ? next : null;
    }
    const parsed = parseProviderTemplates(found);
    if (!parsed) {
      throw new Error("the provider returned templates we cannot read");
    }
    return parsed;
  }
}
