"use client";

import type { AccountPaymentMethod, SessionReward } from "@platform/contracts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { paymentMethodChoices } from "../../../../../staff/account-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";
import {
  getSessionRewardsAction,
  redeemRewardAction
} from "../loyalty-actions";

type Props = {
  busy: boolean;
  onSettled(): void;
  sessionId: string;
};

/**
 * Rewards a diner reserved for this account. The till picks only the payment method:
 * the discount, the payment of what is left and the redemption are one operation, and
 * if the payment cannot be recorded the reward goes back to the diner.
 */
export function LoyaltyRewards({ busy, onSettled, sessionId }: Props) {
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;
  const [rewards, setRewards] = useState<SessionReward[]>([]);
  const [method, setMethod] = useState<AccountPaymentMethod>("cash");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getSessionRewardsAction(tenantSlug, sessionId).then((result) => {
        if (result.status === "ok") setRewards(result.data);
      }),
    [sessionId, tenantSlug]
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (rewards.length === 0 && message === null) return null;

  async function redeem(reward: SessionReward) {
    setWorking(true);
    setMessage(null);
    const result = await redeemRewardAction(tenantSlug, sessionId, {
      commandId: crypto.randomUUID(),
      method,
      rewardId: reward.rewardId,
      tipCents: 0
    });
    setWorking(false);
    if (result.status === "error") {
      setMessage(result.message);
    } else if (result.data.redeemed) {
      setMessage("Premio canjeado y cuenta cobrada.");
      onSettled();
    } else {
      setMessage(
        "No se pudo registrar el cobro: el premio quedó disponible para el cliente."
      );
    }
    await load();
  }

  return (
    <section aria-label="Premios reservados" className="waiter-reject">
      <h4>Premios reservados</h4>
      {rewards.map((reward) => (
        <div key={reward.rewardId}>
          <p>
            {reward.displayName}: descuento de{" "}
            <strong>{formatMoney(reward.discountCents)}</strong>
          </p>
          <label htmlFor={`reward-method-${reward.rewardId}`}>
            Medio de pago del resto
          </label>
          <select
            id={`reward-method-${reward.rewardId}`}
            onChange={(event) =>
              setMethod(event.target.value as AccountPaymentMethod)
            }
            value={method}
          >
            {paymentMethodChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <button
            className="button button--primary"
            disabled={busy || working}
            onClick={() => void redeem(reward)}
            type="button"
          >
            Canjear premio de {reward.displayName} y cobrar
          </button>
        </div>
      ))}
      {message !== null ? (
        <p aria-live="polite" className="waiter-note" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
