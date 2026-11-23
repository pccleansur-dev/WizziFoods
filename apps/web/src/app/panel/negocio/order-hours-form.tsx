"use client";

import type { OrderServiceHours } from "@platform/contracts";
import { startTransition, useActionState } from "react";
import { saveOrderHours } from "./order-hours-actions";

const week = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo"
];
const fields = [
  ["opens", "Abre pedidos"],
  ["kitchen", "Cierra cocina"],
  ["bar", "Cierra barra"],
  ["orders", "Cierra pedidos"]
] as const;

export function OrderHoursForm({ hours }: { hours: OrderServiceHours }) {
  const [message, action, pending] = useActionState(saveOrderHours, "");
  return (
    <details className="profile-form order-hours">
      <summary>
        <strong>Horarios de pedidos</strong>
      </summary>
      <form
        className="order-hours__form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <p>
          Un cierre anterior a la apertura cuenta como madrugada del día
          siguiente. Si configurás horarios, los días vacíos quedan cerrados.
          Cocina y barra pueden usar el cierre general.
        </p>
        {week.map((day, index) => (
          <fieldset key={day} className="order-hours__day">
            <legend>{day}</legend>
            {fields.map(([key, label]) => (
              <label key={key} className="field-group">
                {label}
                <input
                  name={key + index}
                  type="time"
                  defaultValue={hours.days[index]?.[key] ?? ""}
                />
              </label>
            ))}
          </fieldset>
        ))}
        <label className="field-group">
          Avisar cuántos minutos antes
          <input
            name="warning"
            type="number"
            min={0}
            max={120}
            required
            defaultValue={hours.warningMinutes}
          />
        </label>
        <label>
          <input name="paused" type="checkbox" defaultChecked={hours.paused} />{" "}
          Pausar todos los pedidos hasta que vuelva a habilitarlos
        </label>
        <button
          className="button button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Guardando…" : "Guardar horarios"}
        </button>
        {message ? <p role="status">{message}</p> : null}
      </form>
    </details>
  );
}
