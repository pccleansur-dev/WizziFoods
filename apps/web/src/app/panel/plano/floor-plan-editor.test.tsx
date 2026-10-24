import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FloorPlanEditor } from "./floor-plan-editor";
import type { FloorPlanActionState } from "./floor-plan";

const sectorId = "f1000000-0000-4000-8000-000000000001";
const tableId = "f2000000-0000-4000-8000-000000000002";
const noop = () => Promise.resolve({} as FloorPlanActionState);
const floorId = "f9000000-0000-4000-8000-000000000009";
const plan = {
  floors: [{ id: floorId, name: "Planta baja", position: 0, shortName: "PB" }],
  groups: [],
  sectors: [{ id: sectorId, name: "Salón", position: 0 }],
  tables: [
    {
      floorId,
      height: 100,
      id: tableId,
      label: "7",
      rotation: 0,
      seatCount: 4,
      seatLayout: "perimeter" as const,
      sectorId,
      shape: "square" as const,
      width: 100,
      x: 40,
      y: 40
    }
  ]
};

function render(
  overrides: Partial<Parameters<typeof FloorPlanEditor>[0]> = {}
) {
  return renderToStaticMarkup(
    <FloorPlanEditor
      initialPlan={plan}
      initialQr={[]}
      initialVersion={2}
      onReload={noop}
      onSave={noop}
      {...overrides}
    />
  );
}

describe("FloorPlanEditor", () => {
  it("shows a non-blocking recommendation for wide screens", () => {
    const markup = render();
    expect(markup).toContain("pantalla amplia");
    expect(markup).toContain('role="note"');
    expect(markup).not.toContain("aria-modal");
  });

  it("exposes tables to keyboard and assistive technology", () => {
    const markup = render();
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain("Mesa 7, 4 sillas, sector Salón");
    expect(markup).toContain('aria-describedby="floor-plan-keyboard-help"');
    expect(markup).toContain("flechas para moverla");
  });

  it("starts clean at the saved version and disables saving", () => {
    const markup = render();
    expect(markup).toContain("Guardado · versión 2");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Guardar plano/u);
  });

  it("guides the first step when there are no sectors", () => {
    const markup = render({
      initialPlan: { floors: [], groups: [], sectors: [], tables: [] },
      initialVersion: 0
    });
    expect(markup).toContain("Empezá creando un sector");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Agregar mesa/u);
  });

  it("keeps the QR codes out of the plan screen and offers them as their own view", () => {
    const markup = render({
      initialQr: [
        {
          label: "7",
          svg: "<svg></svg>",
          tableId,
          url: "https://x.example/m/abc"
        }
      ]
    });
    expect(markup).toContain("Códigos QR");
    expect(markup).not.toContain("Descargar QR");
    expect(markup).toContain('aria-label="Plano del salón"');
  });

  it("shows the QR view of the selected floor instead of the plan", () => {
    const markup = render({
      initialQr: [
        {
          label: "7",
          svg: "<svg></svg>",
          tableId,
          url: "https://x.example/m/abc"
        }
      ],
      initialView: "qr"
    });
    expect(markup).toContain("Descargar QR");
    expect(markup).toContain("Código QR de la mesa 7");
    expect(markup).not.toContain("https://x.example/m/abc");
    expect(markup).not.toContain('aria-label="Plano del salón"');
  });

  it("lists only the QR codes of the active floor", () => {
    const upperFloor = "f9000000-0000-4000-8000-0000000000a0";
    const otherTable = "f2000000-0000-4000-8000-0000000000b2";
    const twoFloors = {
      ...plan,
      floors: [
        ...plan.floors,
        { id: upperFloor, name: "Planta alta", position: 1, shortName: null }
      ],
      tables: [
        ...plan.tables,
        { ...plan.tables[0]!, floorId: upperFloor, id: otherTable, label: "A1" }
      ]
    };
    const markup = render({
      initialPlan: twoFloors,
      initialQr: [
        { label: "7", svg: "<svg></svg>", tableId, url: "u1" },
        { label: "A1", svg: "<svg></svg>", tableId: otherTable, url: "u2" }
      ],
      initialView: "qr"
    });
    expect(markup).toContain("Código QR de la mesa 7");
    expect(markup).not.toContain("Código QR de la mesa A1");
  });
});

describe("FloorPlanEditor floors", () => {
  it("shows a tab per floor with its table count and the floors panel", () => {
    const markup = render();
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain("Planta baja (PB)");
    expect(markup).toContain("1 mesa");
    expect(markup).toContain("Nueva planta");
    expect(markup).toContain("Corto");
  });
});
