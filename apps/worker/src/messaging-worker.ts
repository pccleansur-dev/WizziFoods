import type { MessagingChannel, TenantScope } from "@platform/contracts";
import type { MessagingRepository } from "@platform/database";
import {
  WHATSAPP_SECRET_METHOD,
  type PaymentSecretSealer,
  type WebPushProvider,
  type WhatsappProvider
} from "@platform/integrations";

export type MessagingIterationSummary = {
  blocked: number;
  deferred: number;
  failed: number;
  retried: number;
  sent: number;
  skipped: number;
};

type Dependencies = {
  leaseSeconds: number;
  limit: number;
  repository: MessagingRepository;
  /** Web Push of the installed PWA; null when this worker does not deliver it. */
  webPush: WebPushProvider | null;
  /** WhatsApp; null when this worker does not deliver it. */
  whatsapp: { provider: WhatsappProvider; sealer: PaymentSecretSealer } | null;
};

type Outcome = {
  error: string | null;
  providerMessageId: string | null;
  status: "permanent_failure" | "sent" | "transient_failure";
};

function scopeKey(scope: TenantScope): string {
  return `${scope.tenantId}:${scope.locationId}`;
}

/**
 * One pass over the due messages of the channels this worker can deliver. The
 * database decides whether each one may leave (`beginSend`); this code only carries out
 * a "send" and reports what happened. A message that already started is never sent
 * twice: if the report is lost, the lease expires and the database closes it as failed.
 */
export async function runMessagingIteration(
  dependencies: Dependencies
): Promise<MessagingIterationSummary> {
  const summary: MessagingIterationSummary = {
    blocked: 0,
    deferred: 0,
    failed: 0,
    retried: 0,
    sent: 0,
    skipped: 0
  };
  const channels: MessagingChannel[] = [];
  if (dependencies.whatsapp) channels.push("whatsapp");
  if (dependencies.webPush) channels.push("web_push");
  if (channels.length === 0) return summary;
  const claimed = await dependencies.repository.claimOutbox({
    channels,
    leaseSeconds: dependencies.leaseSeconds,
    limit: dependencies.limit
  });
  const tokens = new Map<
    string,
    { phoneNumberId: string; token: string } | null
  >();

  async function tokenFor(scope: TenantScope) {
    const key = scopeKey(scope);
    if (tokens.has(key)) return tokens.get(key) ?? null;
    let opened: { phoneNumberId: string; token: string } | null = null;
    try {
      const credentials = await dependencies.repository.readCredentials(scope);
      if (credentials && dependencies.whatsapp) {
        opened = {
          phoneNumberId: credentials.phoneNumberId,
          token: dependencies.whatsapp.sealer.open(
            credentials.ciphertext,
            scope,
            WHATSAPP_SECRET_METHOD
          )
        };
      }
    } catch {
      opened = null;
    }
    tokens.set(key, opened);
    return opened;
  }

  async function sendWhatsapp(
    scope: TenantScope,
    message: {
      language: string;
      phone: string;
      phoneNumberId: string;
      templateName: string;
      variables: string[];
    }
  ): Promise<Outcome> {
    const credentials = await tokenFor(scope);
    if (!credentials || !dependencies.whatsapp) {
      return {
        error: "credentials_unavailable",
        providerMessageId: null,
        status: "transient_failure"
      };
    }
    try {
      const result = await dependencies.whatsapp.provider.sendTemplate({
        accessToken: credentials.token,
        language: message.language,
        phoneNumberId: message.phoneNumberId,
        templateName: message.templateName,
        to: message.phone,
        variables: message.variables
      });
      return result.status === "sent"
        ? {
            error: null,
            providerMessageId: result.providerMessageId,
            status: "sent"
          }
        : {
            error: result.error,
            providerMessageId: null,
            status: result.status
          };
    } catch {
      return {
        error: "provider_exception",
        providerMessageId: null,
        status: "transient_failure"
      };
    }
  }

  /**
   * One person, possibly several browsers. It counts as sent if one got it (retrying
   * would repeat it on that one); a browser the push service no longer knows is dropped.
   */
  async function sendPush(push: {
    body: string;
    category: string;
    subscriptions: Array<{ auth: string; endpoint: string; p256dh: string }>;
    title: string;
    url: string;
  }): Promise<Outcome> {
    const provider = dependencies.webPush;
    if (!provider) {
      return {
        error: "push_unavailable",
        providerMessageId: null,
        status: "transient_failure"
      };
    }
    const payload = JSON.stringify({
      body: push.body,
      category: push.category,
      title: push.title,
      url: push.url
    });
    let delivered = 0;
    let transient = 0;
    let gone = 0;
    for (const subscription of push.subscriptions) {
      let result: Awaited<ReturnType<WebPushProvider["send"]>>;
      try {
        result = await provider.send({
          // A promotion is not urgent; a notice about a visit under way is.
          payload,
          subscription,
          urgency: push.category === "operational" ? "high" : "low"
        });
      } catch {
        result = { error: "provider_exception", status: "transient_failure" };
      }
      if (result.status === "sent") delivered += 1;
      else if (result.status === "gone") {
        gone += 1;
        await dependencies.repository.revokePushEndpoint(subscription.endpoint);
      } else if (result.status === "transient_failure") transient += 1;
    }
    if (delivered > 0) {
      return { error: null, providerMessageId: null, status: "sent" };
    }
    if (transient > 0) {
      return {
        error: "push_transient",
        providerMessageId: null,
        status: "transient_failure"
      };
    }
    return {
      error: gone > 0 ? "all_subscriptions_gone" : "push_rejected",
      providerMessageId: null,
      status: "permanent_failure"
    };
  }

  for (const item of claimed) {
    const started = await dependencies.repository.beginSend({
      outboxId: item.id,
      scope: item.scope
    });
    if (started.action === "skip") {
      summary.skipped += 1;
      continue;
    }
    if (started.action === "blocked") {
      summary.blocked += 1;
      continue;
    }
    if (started.action === "deferred") {
      summary.deferred += 1;
      continue;
    }
    const outcome =
      started.action === "send_push"
        ? await sendPush(started.push)
        : await sendWhatsapp(item.scope, started.message);
    const finished = await dependencies.repository.finishSend({
      error: outcome.error,
      outboxId: item.id,
      outcome: outcome.status,
      providerMessageId: outcome.providerMessageId,
      scope: item.scope
    });
    if (outcome.status === "sent") summary.sent += 1;
    else if (finished.status === "queued") summary.retried += 1;
    else summary.failed += 1;
  }
  return summary;
}

/** Time-driven automations (expiring rewards, birthdays, inactivity) into the queue. */
export async function runAutomationsIteration(dependencies: {
  repository: MessagingRepository;
}): Promise<number> {
  return dependencies.repository.enqueueDueAutomations();
}
