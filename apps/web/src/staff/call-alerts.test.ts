import type { WaiterCallView } from "@platform/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  alertTitle,
  baseTitle,
  callAlertStorageKey,
  newCallIds,
  openCallIds,
  playCallTone,
  readCallAlertMuted,
  resetUnsavedCallAlertMuted,
  vibrateForCall,
  writeCallAlertMuted
} from "./call-alerts";

function call(id: string, status: "acknowledged" | "open"): WaiterCallView {
  return {
    claimedByMe: false,
    claimedByName: null,
    createdAt: "2026-10-30T12:00:00.000Z",
    id,
    intentId: null,
    paymentMethod: null,
    reason: "call_waiter",
    status,
    tableId: "t",
    tableLabel: "1"
  };
}

describe("call alerts", () => {
  it("counts only the calls nobody took", () => {
    expect(
      openCallIds([
        call("a", "open"),
        call("b", "acknowledged"),
        call("c", "open")
      ])
    ).toEqual(["a", "c"]);
  });

  it("detects only open calls that were not seen before", () => {
    const seen = new Set(["a", "b"]);
    expect(
      newCallIds(seen, [
        call("a", "open"),
        call("b", "acknowledged"),
        call("c", "open"),
        call("d", "acknowledged")
      ])
    ).toEqual(["c"]);
    expect(newCallIds(new Set(["a"]), [call("a", "open")])).toEqual([]);
  });

  it("puts the number of unattended calls in the tab title and takes it out", () => {
    expect(alertTitle("Salón · Bar", 3)).toBe("(3) Salón · Bar");
    expect(alertTitle("(3) Salón · Bar", 1)).toBe("(1) Salón · Bar");
    expect(alertTitle("(3) Salón · Bar", 0)).toBe("Salón · Bar");
    expect(baseTitle("(12) Salón")).toBe("Salón");
    expect(baseTitle("Salón (2)")).toBe("Salón (2)");
  });

  it("keeps the mute choice on the device and survives a broken storage", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value)
    };
    expect(readCallAlertMuted(storage)).toBe(false);
    writeCallAlertMuted(true, storage);
    expect(data.get(callAlertStorageKey)).toBe("1");
    expect(readCallAlertMuted(storage)).toBe(true);
    writeCallAlertMuted(false, storage);
    expect(readCallAlertMuted(storage)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    expect(readCallAlertMuted(broken)).toBe(false);
    expect(readCallAlertMuted(null)).toBe(false);
  });

  it("still silences the alert while the page is open when storage is blocked", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    try {
      expect(() => writeCallAlertMuted(true, broken)).not.toThrow();
      expect(readCallAlertMuted(broken)).toBe(true);
      expect(readCallAlertMuted(null)).toBe(true);
      writeCallAlertMuted(false, broken);
      expect(readCallAlertMuted(broken)).toBe(false);
    } finally {
      resetUnsavedCallAlertMuted();
    }
  });

  it("does not break where there is no sound or vibration", () => {
    expect(playCallTone()).toBe(false);
    expect(vibrateForCall()).toBe(false);
  });

  it("vibrates with a short pattern when the device can", () => {
    const vibrate = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { vibrate });
    expect(vibrateForCall()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200]);
    vi.unstubAllGlobals();
  });
});
