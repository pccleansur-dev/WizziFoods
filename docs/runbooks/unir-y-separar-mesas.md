# Unir y separar mesas durante el servicio (T27)

Unir mesas arma un grupo temporal; separarlas lo disuelve. En ambos casos **los pedidos, los pagos y la
deuda no se mueven**: sólo cambia qué mesas cubre la cuenta abierta y el estado de las mesas liberadas.
Cada mesa conserva su id y su QR físico.

## Qué cambia y qué no

| Cambia                                                                  | Nunca cambia                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `floor_groups` / `floor_group_members` (quién está agrupado)            | `confirmed_orders` (cada pedido conserva su mesa de origen) |
| `table_sessions.scope_key`, `group_id`, `table_id` de la sesión abierta | `account_entries` (el libro: cobros, descuentos, propinas)  |
| `floor_table_service_states` de las mesas que entran o se liberan       | El id de la sesión, su saldo y su historial                 |
| La versión del plano (`floor_plans.version`, ver «El editor del plano») | Los QR (token y mesa)                                       |

Una sesión **cerrada** no se toca nunca: su comprobante ya guarda las mesas de ese momento.

## Unir (`private.join_tables`)

`POST /v1/staff/table-groups` con `{ commandId, tableIds, name? }` (2 a 20 mesas distintas, nombre de hasta
60 caracteres; cualquier otro campo es 400). Necesita `tables.serve` y que el usuario **sirva todas las
mesas** (el Encargado sirve todas).

- Las mesas deben estar en la **misma planta** y no estar **pendientes de limpieza ni fuera de servicio**
  (`PT277`). Si una mesa elegida ya pertenece a un grupo, entra **todo** ese grupo; si se eligen mesas de
  varios grupos, se funden en el primero (por posición) y los demás desaparecen.
- **Cuentas distintas no se mezclan**: si entre las mesas (o sus grupos) hay **más de una** cuenta abierta,
  responde `409 DIFFERENT_OPEN_ACCOUNTS` (`PT278`) y no cambia nada. Con una sola cuenta abierta, esa cuenta
  **sigue al grupo** (`scope_key` y `group_id` pasan al grupo) y las mesas que se suman pasan a Ocupada.
  Sin cuentas abiertas no se abre ninguna: la primera confirmación abre una sola para todo el grupo.
- Sin nombre, el grupo se llama «Mesas 1 + 2». «Ya están juntas» o una mesa que no se puede unir también
  es `409 TABLES_CANNOT_BE_JOINED`.

## Separar (`private.separate_tables`)

`POST /v1/staff/table-groups/:groupId/separate` con `{ commandId, anchorTableId? }`. Disuelve **todo** el
grupo.

- Con una **cuenta abierta**, `anchorTableId` es obligatorio y debe ser una mesa del grupo
  (`409 ANCHOR_TABLE_REQUIRED`, `PT279`): la sesión se queda con esa **mesa ancla** (`table_id`,
  `scope_key = ancla`, sin grupo). Es la misma sesión, con el mismo saldo.
- Las demás mesas se liberan **según su estado**: una mesa que sólo estaba Ocupada por la cuenta vuelve a
  **Disponible**; una Pendiente de limpieza o Fuera de servicio **conserva** ese estado (no se pisa).
- Sin cuenta abierta (por ejemplo, el grupo ya cerró), no hace falta ancla y ningún estado cambia.
- Los pedidos que se hicieron desde una mesa liberada siguen siendo de esa cuenta y muestran su mesa de
  origen. Un pedido nuevo en la mesa liberada abre **otra** cuenta, independiente.
- Un grupo que no existe (o que el usuario no sirve por completo) responde `404 TABLE_GROUP_NOT_FOUND`.

Ambas operaciones son idempotentes por `commandId` (`private.waiter_commands`; el mismo comando con otros
datos es `409 WAITER_COMMAND_REUSED`), quedan en la tabla de historia `private.table_group_events`
(append-only: quién, cuándo, mesas, ancla, mesas liberadas, cuenta involucrada) y se auditan como
`table_group.joined` y `table_group.separated`.

## QR

Los QR no cambian. `private.resolve_table_entry` y la sesión por QR leen el grupo vigente en cada
escaneo, y la página `/m/[token]` se actualiza sola (`EntryRefresh`): después de unir, cualquier QR del
grupo dice «Estás en Cumple (mesas 1 y 2)» y lleva a la misma cuenta; después de separar, el QR de una
mesa liberada ya no muestra grupo ni cuenta y puede empezar una nueva.

## Concurrencia

- Un candado de transacción por ubicación (`pg_advisory_xact_lock`, `private.table_groups_lock_key`): unir,
  separar y guardar el plano lo toman **exclusivo**; abrir una sesión (`ensure_table_session`) lo toma
  **compartido**. Un pedido que compite con una unión o una separación termina antes o lee el grupo nuevo:
  **nunca** abre una sesión con un alcance viejo. La prueba de integración lo demuestra (si se quita el
  candado compartido, la carrera falla).
- Las sesiones afectadas se toman `for update` en orden de id, junto con cobros y cierres.
- Sólo estas dos funciones pueden cambiar el alcance de una sesión abierta: el guard
  `guard_table_session_change` lo permite únicamente con `private.regroup_session = on`, local a la
  transacción, y mientras nada más cambie (`PT209` en cualquier otro caso).

## El editor del plano

El Administrador sigue pudiendo armar grupos al diseñar el plano (`PUT /v1/tenant/floor-plan`), pero no
puede romper los grupos de una cuenta abierta: un trigger sobre `floor_plans` rechaza (`409
FLOOR_PLAN_GROUP_IN_USE`, `PT280`) un plano en el que una sesión abierta de grupo pierde su grupo o su mesa,
o una cuenta suelta queda dentro de un grupo. Cambiar el **nombre** de un grupo o su geometría sigue
permitido. Unir y separar suben la **versión del plano**: un editor con una versión vieja recibe `409
FLOOR_PLAN_VERSION_CONFLICT` en vez de pisar la agrupación del servicio.

## Pantalla

En **Salón y llamados → Mesas** cada mesa o grupo tiene «Unir con otra mesa» (casilla). Con una mesa
elegida aparece «Unir mesas» con el nombre opcional; no se ofrecen mesas de otra planta, con limpieza
pendiente, fuera de servicio, de otro sector ni una segunda cuenta abierta (el motivo se lee debajo). Un
grupo ofrece «Separar mesas»: si hay cuenta abierta pide elegir con qué mesa queda y explica que los
pedidos, los pagos y el saldo no se mueven.

## Verificación

```powershell
Get-Content -Raw supabase/tests/database/table_regrouping.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm --filter @platform/api exec vitest run --no-file-parallelism src/table-regrouping   # con DATABASE_URL, DATABASE_ADMIN_URL (supabase_admin), SUPABASE_URL, SUPABASE_SECRET_KEY
pnpm e2e e2e/table-regrouping.spec.ts                                                      # 3100/3101
```

- pgTap `table_regrouping.test.sql` (85 aserciones, dos negocios): permisos, selección inválida, unión sin y
  con cuenta, fusión de cuentas distintas rechazada, anclas, estados liberados, QR, libro y pedidos sin
  moverse, historia, auditoría, el editor del plano y el guard de la sesión.
- Integración HTTP (`local-table-regrouping.integration.test.ts`): ocho uniones simultáneas → un grupo;
  el mismo comando seis veces; seis separaciones simultáneas → una gana; unión contra pedidos, contra un
  cobro y contra un cierre sin dejar sesiones con alcance viejo. La API se prueba **en serie**
  (`--no-file-parallelism`) por el pool de Supavisor. `DATABASE_ADMIN_URL` debe ser el dueño de las tablas
  (`supabase_admin.<tenant>`).
- Playwright (móvil 375 px y escritorio, 3100/3101): unir → consumir → pagar parcial → separar → nueva
  sesión. La caja de la demo y del E2E empieza **cerrada**; Marta (PIN 246810) la abre desde Caja.

Los limpiadores de pruebas que borran `table_sessions` deben borrar antes `table_group_events` (junto con
`cashier_requests`, `account_receipts` y `receipt_counters`, dentro de una transacción con
`set local session_replication_role = replica`).

Migración `20261027020000_regroup_tables.sql`; rollback en
`supabase/rollbacks/20261027020000_regroup_tables.down.sql` (destructivo sólo para la historia
`table_group_events`; los grupos, las sesiones y el libro quedan como están). Probada aplicar → revertir →
reaplicar, con los pgTap vecinos verdes después de cada paso.

## Límites conocidos

- Separar disuelve todo el grupo; no hay «sacar una mesa» de un grupo de tres.
- Una cuenta cerrada que perteneció a un grupo ya disuelto sólo muestra, para el personal, la mesa que
  guardó la sesión; el comprobante conserva todas las mesas de ese momento.
- La regla «misma planta» y «sin limpieza pendiente» se aplica sólo a las mesas que entran: un grupo ya
  armado con una mesa averiada puede seguir creciendo.
- La confirmación del comensal («¿unirse a la cuenta del grupo?») no existe: unir y separar es decisión del
  personal.
