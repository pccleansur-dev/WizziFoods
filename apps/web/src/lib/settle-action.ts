import { UNKNOWN_OUTCOME_MESSAGE } from "./connection-view";

type Outcome<T> =
  | { data: T; status: "ok" }
  | { code: string | null; message: string; status: "error" };

/**
 * Runs a server action and never lets a broken connection escape as an exception: the
 * screen would be left "busy" forever. A call that fails on the way is an UNKNOWN outcome
 * (no code), which keeps the command id for the retry; it is never reported as sent.
 */
export async function settleAction<T>(
  run: () => Promise<Outcome<T>>
): Promise<Outcome<T>> {
  try {
    return await run();
  } catch {
    return { code: null, message: UNKNOWN_OUTCOME_MESSAGE, status: "error" };
  }
}
