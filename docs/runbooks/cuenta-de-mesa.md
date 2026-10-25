# Cuenta de mesa y libro mayor (T22)

Confirmar el primer pedido de una mesa (o de un grupo de mesas) abre **una sesión de
mesa**, deja la mesa **Ocupada** y cada ítem entra a la cuenta como un movimiento. Todo
lo que toca el dinero de la mesa es un movimiento **inmutable** en
`private.account_entries`: consumido, descuentos, propinas, cobrado y pendiente se
**derivan** del libro, nunca de un campo que alguien pueda reescribir. Caja física, turnos
y arqueo (T23), Mercado Pago (T24) y dividir por persona (T25) no están acá.

## Sesión

- `private.table_sessions`: una abierta por mesa suelta o por grupo (`scope_key` = id del
  grupo o de la mesa; índice único parcial). Dos confirmaciones simultáneas terminan en la
  misma sesión. `confirmed_orders.session_id` la referencia.
- Al abrirla, `floor_table_service_states` pasa la mesa a `occupied`. Una sesión no se borra
  ni se reescribe (`PT209`); sólo puede cerrarse (T26: ver `cierre-limpieza-y-comprobante.md`; cerrar no libera la mesa).
  La única excepción es el alcance de una sesión **abierta** (`scope_key`, `group_id`, `table_id`), que cambian
  sólo unir y separar mesas sin tocar el libro ni los pedidos (T27: `unir-y-separar-mesas.md`).
- Los pedidos confirmados antes de esta migración no tienen cuenta (datos de desarrollo).

## Movimientos

Cada fila de `account_entries` lleva **tenant, ubicación, sesión, actor (o sistema),
origen, causa, moneda (ARS), fuente (ítem, ajuste, cobro o descuento) y el comando** que
la originó. Signo: `charge`, `tip` y `refund` suman lo que la mesa debe; `discount` y
`payment` lo restan; `adjustment` revierte un cargo. Nunca vale cero. Hay un único
movimiento por fuente y tipo: un reintento no puede cargar dos veces un ítem.

| Origen             | Movimiento                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Ítem confirmado    | `charge` por el total del ítem (reemplazos incluidos)                                                       |
| Ítem cancelado     | `adjustment` negativo por el total original (vinculado al ajuste)                                           |
| Reemplazo aceptado | `adjustment` negativo del original + `charge` del reemplazo: la diferencia queda vinculada al ajuste de T21 |
| Descuento          | `discount` negativo, con motivo                                                                             |
| Cobro presencial   | `tip` (si hay propina) y `payment` negativo, con medio                                                      |

**Saldo derivado** (`private.account_summary`): consumido = cargos + ajustes; pendiente =
consumido − descuentos + propinas − cobrado + devuelto. Un ítem cancelado después de
cobrar deja saldo a favor del comensal (pendiente negativo): la devolución es de T23.
`private.verify_account` recalcula el consumo desde los ítems confirmados y sus ajustes,
sin leer el libro, y confirma que coincide.

## Operaciones

| Operación            | Ruta                                           | Capacidad            | Quién                                        |
| -------------------- | ---------------------------------------------- | -------------------- | -------------------------------------------- |
| Ver cuentas abiertas | `GET /v1/staff/accounts`                       | `tables.serve`       | Mozo (sus mesas y grupos), Encargado (todas) |
| Cobrar               | `POST /v1/staff/accounts/:sessionId/payments`  | `payments.collect`   | Mozo, Encargado                              |
| Descuento            | `POST /v1/staff/accounts/:sessionId/discounts` | `operations.approve` | Sólo Encargado                               |
| Dejar cuenta abierta | `POST /v1/staff/accounts/:sessionId/keep-open` | `payments.collect`   | Mozo, Encargado                              |

- **Cobrar:** `{ commandId, method, amountCents | null, tipCents }`. Medios presenciales
  (`cash`, `credit_card`, `debit_card`, `other_in_person`); nunca se pide número, vencimiento
  ni código de tarjeta. `amountCents: null` cobra todo el saldo. La propina es aparte: el
  cobro registrado es monto + propina y el pendiente baja sólo por el monto. Se bloquea la
  sesión: si dos cobran el saldo completo a la vez gana uno y el otro recibe
  `409 NOTHING_TO_COLLECT`. Un monto mayor al pendiente es `409 PAYMENT_EXCEEDS_PENDING`.
- **Descuento:** por monto o por porcentaje del pendiente en puntos básicos, **redondeado al
  centavo hacia arriba en la mitad** (`private.discount_cents_for_percent`); motivo
  obligatorio; mayor al pendiente es `409 DISCOUNT_TOO_LARGE`; un rol que no sea Encargado
  es `403 MANAGER_REQUIRED`.
- **Dejar cuenta abierta:** una decisión propia, separada de confirmar y de cobrar: queda en
  `private.account_decisions` (append-only) y no mueve dinero.
- Todas son idempotentes (`private.waiter_commands`): el mismo comando devuelve el mismo
  resultado y un comando reusado con otros datos es `409 WAITER_COMMAND_REUSED`. Quedan
  auditadas (`account.payment_recorded`, `account.discount_applied`, `account.kept_open`).
- El cuerpo nunca trae total, moneda, tenant ni permisos (400).

## Pantallas

- **Salón:** cada mesa muestra su estado (Ocupada) y «Cuenta abierta · Saldo $ …».
- **Pedido confirmado:** el aviso ya no dice que no hay cuenta: muestra el saldo y ofrece
  «Cobrar ahora» y «Dejar cuenta abierta» como decisiones separadas. «Cobrar ahora» abre el
  formulario de cobro de esa cuenta; cerrar el aviso no cancela nada.
- **Cuentas** (`/interno/<negocio>/operacion/salon?vista=cuentas`): por cuenta, consumido,
  descuentos, propinas, cobrado y pendiente, los movimientos y las acciones. Se actualiza
  cada 5 s.

## Verificación

```powershell
Get-Content -Raw supabase/tests/database/table_accounts.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm --filter @platform/api exec vitest run src/table-accounts   # con DATABASE_URL, DATABASE_ADMIN_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
pnpm e2e                                                          # 3100/3101; table-accounts.spec.ts
```

- pgTap `table_accounts.test.sql`: 88 aserciones con dos negocios (sesión y mesa ocupada,
  cargos, reversos por cancelación y reemplazo, cobros con propina, descuentos, decisión
  de dejar abierta, vista por mozo y grupo, signos, inmutabilidad, auditoría y
  **propiedades de redondeo** sobre miles de combinaciones: nunca excede la base, a lo sumo
  medio centavo de error, monótono, complemento dentro de un centavo).
- Integración HTTP con PostgreSQL: seis reintentos simultáneos de un cobro, tres cobros
  completos concurrentes (gana uno), tres confirmaciones simultáneas en la misma mesa
  (una sesión) y **12 secuencias aleatorias con semilla** (pedidos, cancelaciones,
  reemplazos, cobros y descuentos) contra un modelo independiente: tras cada paso el
  libro coincide con el modelo y `verify_account` da el mismo saldo.
- Playwright (móvil 375 px y escritorio): confirmar → cobrar con propina; cobro parcial,
  descuento del Encargado y dejar abierta; pantalla sin desbordes y con nombres accesibles.

Migración `20261024120000_create_table_accounts.sql` (parchea dos líneas de
`waiter_salon_view`; falla en voz alta si ya no están). Rollback en
`supabase/rollbacks/20261024120000_create_table_accounts.down.sql` (destructivo).

## Límites conocidos

- Sin arqueo, turnos ni caja (T23), sin Mercado Pago (T24), sin cobrar parcialmente por
  persona ni dividir (T25), el cierre de la sesión, la limpieza y el comprobante son de T26 (`cierre-limpieza-y-comprobante.md`).
- Un saldo a favor del comensal (cancelación tras cobrar) se muestra pero no hay
  devolución todavía.
- La vista lista los últimos 60 movimientos por cuenta.
- Tests de integración: no apagar triggers append-only con `ALTER TABLE` (es global y
  rompe archivos que corren en paralelo); usar `set local session_replication_role =
replica` dentro de una transacción y borrar el negocio en una sentencia normal.
