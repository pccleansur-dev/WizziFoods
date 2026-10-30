"use client";

import type { WaiterCallView } from "@platform/contracts";

import {
  callAgeLabel,
  callReasonLabel
} from "../../../../../staff/waiter-view";

type Props = {
  busy: string | null;
  calls: WaiterCallView[];
  canOverrideClaim: boolean;
  /** Calls that just arrived: highlighted for a few seconds. */
  fresh: ReadonlySet<string>;
  now: number;
  onClaim(callId: string): void;
  onResolve(callId: string): void;
};

/** Calls that belong to no order: the diner asked for the waiter, the bill or help. */
export function dinerCalls(calls: readonly WaiterCallView[]): WaiterCallView[] {
  return calls.filter((call) => call.reason !== "order_validation");
}

export function WaiterCalls({
  busy,
  calls,
  canOverrideClaim,
  fresh,
  now,
  onClaim,
  onResolve
}: Props) {
  const list = dinerCalls(calls);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="diner-calls-title" className="waiter-section">
      <h2 id="diner-calls-title">Llamados de mesa</h2>
      <div className="waiter-list">
        {list.map((call) => {
          const claimedByOther =
            call.status === "acknowledged" && !call.claimedByMe;
          const blocked = claimedByOther && !canOverrideClaim;
          const disabled = busy !== null || blocked;
          const titleId = `diner-call-${call.id}`;
          const classes = [
            "waiter-card",
            "waiter-call",
            call.status === "open" ? "waiter-call--open" : "",
            fresh.has(call.id) ? "waiter-call--new" : ""
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <article
              aria-labelledby={titleId}
              className={classes}
              key={call.id}
            >
              <header>
                <h3 id={titleId}>
                  Mesa {call.tableLabel} · {callReasonLabel(call.reason)}
                </h3>
                <p>{callAgeLabel(call.createdAt, now)}</p>
              </header>
              {call.status === "acknowledged" ? (
                <p className="waiter-chip waiter-chip--claimed">
                  {call.claimedByMe
                    ? "Lo estás atendiendo"
                    : `Lo atiende ${call.claimedByName ?? "otro mozo"}`}
                </p>
              ) : (
                <p className="waiter-chip waiter-chip--open">Sin atender</p>
              )}
              <div className="waiter-actions">
                {call.status === "open" ? (
                  <button
                    className="button button--secondary"
                    disabled={disabled}
                    onClick={() => onClaim(call.id)}
                    type="button"
                  >
                    Tomar llamado de mesa {call.tableLabel}
                  </button>
                ) : null}
                <button
                  className="button button--primary"
                  disabled={disabled}
                  onClick={() => onResolve(call.id)}
                  type="button"
                >
                  Resolver llamado de mesa {call.tableLabel}
                </button>
              </div>
              {blocked ? (
                <p className="waiter-note" role="status">
                  Este llamado lo atiende otro mozo; sólo él o un encargado
                  puede resolverlo.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
