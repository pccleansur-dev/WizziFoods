import type {
  CatalogDraft,
  LocalizedCatalogContent,
  WaiterInPersonMethod,
  WaiterSalonUnit,
  WaiterSalonView,
  WaiterTableState
} from "@platform/contracts";

const stateLabels: Record<WaiterTableState, string> = {
  available: "Disponible",
  needs_cleaning: "Pendiente de limpieza",
  occupied: "Ocupada",
  out_of_service: "Fuera de servicio"
};

const methodLabels: Record<WaiterInPersonMethod, string> = {
  cash: "Efectivo",
  credit_card: "Tarjeta de crédito",
  debit_card: "Tarjeta de débito",
  other_in_person: "Otro medio presencial"
};

export function tableStateLabel(state: WaiterTableState): string {
  return stateLabels[state];
}

export function paymentMethodLabel(method: WaiterInPersonMethod): string {
  return methodLabels[method];
}

const collator = new Intl.Collator("es", { numeric: true });

/** Floors in plan order; tables with calls first, then natural numeric order. */
export function groupUnitsByFloor(
  view: WaiterSalonView
): { floor: WaiterSalonView["floors"][number]; units: WaiterSalonUnit[] }[] {
  return view.floors
    .map((floor) => ({
      floor,
      units: view.units
        .filter((unit) => unit.floorId === floor.id)
        .sort(
          (left, right) =>
            Number(right.openCalls > 0) - Number(left.openCalls > 0) ||
            collator.compare(left.label, right.label)
        )
    }))
    .filter((group) => group.units.length > 0);
}

export function callAgeLabel(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

const errorMessages: Record<string, string> = {
  CALL_ALREADY_CLAIMED: "Otro mozo ya tomó este llamado.",
  CALL_CLOSED: "Este llamado ya está cerrado.",
  CASH_REGISTER_ALREADY_OPEN: "La caja ya está abierta.",
  CASH_REGISTER_CLOSED:
    "La caja está cerrada. El Encargado tiene que abrirla para cobrar.",
  INTENT_ALREADY_DECIDED: "Este pedido ya fue confirmado o rechazado.",
  INTENT_NOT_CONFIRMABLE:
    "Este pedido espera un pago online y no se confirma desde el salón.",
  INVALID_WAITER_REQUEST: "Revisá los datos de la operación.",
  MENU_PRICE_CHANGED:
    "Los precios de la carta cambiaron. Pedí al comensal que revise el pedido.",
  ORDER_ITEMS_CHANGED:
    "La disponibilidad de la carta cambió. Revisá el pedido.",
  ACCOUNT_NOT_FOUND: "No encontramos esa cuenta en tu zona.",
  ADJUSTMENT_ALREADY_DECIDED:
    "Ese reemplazo ya fue decidido o ya hay uno pendiente.",
  DISCOUNT_TOO_LARGE: "El descuento supera el saldo pendiente.",
  INVALID_ACCOUNT_REQUEST: "Revisá los datos de la operación.",
  INVALID_CASH_REGISTER_REQUEST: "Revisá los datos de la operación.",
  INVALID_ORDER_ADJUSTMENT_REQUEST: "Revisá los datos de la operación.",
  ITEM_NOT_READY: "Solo se entrega un ítem que ya está listo.",
  MANAGER_REQUIRED: "Esta decisión la toma el Encargado.",
  NOTHING_TO_COLLECT: "La cuenta no tiene saldo pendiente para cobrar.",
  REFUND_EXCEEDS_LIMIT:
    "La devolución supera el saldo a favor o lo cobrado en ese pago.",
  PAYMENT_EXCEEDS_PENDING:
    "El cobro supera el saldo pendiente. Actualizá la cuenta.",
  ORDER_TARGET_NOT_FOUND: "No encontramos ese pedido o ítem en tu zona.",
  PRODUCTION_ITEM_NOT_FOUND: "No encontramos ese ítem en tu sector.",
  PRODUCTION_TRANSITION_INVALID:
    "El ítem no puede pasar a ese estado. Actualizá la pantalla.",
  STAFF_FORBIDDEN: "Tu rol no puede realizar esta operación.",
  STAFF_SESSION_INVALID:
    "Tu sesión venció. Volvé a ingresar con tu usuario y PIN.",
  STOCK_INSUFFICIENT: "No alcanza el stock para confirmar este pedido.",
  TABLE_NOT_ENABLED: "La mesa no está habilitada para recibir pedidos.",
  WAITER_COMMAND_REUSED:
    "Esa operación ya se usó con otros datos. Volvé a intentarlo.",
  WAITER_TARGET_NOT_FOUND:
    "No encontramos esa mesa, pedido o llamado en tu zona."
};

export function waiterErrorMessage(code: unknown): string {
  return (
    (typeof code === "string" ? errorMessages[code] : undefined) ??
    "No pudimos completar la operación. Intentá nuevamente."
  );
}

export function waiterErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export type WaiterMenuProduct = {
  categoryTitle: string;
  id: string;
  priceCents: number;
  title: string;
  variants: { id: string; priceDeltaCents: number; title: string }[];
};

function localizedTitle(content: LocalizedCatalogContent[]): string {
  return (
    (content.find((entry) => entry.language === "es") ?? content[0])?.title ??
    ""
  );
}

/** Display-only menu for manual orders: the server prices every line again. */
export function buildWaiterMenu(
  catalog: CatalogDraft,
  availability: Record<string, { isAvailable: boolean; version?: number }>
): WaiterMenuProduct[] {
  const categories = new Map(
    catalog.categories.map((category) => [
      category.id,
      localizedTitle(category.content)
    ])
  );
  return [...catalog.products]
    .filter((product) => availability[product.id]?.isAvailable !== false)
    .sort((left, right) => left.position - right.position)
    .map((product) => ({
      categoryTitle: categories.get(product.categoryId) ?? "",
      id: product.id,
      priceCents: product.priceCents,
      title: localizedTitle(product.content),
      variants: [...product.variants]
        .sort((left, right) => left.position - right.position)
        .map((variant) => ({
          id: variant.id,
          priceDeltaCents: variant.priceDeltaCents,
          title: localizedTitle(variant.content)
        }))
    }));
}
