import type { WaiterCallView } from "@platform/contracts";

/**
 * Alert for a new call to the staff. It is local to the device that has the
 * salon open: no push, no external delivery. Only the mute choice is kept, in
 * the device itself.
 */
export const callAlertStorageKey = "staff.callAlerts.muted";

const mutedChanged = "staff-call-alerts-muted";

/** Short double buzz; devices without vibration ignore it. */
export const callVibrationPattern = [200, 100, 200];

/** How long a new call keeps its highlight. */
export const callHighlightMs = 12_000;

/** Calls nobody took yet: the ones that need someone now. */
export function openCallIds(calls: readonly WaiterCallView[]): string[] {
  return calls.filter((call) => call.status === "open").map((call) => call.id);
}

/** Open calls that were not in the salon the last time it was read. */
export function newCallIds(
  seen: ReadonlySet<string>,
  calls: readonly WaiterCallView[]
): string[] {
  return calls
    .filter((call) => call.status === "open" && !seen.has(call.id))
    .map((call) => call.id);
}

const countPrefix = /^\(\d+\)\s+/u;

export function baseTitle(title: string): string {
  return title.replace(countPrefix, "");
}

/** The tab title carries the number of unattended calls. */
export function alertTitle(title: string, openCount: number): string {
  const base = baseTitle(title);
  return openCount > 0 ? `(${openCount}) ${base}` : base;
}

/** What the staff home says about the calls nobody took yet; null when there are none. */
export function unattendedCallsLabel(openCount: number): string | null {
  if (openCount <= 0) return null;
  return openCount === 1
    ? "1 llamado sin atender"
    : `${openCount} llamados sin atender`;
}

type MuteStorage = Pick<Storage, "getItem" | "setItem">;

function deviceStorage(): MuteStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCallAlertMuted(
  storage: MuteStorage | null = deviceStorage()
): boolean {
  try {
    return storage?.getItem(callAlertStorageKey) === "1";
  } catch {
    return false;
  }
}

export function writeCallAlertMuted(
  muted: boolean,
  storage: MuteStorage | null = deviceStorage()
): void {
  try {
    storage?.setItem(callAlertStorageKey, muted ? "1" : "0");
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(mutedChanged));
  } catch {
    // The choice just is not remembered on this device.
  }
}

type ToneWindow = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (audio) return audio;
  if (typeof window === "undefined") return null;
  const scope = window as unknown as ToneWindow;
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) return null;
  try {
    audio = new Context();
  } catch {
    audio = null;
  }
  return audio;
}

/**
 * Browsers only let sound start after a gesture on the page, so the salon calls
 * this on the first touch or key press.
 */
export function unlockCallTone(): void {
  const context = audioContext();
  if (context && context.state === "suspended") void context.resume();
}

/** Two short notes. Returns false when this device cannot play it. */
export function playCallTone(): boolean {
  const context = audioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    for (const [index, frequency] of [880, 1175].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.22;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    }
    return true;
  } catch {
    return false;
  }
}

export function vibrateForCall(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function" &&
      navigator.vibrate(callVibrationPattern)
    );
  } catch {
    return false;
  }
}

/** Lets every screen of this device follow the mute choice (and other tabs). */
export function subscribeCallAlertMuted(listener: () => void): () => void {
  window.addEventListener(mutedChanged, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(mutedChanged, listener);
    window.removeEventListener("storage", listener);
  };
}
