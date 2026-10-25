"use client";

import type { WaiterSalonUnit, WaiterSalonView } from "@platform/contracts";
import { useState } from "react";

import {
  anchorChoices,
  canSeparate,
  joinBlockedReason,
  joinSummary,
  joinTableIds,
  separateSummary
} from "../../../../../staff/regroup-view";
import {
  groupUnitsByFloor,
  tableStateLabel
} from "../../../../../staff/waiter-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

export function WaiterTables({
  busy,
  onClean,
  onJoin,
  onSeparate,
  view
}: {
  busy: string | null;
  /** Marks every table of the unit that waits for cleaning as clean and available. */
  onClean(unit: WaiterSalonUnit): void;
  /** Joins the tables (the server brings along any group they already belong to). */
  onJoin(tableIds: string[], name: string | null): Promise<boolean>;
  /** Separates a group; `anchorTableId` keeps the open account, if there is one. */
  onSeparate(
    unit: WaiterSalonUnit,
    anchorTableId: string | null
  ): Promise<boolean>;
  view: WaiterSalonView;
}) {
  const groups = groupUnitsByFloor(view);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [separatingId, setSeparatingId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  // A unit that disappeared after a refresh is no longer part of the selection.
  const picked = pickedIds
    .map((id) => view.units.find((unit) => unit.id === id))
    .filter((unit): unit is WaiterSalonUnit => unit !== undefined);
  const separating =
    view.units.find((unit) => unit.id === separatingId && canSeparate(unit)) ??
    null;

  function toggle(unit: WaiterSalonUnit) {
    setSeparatingId(null);
    setPickedIds((current) =>
      current.includes(unit.id)
        ? current.filter((id) => id !== unit.id)
        : [...current, unit.id]
    );
  }

  async function join() {
    const done = await onJoin(
      joinTableIds(picked),
      groupName.trim() === "" ? null : groupName.trim()
    );
    if (done) {
      setPickedIds([]);
      setGroupName("");
    }
  }

  async function separate(unit: WaiterSalonUnit) {
    const done = await onSeparate(unit, anchorId);
    if (done) {
      setSeparatingId(null);
      setAnchorId(null);
    }
  }

  return (
    <section aria-labelledby="tables-title" className="waiter-section">
      <h2 id="tables-title">Mesas</h2>
      {picked.length > 0 ? (
        <div aria-label="Unir mesas" className="waiter-regroup" role="region">
          <p>
            <strong>{joinSummary(picked)}</strong>
            {picked.length < 2 ? " · elegí otra mesa para unirlas." : null}
          </p>
          {picked.length >= 2 ? (
            <>
              <label className="waiter-regroup__name">
                Nombre del grupo (opcional)
                <input
                  maxLength={60}
                  onChange={(event) => setGroupName(event.target.value)}
                  type="text"
                  value={groupName}
                />
              </label>
              <small>
                Si una mesa ya tiene una cuenta abierta, esa cuenta pasa a ser
                de todo el grupo. Los pedidos, los pagos y el saldo no se
                mueven.
              </small>
            </>
          ) : null}
          <div className="waiter-next-steps">
            {picked.length >= 2 ? (
              <button
                className="button button--primary"
                disabled={busy !== null}
                onClick={() => void join()}
                type="button"
              >
                Unir mesas
              </button>
            ) : null}
            <button
              className="button button--secondary"
              disabled={busy !== null}
              onClick={() => {
                setPickedIds([]);
                setGroupName("");
              }}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {separating ? (
        <div
          aria-label={`Separar ${separating.label}`}
          className="waiter-regroup"
          role="region"
        >
          <p>
            <strong>Separar {separating.label}</strong>
          </p>
          {anchorChoices(separating).length > 0 ? (
            <fieldset className="waiter-regroup__anchors">
              <legend>¿Con qué mesa queda la cuenta abierta?</legend>
              {anchorChoices(separating).map((choice) => (
                <label key={choice.id}>
                  <input
                    checked={anchorId === choice.id}
                    name={`anchor-${separating.id}`}
                    onChange={() => setAnchorId(choice.id)}
                    type="radio"
                  />
                  Mesa {choice.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <small>{separateSummary(separating, anchorId)}</small>
          <div className="waiter-next-steps">
            <button
              className="button button--primary"
              disabled={
                busy !== null ||
                (anchorChoices(separating).length > 0 && anchorId === null)
              }
              onClick={() => void separate(separating)}
              type="button"
            >
              Separar mesas
            </button>
            <button
              className="button button--secondary"
              disabled={busy !== null}
              onClick={() => {
                setSeparatingId(null);
                setAnchorId(null);
              }}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="waiter-empty">
          Todavía no tenés mesas asignadas. Pedile a un encargado que te asigne
          un sector.
        </p>
      ) : (
        groups.map(({ floor, units }) => (
          <div key={floor.id}>
            <h3 className="waiter-floor">{floor.name}</h3>
            <ul className="waiter-units">
              {units.map((unit) => {
                const isPicked = pickedIds.includes(unit.id);
                const reason = isPicked
                  ? null
                  : joinBlockedReason(
                      unit,
                      picked.filter((other) => other.id !== unit.id)
                    );
                return (
                  <li
                    className={`waiter-unit waiter-unit--${unit.state}${isPicked ? " waiter-unit--picked" : ""}`}
                    key={unit.id}
                  >
                    <strong>{unit.label}</strong>
                    {unit.name ? <span>{unit.name}</span> : null}
                    <span className="waiter-chip">
                      {tableStateLabel(unit.state)}
                    </span>
                    <small>{unit.sectorName}</small>
                    {unit.kind === "group" ? (
                      <small>
                        Una sola cuenta
                        {unit.tables.some((table) => !table.inScope)
                          ? " · incluye mesas de otro sector"
                          : ""}
                      </small>
                    ) : null}
                    {unit.session ? (
                      <small>
                        Cuenta abierta · Saldo{" "}
                        {formatMoney(unit.balanceCents ?? 0)}
                      </small>
                    ) : (
                      <small>Sin cuenta abierta</small>
                    )}
                    {unit.state === "needs_cleaning" &&
                    unit.tables.some((table) => table.inScope) ? (
                      <button
                        aria-label={`Marcar limpia y habilitar: ${unit.label}`}
                        className="button button--secondary"
                        disabled={busy !== null}
                        onClick={() => onClean(unit)}
                        type="button"
                      >
                        Marcar limpia
                      </button>
                    ) : null}
                    <label className="waiter-pick">
                      <input
                        aria-label={`Elegir para unir: ${unit.label}`}
                        checked={isPicked}
                        disabled={
                          busy !== null || (!isPicked && reason !== null)
                        }
                        onChange={() => toggle(unit)}
                        type="checkbox"
                      />
                      Unir con otra mesa
                    </label>
                    {!isPicked && reason !== null && picked.length > 0 ? (
                      <small className="waiter-pick__why">{reason}</small>
                    ) : null}
                    {canSeparate(unit) ? (
                      <button
                        aria-label={`Separar mesas: ${unit.label}`}
                        className="button button--secondary"
                        disabled={busy !== null}
                        onClick={() => {
                          setPickedIds([]);
                          setAnchorId(null);
                          setSeparatingId(unit.id);
                        }}
                        type="button"
                      >
                        Separar mesas
                      </button>
                    ) : null}
                    {unit.openCalls > 0 || unit.pendingIntents > 0 ? (
                      <b className="waiter-badge">
                        {unit.openCalls} llamado
                        {unit.openCalls === 1 ? "" : "s"}
                        {" · "}
                        {unit.pendingIntents} por validar
                      </b>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
