import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WaiterCallPanel } from "./waiter-call-panel";

const token = "e".repeat(64);

describe("WaiterCallPanel", () => {
  it("shows the two useful actions on an open table", () => {
    const markup = renderToStaticMarkup(
      <WaiterCallPanel
        entry={{ canCallWaiter: true, mode: "join" }}
        token={token}
      />
    );
    expect(markup).toContain("Llamar al mozo");
    expect(markup).toContain("Pedir la cuenta");
    expect(markup).not.toContain("Necesito ayuda");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain(token);
  });

  it("keeps all call actions disabled until the browser can send a call", () => {
    const markup = renderToStaticMarkup(
      <WaiterCallPanel
        entry={{ canCallWaiter: true, mode: "join" }}
        token={token}
      />
    );
    expect(markup.match(/<button[^>]+disabled=""/gu)).toHaveLength(2);
    expect(markup).toContain("Preparando los avisos…");
  });

  it("does not offer the bill on a table nobody has opened", () => {
    const markup = renderToStaticMarkup(
      <WaiterCallPanel
        entry={{ canCallWaiter: true, mode: "start" }}
        token={token}
      />
    );
    expect(markup).toContain("Llamar al mozo");
    expect(markup).not.toContain("Pedir la cuenta");
  });

  it("renders nothing when the table does not allow calling the waiter", () => {
    expect(
      renderToStaticMarkup(
        <WaiterCallPanel
          entry={{ canCallWaiter: false, mode: "view_only" }}
          token={token}
        />
      )
    ).toBe("");
  });
});
