"use server";

import { parseOrderServiceHours } from "@platform/contracts";
import { adminApi, dataOf } from "../admin-api";

const path = "/v1/tenant/business-profile/order-hours";

export async function loadOrderHours() {
  try {
    const result = await adminApi(path);
    return result.ok ? parseOrderServiceHours(dataOf(result.body)) : null;
  } catch {
    return null;
  }
}

export async function saveOrderHours(_previous: string, form: FormData) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const time = (field: string) => String(form.get(field + index) ?? "");
    const day = {
      opens: time("opens"),
      orders: time("orders"),
      kitchen: time("kitchen") || null,
      bar: time("bar") || null
    };
    return Object.values(day).some(Boolean) ? day : null;
  });
  const settings = parseOrderServiceHours({
    days,
    paused: form.has("paused"),
    warningMinutes: Number(form.get("warning"))
  });
  if (!settings)
    return "Revisá los horarios. Cada día necesita una apertura y un cierre general distintos.";
  try {
    const result = await adminApi(path, { method: "PUT", body: settings });
    return result.ok
      ? "Horarios guardados."
      : (result.message ?? "No se pudieron guardar los horarios.");
  } catch {
    return "No se pudieron guardar los horarios. Volvé a intentar.";
  }
}
