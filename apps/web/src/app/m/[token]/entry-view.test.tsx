import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntryView } from "./entry-view";
import type { TableEntry } from "./table-entry";

const base: TableEntry = {
  canCallWaiter: true,
  canConfirmOrder: true,
  group: null,
  mode: "start",
  reason: null,
  table: { floorName: "Terraza", label: "5", sectorName: "Salón" }
};

function html(entry: Partial<TableEntry>) {
  return renderToStaticMarkup(
    <EntryView result={{ entry: { ...base, ...entry }, status: "ok" }} />
  );
}

describe("EntryView", () => {
  it("invites to order on an available table", () => {
    const markup = html({});
    expect(markup).toContain("Mesa 5");
    expect(markup).toContain("Terraza");
    expect(markup).toContain("Hacer el pedido");
  });

  it("says the diner joins an open table", () => {
    expect(html({ mode: "join" })).toContain("te sumás al pedido");
  });

  it("names the group and its tables", () => {
    expect(
      html({
        group: { name: "Cumpleaños", tableLabels: ["17", "18"] },
        mode: "join"
      })
    ).toContain("Estás en Cumpleaños (mesas 17 y 18)");
  });

  it.each(["needs_cleaning", "out_of_service", "not_accepting"] as const)(
    "does not offer to confirm an order when %s",
    (reason) => {
      const markup = html({
        canConfirmOrder: false,
        mode: "view_only",
        reason
      });
      expect(markup).toContain("llamar al mozo");
      expect(markup).toContain("El pedido lo toma el mozo");
      expect(markup).not.toContain("Hacer el pedido");
    }
  );

  it.each([
    ["invalid", "No reconocemos este código"],
    ["unavailable", "Este local aún no está abierto"],
    ["unreachable", "Local no disponible"],
    ["error", "Algo salió mal"]
  ] as const)("shows a safe exit for %s", (status, title) => {
    const markup = renderToStaticMarkup(<EntryView result={{ status }} />);
    expect(markup).toContain(title);
    expect(markup).toContain('role="alert"');
  });
});
