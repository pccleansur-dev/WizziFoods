# Producción por sector (T20)

Cada ítem de un pedido confirmado llega a la pantalla de Cocina o de Barra según el
sector de producción de su producto, y avanza **En cola → En preparación → Listo**. El
estado del pedido completo se deriva de sus ítems. **Entregar, faltantes y cancelaciones
son de T21; la cuenta y el ledger son de T22**: esta etapa no mueve dinero ni toca un
pedido confirmado.

## Qué ve cada pantalla

- Ruta `/interno/<negocio>/operacion/produccion` (API `GET /v1/staff/production`). El
  sector sale **solo de la sesión**: Cocina ve los ítems de sectores `kitchen` de la
  carta publicada; Barra, los `bar`. Un cuerpo, parámetro o cabecera no elige sector,
  negocio, ubicación ni rol (la API los rechaza con 400).
- Una comanda por pedido: sólo con los ítems del propio sector, más el estado del
  pedido completo («Pedido completo: …») sin mostrar los ítems del otro sector.
- Nunca aparece un pedido sin confirmar: no hay fila de producción hasta que el Mozo
  confirma (intención o comanda manual). Una intención `awaiting_waiter` o
  `payment_pending` no genera nada.
- Orden: pendientes primero, del más antiguo al más nuevo; los terminados quedan al
  final (se conservan los 10 más recientes). Se actualiza por polling cada 5 s
  mientras la pestaña es visible; Realtime queda para T31.
- Mozo, Encargado y personal de otro negocio reciben 403 (`PT200` en SQL).

## Estados e ítems

`private.production_items` (una fila por ítem confirmado, clave = el ítem) guarda
`status`, `sector_kind` (`kitchen`/`bar`/`other`, tomado de la revisión de carta con la
que se confirmó el pedido) y sus marcas de tiempo. Los pedidos confirmados siguen
siendo append-only (T19); por eso los estados viven en tablas nuevas.

- Un trigger `AFTER INSERT` sobre `confirmed_order_items` crea la fila `queued`. La
  clave hace imposible duplicarla: reintentar la confirmación devuelve el resultado
  guardado (`waiter_commands`) y nunca llega al trigger. La migración también cubre los
  pedidos confirmados antes de T20.
- Sólo se avanza **un paso**: `queued → preparing → ready`. Saltar, volver atrás o
  pedir otro destino falla (`409 PRODUCTION_TRANSITION_INVALID`, `PT220`). Una fila no
  se borra ni cambia otra cosa que su estado (`PT209`).
- Orden derivado: todos `ready` → Listo; todos `queued` → En cola; si no, En preparación.
- Los sectores `other` (catálogo) no tienen pantalla todavía: sus ítems quedan en cola.

## Avanzar un ítem

`POST /v1/staff/production/orders/:orderId/items/:lineId/status` con
`{ commandId, status: "preparing" | "ready" }`.

- El ítem debe ser del sector del propio usuario; si no, `404 PRODUCTION_ITEM_NOT_FOUND`
  (sin distinguir «no existe» de «es de otro sector»).
- **Idempotente de tres maneras:** el mismo `commandId` devuelve el resultado guardado y
  no repite el evento; otro comando que pide el estado que el ítem ya tiene no cambia
  nada (`changed: false`, útil con dos pantallas o tras una reconexión); el bloqueo de
  fila serializa dos pantallas. Reutilizar un `commandId` con otros datos es
  `409 WAITER_COMMAND_REUSED`.
- Cada paso real queda en `private.production_item_events` (append-only: estado
  anterior y nuevo, quién y qué comando) y en la auditoría
  (`production.item_advanced`, sin datos del pedido).
- La web genera un `commandId` por ítem y paso y lo conserva hasta recibir una
  respuesta definitiva; un reintento tras un resultado desconocido lo reutiliza.

## Verificación

```powershell
Get-Content -Raw supabase/tests/database/production.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm --filter @platform/api exec vitest run src/production   # con DATABASE_URL, DATABASE_ADMIN_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
pnpm e2e                                                      # 3100/3101; production.spec.ts
```

- pgTap `production.test.sql`: 47 aserciones con dos negocios (enrutamiento, permisos,
  intenciones sin confirmar, reintentos, transiciones, historial inmutable, auditoría).
- Integración HTTP con dos negocios, Cocina y Barra y seis avances simultáneos del mismo
  comando.
- Playwright (móvil 375 px y escritorio): el comensal pide un plato y una bebida, el Mozo
  confirma y cada pantalla ve sólo lo suyo y avanza sus ítems hasta «Pedido completo:
  Listo».

Migración `20261024100000_create_production.sql` (se aplica con `supabase_admin`).
Rollback: `supabase/rollbacks/20261024100000_create_production.down.sql` (destructivo
para los estados y su historial; sólo antes de operar de verdad).

## Límites conocidos

- Sin «Entregado», faltantes, reemplazos ni cancelaciones (T21).
- Los sectores `other` no tienen pantalla; el Encargado no ve ni mueve producción.
- Polling cada 5 s; Realtime y reconexión avanzada son de T31.
- Los tests de integración que apagan los triggers append-only de otras tablas deben
  hacerlo sólo en su sesión (`session_replication_role = replica` dentro de una
  transacción); apagarlos con `ALTER TABLE` rompe a otros archivos que corren en
  paralelo.
