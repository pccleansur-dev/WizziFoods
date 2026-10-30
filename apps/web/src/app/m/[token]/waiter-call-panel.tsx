"use client";

import type { DinerWaiterCallReason } from "@platform/contracts";
import { useState } from "react";

import { OFFLINE_ACTION_MESSAGE } from "../../../lib/connection-view";
import {
  sendWaiterCall,
  waiterCallLabels,
  waiterCallReasons
} from "./waiter-call";
import type { TableEntry } from "./table-entry";

type Notice =
  | { kind: "error"; text: string }
  | { kind: "sent"; reason: DinerWaiterCallReason; text: string };

/**
 * Lets the diner call the waiter from the table screen. It is shown only when
 * the table allows it (`canCallWaiter`), and says plainly when the waiter was
 * notified and when the request did not go through.
 */
export function WaiterCallPanel({
  entry,
  token
}: {
  entry: Pick<TableEntry, "canCallWaiter" | "mode">;
  token: string;
}) {
  const [pending, setPending] = useState<DinerWaiterCallReason | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const reasons = waiterCallReasons(entry);
  if (reasons.length === 0) return null;

  async function call(reason: DinerWaiterCallReason) {
    if (pending) return;
    // Nothing is sent, or shown as sent, while the device cannot reach the server.
    if (!navigator.onLine) {
      setNotice({ kind: "error", text: OFFLINE_ACTION_MESSAGE });
      return;
    }
    setPending(reason);
    setNotice(null);
    const outcome = await sendWaiterCall(token, reason);
    setPending(null);
    if (outcome.status === "error") {
      setNotice({ kind: "error", text: outcome.message });
      return;
    }
    const labels = waiterCallLabels[reason];
    setNotice({
      kind: "sent",
      reason,
      text:
        outcome.result.status === "acknowledged" && !outcome.result.created
          ? labels.sentAttended
          : labels.sent
    });
  }

  return (
    <section aria-labelledby="waiter-call-title" className="diner-waiter-call">
      <h2 id="waiter-call-title">¿Necesitás al mozo?</h2>
      <div className="diner-waiter-call-actions">
        {reasons.map((reason) => (
          <button
            aria-busy={pending === reason}
            className={
              notice?.kind === "sent" && notice.reason === reason
                ? "is-sent"
                : undefined
            }
            disabled={pending !== null}
            key={reason}
            onClick={() => void call(reason)}
            type="button"
          >
            {pending === reason ? "Avisando…" : waiterCallLabels[reason].button}
          </button>
        ))}
      </div>
      <p
        aria-live="polite"
        className={
          notice?.kind === "error"
            ? "diner-waiter-call-notice is-error"
            : "diner-waiter-call-notice"
        }
        role={notice?.kind === "error" ? "alert" : "status"}
      >
        {notice?.text ?? ""}
      </p>
    </section>
  );
}
