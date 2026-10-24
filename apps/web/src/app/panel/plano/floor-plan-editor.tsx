"use client";

import {
  FLOOR_PLAN_LIMITS,
  parseFloorPlanDraft,
  type FloorPlanDraft,
  type FloorPlanIssue,
  type FloorSeatLayout,
  type FloorTableShape
} from "@platform/contracts";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { FloorPlanCanvas, SECTOR_COLORS } from "./floor-plan-canvas";
import {
  addFloor,
  addSector,
  addTable,
  ensureDefaultFloor,
  groupTables,
  moveTable,
  moveTableToFloor,
  nudgeTable,
  planForFloor,
  planIsDirty,
  qrEntriesByFloor,
  removeFloor,
  removeSector,
  renameFloor,
  removeTable,
  renameSector,
  resizeTable,
  rotateTable,
  SEAT_LAYOUT_LABELS,
  SHAPE_LABELS,
  tableLabelForIssue,
  ungroupTables,
  updateTable
} from "./floor-plan-editor-state";
import type { FloorPlanActionState, FloorPlanQr } from "./floor-plan";

type PendingCommand = {
  commandId: string;
  expectedVersion: number;
  serialized: string;
};

function downloadSvg(code: FloorPlanQr) {
  const blob = new Blob([code.svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `qr-mesa-${code.label.replace(/[^\p{L}\p{N}-]+/gu, "_")}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function FloorPlanEditor({
  initialPlan,
  initialQr,
  initialVersion,
  initialView = "plan",
  onReload,
  onSave
}: {
  initialPlan: FloorPlanDraft;
  initialQr: FloorPlanQr[];
  initialVersion: number;
  /** Vista con la que abre: el plano o los códigos QR de la planta. */
  initialView?: "plan" | "qr";
  onReload: () => Promise<FloorPlanActionState>;
  onSave: (serializedCommand: string) => Promise<FloorPlanActionState>;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [savedPlan, setSavedPlan] = useState(initialPlan);
  const [version, setVersion] = useState(initialVersion);
  const [qr, setQr] = useState(initialQr);
  const [selected, setSelected] = useState<string[]>([]);
  const [sectorName, setSectorName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [newShape, setNewShape] = useState<FloorTableShape>("square");
  const [targetSector, setTargetSector] = useState("");
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<"plan" | "qr">(initialView);
  const [activeFloor, setActiveFloor] = useState("");
  const [newFloor, setNewFloor] = useState({ name: "", shortName: "" });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FloorPlanActionState | null>(null);
  const pending = useRef<PendingCommand | null>(null);

  const dirty = planIsDirty(plan, savedPlan);
  const localIssues = useMemo<FloorPlanIssue[]>(() => {
    const result = parseFloorPlanDraft(plan);
    return result.ok ? [] : result.issues;
  }, [plan]);
  const serverIssues = outcome?.status === "invalid" ? outcome.issues : [];
  const shownIssues = localIssues.length > 0 ? localIssues : serverIssues;
  const floorId = plan.floors.some(({ id }) => id === activeFloor)
    ? activeFloor
    : (plan.floors[0]?.id ?? "");
  const visiblePlan = planForFloor(plan, floorId);
  const floorQrGroups = qrEntriesByFloor(plan, savedPlan);
  const floorQrEntries =
    floorQrGroups.find((group) => group.floor.id === floorId)?.entries ?? [];
  const sectorId = plan.sectors.some(({ id }) => id === targetSector)
    ? targetSector
    : (plan.sectors[0]?.id ?? "");
  const selectedTable =
    selected.length === 1
      ? plan.tables.find(({ id }) => id === selected[0])
      : undefined;
  const groupedIds = new Set(plan.groups.flatMap(({ tableIds }) => tableIds));
  const canGroup =
    selected.length >= 2 && selected.every((id) => !groupedIds.has(id));
  const savedIds = new Set(savedPlan.tables.map(({ id }) => id));
  const qrByTable = new Map(qr.map((code) => [code.tableId, code]));

  function edit(next: FloorPlanDraft) {
    if (busy) return;
    setPlan(next);
  }

  function adopt(result: FloorPlanActionState) {
    if (!result.plan || result.version === null) return;
    setPlan(result.plan);
    setSavedPlan(result.plan);
    setVersion(result.version);
    if (result.qr) setQr(result.qr);
    pending.current = null;
    setSelected((current) =>
      current.filter((id) => result.plan!.tables.some((t) => t.id === id))
    );
  }

  async function save() {
    if (busy) return;
    if (localIssues.length > 0) {
      setOutcome({
        issues: localIssues,
        message: "Corregí los datos marcados para poder guardar.",
        plan: null,
        qr: null,
        status: "invalid",
        version: null
      });
      return;
    }
    const serialized = JSON.stringify({ plan });
    const retained = pending.current;
    const command: PendingCommand =
      retained &&
      retained.expectedVersion === version &&
      retained.serialized === serialized
        ? retained
        : {
            commandId: crypto.randomUUID(),
            expectedVersion: version,
            serialized
          };
    pending.current = command;
    setBusy(true);
    try {
      const result = await onSave(
        JSON.stringify({
          commandId: command.commandId,
          expectedVersion: command.expectedVersion,
          plan
        })
      );
      setOutcome(result);
      if (result.status === "saved" || result.status === "replayed") {
        adopt(result);
      } else if (result.status !== "error") {
        pending.current = null;
      }
    } catch {
      setOutcome({
        issues: [],
        message:
          "No pudimos comunicarnos con la plataforma. Tus cambios siguen en pantalla; intentá nuevamente.",
        plan: null,
        qr: null,
        status: "error",
        version: null
      });
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (
      dirty &&
      !window.confirm("Vas a descartar los cambios sin guardar. ¿Continuar?")
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await onReload();
      setOutcome(result);
      if (result.status === "saved") adopt(result);
    } finally {
      setBusy(false);
    }
  }

  function select(tableId: string, additive: boolean) {
    setSelected((current) =>
      additive
        ? current.includes(tableId)
          ? current.filter((id) => id !== tableId)
          : [...current, tableId]
        : [tableId]
    );
  }

  function confirmRemove(tableId: string) {
    const table = plan.tables.find(({ id }) => id === tableId);
    if (!table) return;
    if (
      savedIds.has(tableId) &&
      !window.confirm(
        `¿Quitar la mesa ${table.label}? Su código QR dejará de funcionar al guardar.`
      )
    ) {
      return;
    }
    edit(removeTable(plan, tableId));
    setSelected((current) => current.filter((id) => id !== tableId));
  }

  function onTableKeyDown(event: KeyboardEvent, tableId: string) {
    const step = event.shiftKey ? 50 : 10;
    const arrows: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step]
    };
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      edit(nudgeTable(plan, tableId, arrow[0], arrow[1]));
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(tableId, false);
    } else if (event.key === " ") {
      event.preventDefault();
      select(tableId, true);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      confirmRemove(tableId);
    } else if (event.key === "Escape") {
      setSelected([]);
    }
  }

  function numberField(
    label: string,
    value: number,
    onChange: (value: number) => void,
    minimum: number,
    maximum: number
  ) {
    return (
      <label className="floor-plan-field">
        <span>{label}</span>
        <input
          disabled={busy}
          max={maximum}
          min={minimum}
          onChange={(event) => {
            const parsed = event.currentTarget.valueAsNumber;
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          type="number"
          value={value}
        />
      </label>
    );
  }

  const status = outcome?.message ?? "";
  const statusIsError =
    outcome !== null &&
    ["conflict", "error", "invalid"].includes(outcome.status);

  return (
    <section className="floor-plan" aria-labelledby="floor-plan-title">
      <header className="floor-plan-header">
        <div>
          <p className="eyebrow">Operación</p>
          <h1 id="floor-plan-title">Plano del salón</h1>
        </div>
        <div className="floor-plan-save">
          <span
            className={`catalog-status catalog-status--${dirty ? "dirty" : "saved"}`}
          >
            {dirty ? "Cambios sin guardar" : `Guardado · versión ${version}`}
          </span>
          <button
            className="button button--primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
            type="button"
          >
            {busy ? "Guardando…" : "Guardar plano"}
          </button>
        </div>
      </header>

      <p className="floor-plan-hint" role="note">
        Para diseñar con más comodidad conviene una pantalla amplia, pero podés
        seguir trabajando desde acá: usá los campos numéricos y las flechas del
        teclado si arrastrar resulta incómodo.
      </p>

      <div aria-live="polite" className="floor-plan-messages" role="status">
        {!statusIsError && status ? (
          <p className="form-message form-message--success">{status}</p>
        ) : null}
      </div>
      {statusIsError || shownIssues.length > 0 ? (
        <div className="form-message form-message--error" role="alert">
          {status ? <p>{status}</p> : null}
          {outcome?.status === "conflict" ? (
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => void reload()}
              type="button"
            >
              Cargar la versión más reciente
            </button>
          ) : null}
          {shownIssues.length > 0 ? (
            <ul>
              {shownIssues.map((issue, index) => {
                const label = tableLabelForIssue(plan, issue.path);
                return (
                  <li key={`${issue.path}-${index}`}>
                    {label ? `Mesa ${label}: ` : ""}
                    {issue.message}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="floor-plan-layout">
        <div className="floor-plan-stage">
          <div aria-label="Plantas" className="floor-plan-tabs" role="tablist">
            {plan.floors.map((floor) => {
              const count = plan.tables.filter(
                (table) => table.floorId === floor.id
              ).length;
              return (
                <button
                  aria-selected={floor.id === floorId}
                  className="floor-plan-tab"
                  key={floor.id}
                  onClick={() => {
                    setActiveFloor(floor.id);
                    setSelected([]);
                  }}
                  role="tab"
                  type="button"
                >
                  {floor.name}
                  {floor.shortName ? ` (${floor.shortName})` : ""}
                  <small>
                    {count} {count === 1 ? "mesa" : "mesas"}
                  </small>
                </button>
              );
            })}
          </div>
          <div aria-label="Vista" className="floor-plan-views" role="group">
            <button
              aria-pressed={view === "plan"}
              className="floor-plan-view"
              onClick={() => setView("plan")}
              type="button"
            >
              Plano
            </button>
            <button
              aria-pressed={view === "qr"}
              className="floor-plan-view"
              onClick={() => setView("qr")}
              type="button"
            >
              Códigos QR
              <small>{floorQrEntries.length}</small>
            </button>
          </div>
          {view === "plan" ? (
            <>
              <div
                className="floor-plan-toolbar"
                role="toolbar"
                aria-label="Herramientas del plano"
              >
                <label className="floor-plan-field">
                  <span>Forma</span>
                  <select
                    disabled={busy}
                    onChange={(event) =>
                      setNewShape(event.currentTarget.value as FloorTableShape)
                    }
                    value={newShape}
                  >
                    {(Object.keys(SHAPE_LABELS) as FloorTableShape[]).map(
                      (shape) => (
                        <option key={shape} value={shape}>
                          {SHAPE_LABELS[shape]}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <label className="floor-plan-field">
                  <span>Sector</span>
                  <select
                    disabled={busy || plan.sectors.length === 0}
                    onChange={(event) =>
                      setTargetSector(event.currentTarget.value)
                    }
                    value={sectorId}
                  >
                    {plan.sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button--secondary"
                  disabled={busy || plan.sectors.length === 0}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    // Un local siempre tiene una planta: se crea «Planta baja» con la primera mesa.
                    const base = ensureDefaultFloor(plan, crypto.randomUUID());
                    const target = base.floors.some(
                      ({ id: value }) => value === floorId
                    )
                      ? floorId
                      : (base.floors[0]?.id ?? "");
                    edit(
                      addTable(base, {
                        floorId: target,
                        id,
                        sectorId,
                        shape: newShape
                      })
                    );
                    setActiveFloor(target);
                    setSelected([id]);
                  }}
                  type="button"
                >
                  Agregar mesa
                </button>
              </div>

              {plan.sectors.length === 0 ? (
                <p className="floor-plan-empty">
                  Empezá creando un sector (por ejemplo «Salón» o «Terraza») y
                  después agregá las mesas.
                </p>
              ) : null}
              <FloorPlanCanvas
                disabled={busy}
                onKeyDown={onTableKeyDown}
                onMove={(tableId, x, y) => edit(moveTable(plan, tableId, x, y))}
                onSelect={select}
                onZoom={setZoom}
                plan={visiblePlan}
                selected={selected}
                zoom={zoom}
              />
              <p className="floor-plan-help" id="floor-plan-keyboard-help">
                Teclado: Tab para elegir una mesa, flechas para moverla (con
                Mayús, pasos grandes), Enter para seleccionarla, Espacio para
                sumar o quitar de la selección, Supr para quitarla.
              </p>
            </>
          ) : (
            <section
              aria-labelledby="floor-qr-title"
              className="floor-plan-qr-view"
            >
              <h2 id="floor-qr-title">
                Códigos QR de{" "}
                {plan.floors.find(({ id }) => id === floorId)?.name ??
                  "la planta"}
              </h2>
              <p className="floor-plan-help">
                Cada mesa física tiene un QR propio que no cambia al moverla,
                pasarla de planta, editarla ni agruparla. Los QR de mesas nuevas
                se generan al guardar.
              </p>
              <div className="floor-plan-qr-actions">
                {floorQrEntries.filter(({ saved }) => saved).length > 1 ? (
                  <button
                    className="button button--secondary"
                    onClick={() =>
                      floorQrEntries.forEach(({ table }) => {
                        const code = qrByTable.get(table.id);
                        if (code) downloadSvg(code);
                      })
                    }
                    type="button"
                  >
                    Descargar los QR de esta planta
                  </button>
                ) : null}
                {qr.length > 1 && floorQrGroups.length > 1 ? (
                  <button
                    className="button button--secondary"
                    onClick={() => qr.forEach(downloadSvg)}
                    type="button"
                  >
                    Descargar los QR de todo el local
                  </button>
                ) : null}
              </div>
              {floorQrEntries.length === 0 ? (
                <p className="floor-plan-empty">
                  Esta planta todavía no tiene mesas.
                </p>
              ) : null}
              <ul className="floor-plan-qr-grid">
                {floorQrEntries.map(({ saved, table }) => {
                  const code = saved ? qrByTable.get(table.id) : undefined;
                  return (
                    <li key={table.id}>
                      {code ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`Código QR de la mesa ${table.label}`}
                          className="floor-plan-qr"
                          height="96"
                          src={`data:image/svg+xml;utf8,${encodeURIComponent(code.svg)}`}
                          width="96"
                        />
                      ) : null}
                      <strong>Mesa {table.label}</strong>
                      {!saved ? (
                        <span className="floor-plan-help">
                          Guardá para generar el QR
                        </span>
                      ) : code ? (
                        <button
                          className="button button--secondary"
                          onClick={() => downloadSvg(code)}
                          type="button"
                        >
                          Descargar QR
                        </button>
                      ) : (
                        <span className="floor-plan-help">Sin QR</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside className="floor-plan-side">
          <section aria-labelledby="floor-levels-title">
            <h2 id="floor-levels-title">Plantas</h2>
            <form
              className="floor-plan-inline floor-plan-inline--floor"
              onSubmit={(event) => {
                event.preventDefault();
                const id = crypto.randomUUID();
                const next = addFloor(
                  plan,
                  newFloor.name,
                  id,
                  newFloor.shortName
                );
                edit(next);
                if (next !== plan) {
                  setActiveFloor(id);
                  setSelected([]);
                  setNewFloor({ name: "", shortName: "" });
                }
              }}
            >
              <label className="floor-plan-field floor-plan-field--grow">
                <span>Nueva planta</span>
                <input
                  disabled={busy}
                  maxLength={60}
                  onChange={(event) =>
                    setNewFloor({
                      ...newFloor,
                      name: event.currentTarget.value
                    })
                  }
                  value={newFloor.name}
                />
              </label>
              <label className="floor-plan-field floor-plan-field--short">
                <span>Corto</span>
                <input
                  disabled={busy}
                  maxLength={FLOOR_PLAN_LIMITS.maxShortNameLength}
                  onChange={(event) =>
                    setNewFloor({
                      ...newFloor,
                      shortName: event.currentTarget.value
                    })
                  }
                  placeholder="PB"
                  value={newFloor.shortName}
                />
              </label>
              <button
                className="button button--secondary"
                disabled={
                  busy ||
                  newFloor.name.trim() === "" ||
                  plan.floors.length >= FLOOR_PLAN_LIMITS.maxFloors
                }
                type="submit"
              >
                Agregar
              </button>
            </form>
            <ul className="floor-plan-list floor-plan-list--floors">
              {plan.floors.map((floor) => (
                <li key={floor.id}>
                  <input
                    aria-label={`Nombre de la planta ${floor.name}`}
                    disabled={busy}
                    maxLength={60}
                    onChange={(event) =>
                      edit(
                        renameFloor(
                          plan,
                          floor.id,
                          event.currentTarget.value,
                          floor.shortName
                        )
                      )
                    }
                    value={floor.name}
                  />
                  <input
                    aria-label={`Nombre corto de la planta ${floor.name}`}
                    className="floor-plan-short"
                    disabled={busy}
                    maxLength={FLOOR_PLAN_LIMITS.maxShortNameLength}
                    onChange={(event) =>
                      edit(
                        renameFloor(
                          plan,
                          floor.id,
                          floor.name,
                          event.currentTarget.value
                        )
                      )
                    }
                    placeholder="Corto"
                    value={floor.shortName ?? ""}
                  />
                  <button
                    className="button button--secondary"
                    disabled={
                      busy ||
                      plan.floors.length <= 1 ||
                      plan.tables.some((t) => t.floorId === floor.id)
                    }
                    onClick={() => edit(removeFloor(plan, floor.id))}
                    title="Sólo se puede quitar una planta sin mesas"
                    type="button"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="floor-sectors-title">
            <h2 id="floor-sectors-title">Sectores</h2>
            <form
              className="floor-plan-inline"
              onSubmit={(event) => {
                event.preventDefault();
                const id = crypto.randomUUID();
                edit(addSector(plan, sectorName, id));
                setSectorName("");
              }}
            >
              <label className="floor-plan-field floor-plan-field--grow">
                <span>Nuevo sector</span>
                <input
                  disabled={busy}
                  maxLength={60}
                  onChange={(event) => setSectorName(event.currentTarget.value)}
                  value={sectorName}
                />
              </label>
              <button
                className="button button--secondary"
                disabled={busy || sectorName.trim() === ""}
                type="submit"
              >
                Agregar
              </button>
            </form>
            <ul className="floor-plan-list">
              {plan.sectors.map((sector, index) => (
                <li key={sector.id}>
                  <span
                    aria-hidden="true"
                    className="floor-plan-swatch"
                    style={{
                      background: SECTOR_COLORS[index % SECTOR_COLORS.length]
                    }}
                  />
                  <input
                    aria-label={`Nombre del sector ${sector.name}`}
                    disabled={busy}
                    maxLength={60}
                    onChange={(event) =>
                      edit(
                        renameSector(plan, sector.id, event.currentTarget.value)
                      )
                    }
                    value={sector.name}
                  />
                  <button
                    className="button button--secondary"
                    disabled={
                      busy || plan.tables.some((t) => t.sectorId === sector.id)
                    }
                    onClick={() => edit(removeSector(plan, sector.id))}
                    title="Sólo se puede quitar un sector sin mesas"
                    type="button"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="floor-table-title">
            <h2 id="floor-table-title">Mesa seleccionada</h2>
            {selectedTable ? (
              <div className="floor-plan-form">
                <label className="floor-plan-field">
                  <span>Nombre o número</span>
                  <input
                    disabled={busy}
                    maxLength={20}
                    onChange={(event) =>
                      edit(
                        updateTable(plan, selectedTable.id, {
                          label: event.currentTarget.value
                        })
                      )
                    }
                    value={selectedTable.label}
                  />
                </label>
                <label className="floor-plan-field">
                  <span>Planta</span>
                  <select
                    disabled={busy}
                    onChange={(event) => {
                      const target = event.currentTarget.value;
                      edit(moveTableToFloor(plan, selectedTable.id, target));
                      setActiveFloor(target);
                    }}
                    value={selectedTable.floorId}
                  >
                    {plan.floors.map((floor) => (
                      <option key={floor.id} value={floor.id}>
                        {floor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="floor-plan-field">
                  <span>Sector</span>
                  <select
                    disabled={busy}
                    onChange={(event) =>
                      edit(
                        updateTable(plan, selectedTable.id, {
                          sectorId: event.currentTarget.value
                        })
                      )
                    }
                    value={selectedTable.sectorId}
                  >
                    {plan.sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="floor-plan-field">
                  <span>Forma</span>
                  <select
                    disabled={busy}
                    onChange={(event) =>
                      edit(
                        updateTable(plan, selectedTable.id, {
                          shape: event.currentTarget.value as FloorTableShape
                        })
                      )
                    }
                    value={selectedTable.shape}
                  >
                    {(Object.keys(SHAPE_LABELS) as FloorTableShape[]).map(
                      (s) => (
                        <option key={s} value={s}>
                          {SHAPE_LABELS[s]}
                        </option>
                      )
                    )}
                  </select>
                </label>
                {numberField(
                  "Ancho",
                  selectedTable.width,
                  (value) =>
                    edit(
                      resizeTable(
                        plan,
                        selectedTable.id,
                        value,
                        selectedTable.height
                      )
                    ),
                  40,
                  600
                )}
                {numberField(
                  "Alto",
                  selectedTable.height,
                  (value) =>
                    edit(
                      resizeTable(
                        plan,
                        selectedTable.id,
                        selectedTable.width,
                        value
                      )
                    ),
                  40,
                  600
                )}
                {numberField(
                  "Posición X",
                  selectedTable.x,
                  (value) =>
                    edit(
                      moveTable(plan, selectedTable.id, value, selectedTable.y)
                    ),
                  0,
                  4000
                )}
                {numberField(
                  "Posición Y",
                  selectedTable.y,
                  (value) =>
                    edit(
                      moveTable(plan, selectedTable.id, selectedTable.x, value)
                    ),
                  0,
                  3000
                )}
                {numberField(
                  "Rotación (°)",
                  selectedTable.rotation,
                  (value) =>
                    edit(
                      updateTable(plan, selectedTable.id, { rotation: value })
                    ),
                  0,
                  359
                )}
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => edit(rotateTable(plan, selectedTable.id, 90))}
                  type="button"
                >
                  ↻ Rotar 90°
                </button>
                {numberField(
                  "Sillas",
                  selectedTable.seatCount,
                  (value) =>
                    edit(
                      updateTable(plan, selectedTable.id, { seatCount: value })
                    ),
                  0,
                  24
                )}
                <label className="floor-plan-field">
                  <span>Disposición de sillas</span>
                  <select
                    disabled={busy}
                    onChange={(event) =>
                      edit(
                        updateTable(plan, selectedTable.id, {
                          seatLayout: event.currentTarget
                            .value as FloorSeatLayout
                        })
                      )
                    }
                    value={selectedTable.seatLayout}
                  >
                    {(Object.keys(SEAT_LAYOUT_LABELS) as FloorSeatLayout[]).map(
                      (l) => (
                        <option key={l} value={l}>
                          {SEAT_LAYOUT_LABELS[l]}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => confirmRemove(selectedTable.id)}
                  type="button"
                >
                  Quitar mesa
                </button>
              </div>
            ) : (
              <p className="floor-plan-help">
                {selected.length > 1
                  ? `${selected.length} mesas seleccionadas.`
                  : "Elegí una mesa del plano para editarla."}
              </p>
            )}
          </section>

          <section aria-labelledby="floor-groups-title">
            <h2 id="floor-groups-title">Agrupaciones</h2>
            <p className="floor-plan-help">
              Agrupar es temporal: cada mesa conserva su identidad y su QR.
              Seleccioná dos o más mesas con Mayús + clic o con la barra
              espaciadora.
            </p>
            <form
              className="floor-plan-inline"
              onSubmit={(event) => {
                event.preventDefault();
                const name =
                  groupName.trim() || `Agrupación ${plan.groups.length + 1}`;
                edit(groupTables(plan, selected, crypto.randomUUID(), name));
                setGroupName("");
              }}
            >
              <label className="floor-plan-field floor-plan-field--grow">
                <span>Nombre de la agrupación</span>
                <input
                  disabled={busy}
                  maxLength={60}
                  onChange={(event) => setGroupName(event.currentTarget.value)}
                  value={groupName}
                />
              </label>
              <button
                className="button button--secondary"
                disabled={busy || !canGroup}
                type="submit"
              >
                Agrupar
              </button>
            </form>
            <ul className="floor-plan-list">
              {plan.groups.map((group) => (
                <li key={group.id}>
                  <span>
                    <strong>{group.name}</strong>:{" "}
                    {group.tableIds
                      .map((id) => plan.tables.find((t) => t.id === id)?.label)
                      .join(", ")}
                  </span>
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => edit(ungroupTables(plan, group.id))}
                    type="button"
                  >
                    Separar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}
