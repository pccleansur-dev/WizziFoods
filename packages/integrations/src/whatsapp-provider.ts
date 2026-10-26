import type { ProviderTemplate } from "@platform/contracts";

export type SendTemplateInput = {
  accessToken: string;
  language: string;
  phoneNumberId: string;
  /** E.164 with the leading "+". */
  to: string;
  templateName: string;
  variables: string[];
};

/**
 * "transient_failure" may be tried again later; "permanent_failure" never will be
 * (a rejected number, a closed template, a revoked token).
 */
export type SendTemplateResult =
  | { providerMessageId: string; status: "sent" }
  | { error: string; status: "permanent_failure" | "transient_failure" };

export type ListTemplatesInput = { accessToken: string; wabaId: string };

/** What the platform needs from WhatsApp, and nothing else. */
export interface WhatsappProvider {
  listTemplates(input: ListTemplatesInput): Promise<ProviderTemplate[]>;
  sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult>;
}
