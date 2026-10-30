import type { WaiterCallView } from "@platform/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CallAlertToggle } from "./call-alert-toggle";
import { dinerCalls, WaiterCalls } from "./waiter-calls";

const now = Date.parse("2026-10-30T12:05:00.000Z");

function call(overrides: Partial<WaiterCallView>): WaiterCallView {
  return {
    claimedByMe: false,
    claimedByName: null,
    createdAt: "2026-10-30T12:00:00.000Z",
    id: "call-1",
    intentId: null,
    paymentMethod: null,
    reason: "request_bill",
    status: "open",
    tableId: "table-1",
    tableLabel: "7",
    ...overrides
  };
}

function html(calls: WaiterCallView[], canOverrideClaim = false, fresh = []) {
  return renderToStaticMarkup(
    <WaiterCalls
      busy={null}
      calls={calls}
      canOverrideClaim={canOverrideClaim}
      fresh={new Set<string>(fresh)}
      now={now}
      onClaim={vi.fn()}
      onResolve={vi.fn()}
    />
  );
}

describe("WaiterCalls", () => {
  it("lists a diner call with its table, its reason and how long ago", () => {
    const markup = html([call({})]);
    expect(markup).toContain("Mesa 7 · Pide la cuenta");
    expect(markup).toContain("hace 5 min");
    expect(markup).toContain("Sin atender");
    expect(markup).toContain("Tomar llamado de mesa 7");
    expect(markup).toContain("Resolver llamado de mesa 7");
    expect(markup).toContain("waiter-call--open");
  });

  it("leaves order validation calls to the pending orders panel", () => {
    const validation = call({
      id: "v",
      intentId: "intent",
      paymentMethod: "cash",
      reason: "order_validation"
    });
    expect(dinerCalls([validation, call({})])).toHaveLength(1);
    expect(html([validation])).toBe("");
  });

  it("highlights only the calls that just arrived", () => {
    const markup = html([call({}), call({ id: "call-2" })], false, [
      "call-2" as never
    ]);
    expect(markup.match(/waiter-call--new/g)).toHaveLength(1);
  });

  it("does not offer to take a call somebody else is attending", () => {
    const attended = call({
      claimedByName: "Beto",
      status: "acknowledged"
    });
    const markup = html([attended]);
    expect(markup).toContain("Lo atiende Beto");
    expect(markup).not.toContain("Tomar llamado");
    expect(markup).toContain("disabled");
    expect(html([attended], true)).not.toContain("disabled");
  });

  it("shows my own call as being attended and resolvable", () => {
    const markup = html([
      call({ claimedByMe: true, claimedByName: "Ana", status: "acknowledged" })
    ]);
    expect(markup).toContain("Lo estás atendiendo");
    expect(markup).not.toContain("disabled");
  });
});

describe("CallAlertToggle", () => {
  it("says whether the alert has sound on this device", () => {
    const on = renderToStaticMarkup(
      <CallAlertToggle muted={false} onChange={vi.fn()} />
    );
    expect(on).toContain("con sonido y vibración");
    expect(on).toContain('aria-pressed="true"');
    const off = renderToStaticMarkup(
      <CallAlertToggle muted onChange={vi.fn()} />
    );
    expect(off).toContain("silenciado en este dispositivo");
    expect(off).toContain('aria-pressed="false"');
  });
});
