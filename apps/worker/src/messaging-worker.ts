import type { TenantScope } from "@platform/contracts";
import type { MessagingRepository } from "@platform/database";
import type {
  PaymentSecretSealer,
  WhatsappProvider
} from "@platform/integrations";

/** The method name the access token is sealed under; the API uses the same one. */
export const WHATSAPP_SECRET_METHOD = "whatsapp";

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
  provider: WhatsappProvider;
  repository: MessagingRepository;
  sealer: PaymentSecretSealer;
};

function scopeKey(scope: TenantScope): string {
  return `${scope.tenantId}:${scope.locationId}`;
}

/**
 * One pass over the due messages. The database decides whether each one may leave
 * (`beginSend`); this code only carries out a "send" and reports what happened. A
 * message that already started is never sent twice: if the report is lost, the
 * lease expires and the database closes it as failed.
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
  const claimed = await dependencies.repository.claimOutbox({
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
      if (credentials) {
        opened = {
          phoneNumberId: credentials.phoneNumberId,
          token: dependencies.sealer.open(
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
    const credentials = await tokenFor(item.scope);
    let outcome: Awaited<ReturnType<WhatsappProvider["sendTemplate"]>>;
    if (!credentials) {
      outcome = {
        error: "credentials_unavailable",
        status: "transient_failure"
      };
    } else {
      try {
        outcome = await dependencies.provider.sendTemplate({
          accessToken: credentials.token,
          language: started.message.language,
          phoneNumberId: started.message.phoneNumberId,
          templateName: started.message.templateName,
          to: started.message.phone,
          variables: started.message.variables
        });
      } catch {
        outcome = { error: "provider_exception", status: "transient_failure" };
      }
    }
    const finished = await dependencies.repository.finishSend({
      error: outcome.status === "sent" ? null : outcome.error,
      outboxId: item.id,
      outcome: outcome.status,
      providerMessageId:
        outcome.status === "sent" ? outcome.providerMessageId : null,
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
