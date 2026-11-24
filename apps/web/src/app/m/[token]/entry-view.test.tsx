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
    <EntryView
      hasCatalog
      result={{ entry: { ...base, ...entry }, status: "ok" }}
    />
  );
}

describe("EntryView", () => {
  it("identifies an available table without a checklist", () => {
    const markup = html({});
    expect(markup).toContain("Mesa 5");
    expect(markup).toContain("Terraza");
    expect(markup).not.toContain("En esta mesa");
  });

  it("keeps the entry compact on an open table", () => {
    expect(html({ mode: "join" })).not.toContain("diner-entry__status");
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
      expect(markup).toContain("Llamá al mozo");
      expect(markup).toContain('href="#carta"');
      expect(markup).not.toContain("Hacer el pedido");
    }
  );

  it.each(["needs_cleaning", "out_of_service", "not_accepting"] as const)(
    "does not promise the waiter when %s and the table cannot call",
    (reason) => {
      const markup = html({
        canCallWaiter: false,
        canConfirmOrder: false,
        mode: "view_only",
        reason
      });
      expect(markup).not.toContain("Llamá al mozo");
      expect(markup).toContain("Consultá al personal del local.");
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
