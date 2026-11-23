"use client";

import type { OrderServiceHours } from "@platform/contracts";
import { startTransition, useActionState, useRef, useState } from "react";
import { saveOrderHours } from "./order-hours-actions";

const week = [
  ["Lun", "Lunes"],
  ["Mar", "Martes"],
  ["Mié", "Miércoles"],
  ["Jue", "Jueves"],
  ["Vie", "Viernes"],
  ["Sáb", "Sábado"],
  ["Dom", "Domingo"]
] as const;
const fields = [
  ["opens", "Apertura"],
  ["orders", "Cierre de pedidos"],
  ["kitchen", "Cierre de cocina"],
  ["bar", "Cierre de barra"]
] as const;
const emptyDay = { opens: "", orders: "", kitchen: null, bar: null };

export function OrderHoursForm({ hours }: { hours: OrderServiceHours }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [draft, setDraft] = useState(hours);
  const [result, save, pending] = useActionState(saveOrderHours, {
    hours,
    message: ""
  });
  const selectedDay = draft.days[dayIndex] ?? emptyDay;
  const scheduledDays = result.hours.days.filter(Boolean).length;

  return (
    <div className="profile-form order-hours">
      <div>
        <h2>Horarios de pedidos</h2>
        <p>
          {result.hours.paused
            ? "Pedidos pausados"
            : scheduledDays
              ? scheduledDays === 1
                ? "1 día configurado"
                : scheduledDays + " días configurados"
              : "Sin horario configurado"}
        </p>
      </div>
      <button
        className="button button--secondary"
        aria-haspopup="dialog"
        type="button"
        onClick={() => {
          setDraft(result.hours);
          dialog.current?.showModal();
        }}
      >
        Editar horarios
      </button>

      <dialog
        className="order-hours__dialog"
        aria-labelledby="order-hours-title"
        ref={dialog}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form
          className="order-hours__form"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => save(draft));
          }}
        >
          <h2 id="order-hours-title">Horarios de pedidos</h2>
          <fieldset className="order-hours__week" disabled={pending}>
            <legend className="visually-hidden">Día para editar</legend>
            {week.map(([short, day], index) => (
              <button
                key={day}
                type="button"
                aria-label={day}
                aria-pressed={dayIndex === index}
                onClick={() => setDayIndex(index)}
                className="button button--secondary"
              >
                {short}
              </button>
            ))}
          </fieldset>
          <fieldset className="order-hours__day" disabled={pending}>
            <legend>{week[dayIndex]?.[1]}</legend>
            {fields.map(([key, label]) => (
              <label key={key} className="field-group">
                {label}
                <input
                  type="time"
                  value={selectedDay[key] ?? ""}
                  onChange={(event) => {
                    const day = {
                      ...selectedDay,
                      [key]:
                        key === "opens" || key === "orders"
                          ? event.target.value
                          : event.target.value || null
                    };
                    setDraft({
                      ...draft,
                      days: draft.days.map((entry, index) =>
                        index === dayIndex
                          ? Object.values(day).some(Boolean)
                            ? day
                            : null
                          : entry
                      )
                    });
                  }}
                />
              </label>
            ))}
          </fieldset>
          <details className="order-hours__options">
            <summary>Cómo se aplican los horarios</summary>
            <p>
              Un cierre anterior a la apertura corresponde a la madrugada del
              día siguiente. Cocina y barra pueden usar el cierre general. Si
              configurás algún día, los días vacíos quedan cerrados.
            </p>
          </details>
          <label className="order-hours__warning">
            Avisar antes del cierre
            <input
              type="number"
              min={0}
              max={120}
              required
              disabled={pending}
              value={draft.warningMinutes}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  warningMinutes: Number(event.target.value)
                })
              }
            />
            min
          </label>
          <label className="order-hours__pause">
            <input
              type="checkbox"
              checked={draft.paused}
              disabled={pending}
              onChange={(event) =>
                setDraft({ ...draft, paused: event.target.checked })
              }
            />
            Pausar todos los pedidos
          </label>
          {result.message ? <p role="status">{result.message}</p> : null}
          <div className="order-hours__actions">
            <button
              className="button button--secondary"
              type="button"
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              Cerrar
            </button>
            <button
              className="button button--primary"
              type="submit"
              disabled={pending}
            >
              {pending ? "Guardando…" : "Guardar horarios"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
