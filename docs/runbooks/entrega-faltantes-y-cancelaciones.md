# Entrega, faltantes y cancelaciones (T21)

Un pedido confirmado sigue su curso ítem por ítem: producción lo deja **Listo**, el Mozo
lo marca **Entregado**, y si algo no se puede hacer se registra un **faltante** que se
resuelve con un **reemplazo** aceptado por el comensal o con una **cancelación** del
Encargado. Nada reescribe el pedido confirmado ni devuelve stock: lo ya consumido no se
borra. La cuenta (T22) lee estos ajustes.

## Estados de un ítem

`private.production_items` (estado) y `production_item_events` (historial, append-only):

`En cola → En preparación → Listo → Entregado`, más `Faltante`, `Cancelado` y
`Reemplazado`. Un ítem sólo da pasos documentados (`PT209` si se intenta otro):

| Desde                               | Hasta          | Quién                                    |
| ----------------------------------- | -------------- | ---------------------------------------- |
| En cola                             | En preparación | Cocina o Barra (su sector)               |
| En preparación                      | Listo          | Cocina o Barra                           |
| Listo                               | Entregado      | Mozo de la mesa, o Encargado             |
| En cola / En preparación            | Faltante       | Cocina o Barra, con motivo               |
| En cola / En preparación / Faltante | Cancelado      | Sólo Encargado, con motivo               |
| Faltante                            | Reemplazado    | Mozo o Encargado, al aceptar el comensal |

El estado del pedido se deriva (`private.production_status_of`): cancelados y
reemplazados quedan fuera; un faltante abierto manda («Hay un faltante»); si no, todo
entregado → Entregado, todo listo o entregado → Listo, todo en cola → En cola, y si no
En preparación.

## Matriz de permisos

| Operación            | Ruta                                                                | Capacidad             | Quién                               |
| -------------------- | ------------------------------------------------------------------- | --------------------- | ----------------------------------- |
| Ver pedidos en curso | `GET /v1/staff/orders/in-progress`                                  | `tables.serve`        | Mozo (sus mesas), Encargado (todas) |
| Entregar             | `POST /v1/staff/orders/:orderId/items/:lineId/delivery`             | `tables.serve`        | Mozo de la mesa, Encargado          |
| Informar faltante    | `POST /v1/staff/production/orders/:orderId/items/:lineId/exception` | `production.*.manage` | Cocina o Barra, sólo su sector      |
| Proponer reemplazo   | `POST /v1/staff/orders/:orderId/items/:lineId/replacement`          | `orders.manage`       | Mozo de la mesa, Encargado          |
| Decidir reemplazo    | `POST /v1/staff/order-adjustments/:adjustmentId/decision`           | `orders.manage`       | Mozo de la mesa, Encargado          |
| Cancelar             | `POST /v1/staff/orders/:orderId/items/:lineId/cancellation`         | `operations.approve`  | Sólo Encargado                      |

Siempre con la sesión del Bearer: el cuerpo no puede traer negocio, ubicación, rol,
precio ni total (400). SQL vuelve a comprobar empleado activo, rol y sector (`PT200`
sin permiso, `PT201` fuera de tu zona o de otro negocio, `PT222` si cancela un rol que
no es Encargado). Cocina y Barra no entregan ni cancelan; el Mozo no informa faltantes ni
cancela. La figura de _Administrador_ del negocio no usa esta pantalla de personal: el
Encargado es quien decide.

## Entregar

Sólo un ítem **Listo** (`409 ITEM_NOT_READY`, `PT221`, si no). Es idempotente: el mismo
comando devuelve el resultado guardado; otro comando sobre un ítem ya entregado no
cambia nada (`changed: false`).

## Faltante, reemplazo y cancelación

1. **Faltante.** Cocina/Barra informan el motivo (obligatorio). El ítem pasa a `Faltante`
   y conserva su consumo y su stock; el pedido pasa a «Hay un faltante».
2. **Reemplazo.** El Mozo elige un producto de la carta vigente (el precio sale del
   servidor, nunca del cliente). Se crea una propuesta en `private.order_adjustments`
   con el total original, el del reemplazo y la **diferencia económica**. Mientras no hay
   respuesta no cambia nada. Un ítem tiene a lo sumo una propuesta abierta
   (`409 ADJUSTMENT_ALREADY_DECIDED`).
   - **Acepta:** se re-cotiza contra la carta (si el precio cambió desde la propuesta,
     `409 MENU_PRICE_CHANGED`), se reserva su stock, se agrega el reemplazo como ítem
     nuevo en cola, el original queda `Reemplazado` y la propuesta `accepted` con la
     línea vinculada.
   - **Rechaza:** motivo obligatorio; el faltante sigue abierto para otra propuesta o una
     cancelación.
3. **Cancelación.** Sólo el Encargado, con motivo, sobre un ítem en cola, en preparación
   o con faltante. Registra un ajuste `cancellation` con diferencia negativa igual al
   total del ítem. Un ítem listo o entregado no se cancela.

`order_adjustments` se decide una sola vez y no se reescribe ni se borra (`PT209`). Un
ítem se resuelve a lo sumo una vez. Todo queda auditado (`order_item.delivered`,
`production.exception_reported`, `order_item.replacement_proposed|accepted|rejected`,
`order_item.cancelled`), sin motivos libres ni credenciales en la auditoría.

## Pantallas

- **Mozo / Encargado:** `/interno/<negocio>/operacion/salon?vista=pedidos` («Pedidos en
  curso»). Se actualiza cada 5 s. Cada ítem muestra su estado y las acciones que le
  corresponden a quien mira (Entregar, Proponer reemplazo, «El comensal acepta / rechaza»,
  «Cancelar ítem…» sólo Encargado). La pestaña marca cuántos ítems necesitan atención.
  Cerrar el aviso de «Pedido confirmado» no cancela nada.
- **Cocina / Barra:** `/interno/<negocio>/operacion/produccion`. Además de avanzar el
  ítem, «Faltante…» pide el motivo y lo informa.

## Verificación

```powershell
Get-Content -Raw supabase/tests/database/order_adjustments.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm --filter @platform/api exec vitest run src/order-adjustments   # con DATABASE_URL, DATABASE_ADMIN_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
pnpm e2e                                                              # 3100/3101; order-adjustments.spec.ts
```

- pgTap `order_adjustments.test.sql`: 76 aserciones con dos negocios (matriz de
  permisos y estados, entrega, faltante, reemplazo con precio cambiado, cancelación,
  historial inmutable, auditoría).
- Integración HTTP con dos negocios y seis entregas simultáneas del mismo comando, y tres
  decisiones simultáneas de un mismo reemplazo.
- Playwright (móvil 375 px y escritorio): faltante → reemplazo aceptado → entrega, y
  faltante → cancelación del Encargado.

Migración `20261024110000_create_order_adjustments.sql`; rollback en
`supabase/rollbacks/20261024110000_create_order_adjustments.down.sql` (destructivo; sólo
antes de operar de verdad).

## Límites conocidos

- El comensal no acepta desde su teléfono: el Mozo registra su respuesta (queda con
  actor y fecha). Aceptación directa del comensal es una mejora posterior.
- Los ítems de sectores `other` no tienen pantalla de producción: sólo se cancelan.
- Cancelar o reemplazar no devuelve stock operativo (se conserva el consumo).
- No hay devolución de dinero acá: el ajuste baja el consumo de la cuenta (T22) y el
  reintegro presencial es de T23.
