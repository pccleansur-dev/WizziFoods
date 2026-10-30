import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WaiterCallPanel } from "./waiter-call-panel";

const token = "e".repeat(64);

describe("WaiterCallPanel", () => {
  it("shows the three reasons on an open table", () => {
    const markup = renderToStaticMarkup(
      <WaiterCallPanel
        entry={{ canCallWaiter: true, mode: "join" }}
        token={token}
      />
    );
    expect(markup).toContain("Llamar al mozo");
    expect(markup).toContain("Pedir la cuenta");
    expect(markup).toContain("Necesito ayuda");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain(token);
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
