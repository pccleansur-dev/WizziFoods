import { describe, expect, it } from "vitest";

import { connectionMessage, OFFLINE_ACTION_MESSAGE } from "./connection-view";

describe("connection messages", () => {
  it("says nothing while the screen works", () => {
    expect(connectionMessage("live", Date.now())).toBeNull();
    expect(connectionMessage("polling", null)).toBeNull();
  });

  it("tells who is offline that what they see is old and that nothing is sent", () => {
    const text = connectionMessage("offline", Date.UTC(2026, 9, 31, 15, 5));
    expect(text).toContain("Sin conexión");
    expect(text).toContain("no se envía");
    expect(connectionMessage("offline", null)).toContain("última información.");
  });

  it("admits when the server cannot be reached", () => {
    expect(connectionMessage("reconnecting", null)).toContain("desactualizada");
  });

  it("never claims that an action left", () => {
    expect(OFFLINE_ACTION_MESSAGE).toContain("no se envió");
  });
});
