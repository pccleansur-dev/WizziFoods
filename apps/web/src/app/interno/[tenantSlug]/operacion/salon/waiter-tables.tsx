"use client";

import type { WaiterSalonView } from "@platform/contracts";

import {
  groupUnitsByFloor,
  tableStateLabel
} from "../../../../../staff/waiter-view";

export function WaiterTables({ view }: { view: WaiterSalonView }) {
  const groups = groupUnitsByFloor(view);
  return (
    <section aria-labelledby="tables-title" className="waiter-section">
      <h2 id="tables-title">Mesas</h2>
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
              {units.map((unit) => (
                <li
                  className={`waiter-unit waiter-unit--${unit.state}`}
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
                  <small>Sin sesión</small>
                  <small>Saldo disponible desde T22</small>
                  {unit.openCalls > 0 || unit.pendingIntents > 0 ? (
                    <b className="waiter-badge">
                      {unit.openCalls} llamado{unit.openCalls === 1 ? "" : "s"}
                      {" · "}
                      {unit.pendingIntents} por validar
                    </b>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
