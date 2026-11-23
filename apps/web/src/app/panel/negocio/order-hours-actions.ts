"use server";

import {
  parseOrderServiceHours,
  type OrderServiceHours
} from "@platform/contracts";
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

export async function saveOrderHours(
  previous: { hours: OrderServiceHours; message: string },
  draft: unknown
) {
  const settings = parseOrderServiceHours(draft);
  if (!settings) {
    return {
      ...previous,
      message:
        "Revisá los días editados. Cada uno necesita una apertura y un cierre distintos."
    };
  }
  try {
    const result = await adminApi(path, { method: "PUT", body: settings });
    const saved = result.ok
      ? parseOrderServiceHours(dataOf(result.body))
      : null;
    if (saved) return { hours: saved, message: "Horarios guardados." };
    return { ...previous, message: "No se pudieron guardar los horarios." };
  } catch {
    return {
      ...previous,
      message: "No se pudieron guardar los horarios. Volvé a intentar."
    };
  }
}
