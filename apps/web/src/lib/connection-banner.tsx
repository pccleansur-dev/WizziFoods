import { connectionMessage } from "./connection-view";
import type { LiveState } from "./use-live-sync";

/**
 * Always rendered so tests and assistive tech can read the state; visible only when the
 * connection is degraded.
 */
export function ConnectionBanner({ state }: { state: LiveState }) {
  const message = connectionMessage(state.status, state.lastSyncAt);
  return (
    <div aria-live="polite" data-live-status={state.status} role="status">
      {message ? (
        <p
          className={`waiter-notice waiter-notice--error connection-banner connection-banner--${state.status}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
