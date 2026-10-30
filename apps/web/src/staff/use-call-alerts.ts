"use client";

import type { WaiterCallView } from "@platform/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";

import {
  alertTitle,
  baseTitle,
  callHighlightMs,
  newCallIds,
  openCallIds,
  playCallTone,
  readCallAlertMuted,
  subscribeCallAlertMuted,
  unlockCallTone,
  vibrateForCall,
  writeCallAlertMuted
} from "./call-alerts";

/**
 * Warns the person at the salon screen when a call arrives: a short sound and
 * vibration (unless muted on this device), the number of unattended calls in
 * the tab title, and the ids of the calls that just came in so they can be
 * highlighted. The first reading never alerts: only what arrives afterwards.
 */
export function useCallAlerts(calls: readonly WaiterCallView[]) {
  const muted = useSyncExternalStore(
    subscribeCallAlertMuted,
    () => readCallAlertMuted(),
    () => false
  );
  const mutedRef = useRef(muted);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Set<number>());
  const openCount = openCallIds(calls).length;

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const unlock = () => unlockCallTone();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    const pending = timers.current;
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(calls.map((call) => call.id));
      return;
    }
    const incoming = newCallIds(seen.current, calls);
    for (const call of calls) seen.current.add(call.id);
    if (incoming.length === 0) return;
    setFresh((current) => new Set([...current, ...incoming]));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setFresh((current) => {
        const next = new Set(current);
        for (const id of incoming) next.delete(id);
        return next;
      });
    }, callHighlightMs);
    timers.current.add(timer);
    if (!mutedRef.current) {
      playCallTone();
      vibrateForCall();
    }
  }, [calls]);

  useEffect(() => {
    const apply = () => {
      const next = alertTitle(document.title, openCount);
      if (next !== document.title) document.title = next;
    };
    apply();
    // The framework writes the page title again once the page finished loading, which erased
    // the count when the salon opened with calls already waiting: put it back.
    const titleElement = document.querySelector("title");
    if (!titleElement || openCount === 0) return;
    const observer = new MutationObserver(apply);
    observer.observe(titleElement, {
      characterData: true,
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }, [openCount]);

  useEffect(
    () => () => {
      document.title = baseTitle(document.title);
    },
    []
  );

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    writeCallAlertMuted(next);
    // Turning the sound back on is a gesture: it unlocks audio and lets the
    // person hear what it will sound like.
    if (!next) {
      unlockCallTone();
      playCallTone();
    }
  }, []);

  return { fresh, muted, openCount, setMuted };
}
