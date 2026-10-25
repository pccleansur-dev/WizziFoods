# Operación del salón (T19)

El Mozo (y el Encargado) ven el salón en vivo, toman los llamados que dejó T18, validan
o rechazan la intención del comensal y cargan comandas manuales. **Confirmar un pedido
no cobra**. Desde T20 el pedido confirmado llega a Cocina y Barra
(`docs/runbooks/produccion-por-sector.md`), desde T21 se entrega ítem por ítem
(`docs/runbooks/entrega-faltantes-y-cancelaciones.md`) y desde T22 abre la cuenta de la mesa
(`docs/runbooks/cuenta-de-mesa.md`); cobrar sigue siendo una decisión aparte.

## Identidad y alcance

- Rutas `GET /v1/staff/salon`, `GET /v1/staff/menu`, `POST /v1/staff/calls/:callId/claim`,
  `POST /v1/staff/order-intents/:intentId/decisions` y `POST /v1/staff/orders`.
- `StaffSessionGuard` resuelve la sesión opaca del `Authorization: Bearer` **en cada
  solicitud** (revocada, vencida o desactivada deja de funcionar al instante). Tenant,
  ubicación, empleado, rol y capacidades salen sólo de esa sesión; ningún cuerpo,
  parámetro o cabecera los elige. Los contratos son estrictos y rechazan `tenantId`,
  `locationId`, `staffId`, `role`, precios, totales o medios de pago (400).
- Capacidades por endpoint: `tables.serve` (salón), `calls.manage` (reclamar),
  `orders.validate` (decidir), `orders.manage` (comanda y carta). Cocina y Barra no
  tienen ninguna → 403.
- Defensa en profundidad en SQL: cada función vuelve a comprobar empleado activo de la
  ubicación, rol `waiter`/`manager` (`PT200`) y que la mesa esté en su alcance (`PT201`,
  sin distinguir «no existe» de «no es tuya»). Un Encargado ve todo el local; un Mozo sólo
  las mesas de los sectores de `staff_sector_assignments`. El Encargado nunca amplía el
  alcance de un Mozo.

## Vista viva

`private.waiter_salon_view` devuelve plantas, unidades (mesa o grupo), llamados abiertos o
tomados e intenciones `awaiting_waiter`. La web consulta cada 5 s mientras la pestaña es
visible y al volver a ella (`/interno/<tenant>/operacion/vista`); es polling autoritativo,
Realtime queda para T31. Un fallo de red conserva la última lectura y lo dice.

- **Grupos:** se muestran como una sola unidad («Mesas 2 + 3») con un solo estado
  (ocupada > pendiente de limpieza > fuera de servicio > disponible). El grupo aparece si
  alguna de sus mesas está en el alcance del Mozo, pero **los llamados, las intenciones y
  las operaciones sólo cubren las mesas dentro de su alcance**; las demás se marcan
  «otro sector».
- **Unir y separar:** cada mesa o grupo ofrece «Unir con otra mesa» y los grupos «Separar mesas»
  (T27, `unir-y-separar-mesas.md`). Una cuenta abierta sigue al grupo; al separar se elige la mesa
  ancla; los pedidos, los pagos y el saldo no se mueven.
- Cada unidad muestra su sesión y su saldo derivado del libro («Cuenta abierta · Saldo
  $ …») o «Sin cuenta abierta»; confirmar un pedido deja la mesa Ocupada (T22).
- Un pago online pendiente (Mercado Pago, `payment_pending`) **nunca** aparece: la vista
  sólo lista `awaiting_waiter`.

## Llamados

Reclamar (`open → acknowledged`) bloquea la fila: de dos Mozos simultáneos gana uno y el
otro recibe `409 CALL_ALREADY_CLAIMED`. Repetir el mismo `commandId` devuelve el mismo
resultado; reclamar tu propio llamado de nuevo es idempotente. Un llamado tomado por otro
Mozo sólo lo resuelve ese Mozo o un Encargado.

## Decidir una intención

`POST …/decisions` con `{ commandId, decision: "confirm"|"reject", reason }`. Rechazar
exige motivo (`reason` es `null` al confirmar). Dentro de una transacción se bloquea la
intención, el llamado, la disponibilidad y el stock opcional:

- **Confirmar** vuelve a validar mesa habilitada, producto en la carta vigente, variante,
  disponibilidad y **precio**. Si el precio publicado cambió desde que el comensal pidió
  responde `409 MENU_PRICE_CHANGED` (no cobra un importe distinto sin que el comensal
  lo acepte). Si hay stock operativo lo descuenta con `FOR UPDATE`; si no alcanza,
  `409 STOCK_INSUFFICIENT` sin cambios. Crea `confirmed_orders` + `confirmed_order_items`
  y cierra el llamado.
- **Rechazar** cancela el llamado y deja la intención `rejected`.
- Una intención ya decidida responde `409 INTENT_ALREADY_DECIDED`; una `payment_pending`,
  `409 INTENT_NOT_CONFIRMABLE` (además lo impide un `check` de la tabla).
- Todo queda en `order_intent_decisions` y en la auditoría (`order.confirmed`,
  `order_intent.rejected`, `waiter_call.claimed`). La auditoría **no** contiene el motivo
  libre, PIN ni tokens.

## Comanda manual

`POST /v1/staff/orders` con `{ commandId, tableId, attribution, dinerName, seatLabel,
items }`. Atribución a la mesa (nombre y silla opcionales) o a una persona (ambos
obligatorios). El servidor resuelve título, precio, sector de producción y total desde
la carta publicada (`private.quote_and_reserve_lines`); un precio enviado es 400. La mesa
debe estar disponible u ocupada (y aceptar mesas nuevas si estaba libre); pendiente de
limpieza o fuera de servicio responde `409 TABLE_NOT_ENABLED` — habilitarla es de T26 (hecho: «Marcar limpia», ver `cierre-limpieza-y-comprobante.md`).

## Idempotencia y append-only

`private.waiter_commands` guarda `(tenant, ubicación, empleado, commandId)` con el
resultado: dos solicitudes idénticas simultáneas esperan la misma fila y reciben el
mismo resultado; reutilizar el id con otros datos es `409 WAITER_COMMAND_REUSED`. La
web genera un `commandId` por payload y lo reutiliza al reintentar.
`confirmed_orders`, `confirmed_order_items` y `order_intent_decisions` rechazan
`UPDATE`/`DELETE`/`TRUNCATE` (`PT209`); una intención sólo puede pasar una vez de
`awaiting_waiter` a `confirmed`/`rejected` sin cambiar nada más.

## Resultado y decisiones posteriores

El resultado de un pedido confirmado lleva `payment: { state: "not_recorded" }` y
`accountDecision: "pending"`. La pantalla muestra «Cobrar ahora» y «Dejar cuenta abierta»
como decisiones **separadas y posteriores** a la confirmación (habilitadas desde T22 sobre
la cuenta de la mesa); cerrar el aviso no cancela el pedido.

## Verificación

```powershell
Get-Content -Raw supabase/tests/database/waiter_operations.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm --filter @platform/api exec vitest run src/waiter   # con DATABASE_URL, DATABASE_ADMIN_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
pnpm e2e                                                  # 3100/3101; waiter-operations.spec.ts
```

- pgTap `waiter_operations.test.sql`: 71 aserciones con dos tenants.
- Integración HTTP con dos tenants y dos Mozos concurrentes (reclamo, decisión, stock,
  reintento idéntico, Mercado Pago, comanda manual, sesión revocada).
- Playwright móvil (375 px) y escritorio: cliente → llamado → Mozo → pedido confirmado.

Migración `20261024090000_create_waiter_operations.sql`; se aplica con `supabase_admin`
(dueño de las tablas de T18). Rollback: `supabase/rollbacks/20261024090000_create_waiter_operations.down.sql`
(destructivo para pedidos confirmados y decisiones; sólo antes de operar de verdad).

## Límites conocidos

- **No hay todavía un «Llamar al mozo» genérico** del comensal (mesa sólo-carta): el
  único llamado es `order_validation` de T18.
- Con stock en cero la confirmación se rechaza, pero no se apaga la disponibilidad del
  producto (esa tabla exige un miembro administrador como autor).
- La vista se actualiza por polling cada 5 s; Realtime es de T31.
