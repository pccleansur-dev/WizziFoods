# Handoff de Fase 4 — Alta: operación y publicación

## Punto de partida

La Fase 3 queda implementada en `chore/workspace-bootstrap` desde `a8c7999`, con
T12 distribuida en estos commits incrementales:

- `6f6f318`: contratos del borrador revisable y validación de fuentes.
- `9c6cdfd`: persistencia, cola, idempotencia y aislamiento SQL.
- `fc99ee1`: procesamiento CSV/XLSX, fallback PDF/imagen y reintentos.
- `e4262e0`: API administrativa y aprobación hacia el borrador de T11.
- `79f9a2d`: carga, revisión, corrección y descarte en el panel.

La migración nueva es
`supabase/migrations/20261023214000_create_catalog_imports.sql`. La única
dependencia de producción agregada es `read-excel-file@9.3.12`, fijada en el
lockfile. El audit de producción no presenta hallazgos altos o críticos; conserva
cuatro bajos y cuatro moderados preexistentes en la cadena Fastify/Nest.

## Estado de T13 — completada

Commits en `chore/workspace-bootstrap`, sobre `dee7294`: contratos y validación de
geometría; persistencia y QR (`20261024010000_create_floor_plan.sql`); repositorio
con resolución de QR por alcance; API administrativa; pruebas de integración con
dos tenants; editor responsive y descargas. Runbook: `docs/runbooks/plano-salon.md`.

Decisiones:

- **Comando de guardado = plano completo.** `PUT /v1/tenant/floor-plan` recibe
  `{ commandId, expectedVersion, plan }`; la base compara contra lo guardado y
  conserva fila, ID y QR de cada mesa que sigue presente. Reintentar el mismo
  `commandId` con el mismo contenido no aplica nada (`applied: false`); el mismo id
  con otro contenido responde 409 `FLOOR_PLAN_COMMAND_REUSED`; una versión vieja
  responde 409 `FLOOR_PLAN_VERSION_CONFLICT`.
- **Sectores del salón ≠ sectores de producción.** Los sectores de T11 (cocina o
  barra, dentro del JSON de la carta) siguen siendo de producción. T13 creó
  sectores propios del salón (`private.floor_sectors`). T14 debe decidir a cuál
  asigna personal; si necesita ambos, referenciar cada uno por separado.
- **Mesas quitadas se retiran, no se borran.** `retired_at` libera el nombre,
  revoca el QR y el ID no puede volver. Un sector sólo se elimina sin mesas
  activas; las agrupaciones se reemplazan completas en cada guardado.
- **QR.** Token de 64 hex (256 bits de `gen_random_uuid`), único, inmutable
  (trigger), con estados `active` y `revoked`. La URL es
  `<scheme>://<host del tenant>/m/<token>` (http sólo para `*.localhost`). Se guarda
  el token y no un hash porque el panel debe poder volver a descargarlo; sólo lo
  leen funciones `security definer` concedidas a `authenticator`. No se registra en
  logs ni en auditoría y no viaja en query strings.
- **Rotación auditada** disponible en SQL y API (`POST
/v1/tenant/floor-plan/tables/:id/qr/rotate`), sin botón en el panel.

Migración: `20261024010000_create_floor_plan.sql` (rollback en `supabase/rollbacks`,
probado aplicar → revertir → reaplicar) y pgTap
`supabase/tests/database/floor_plan.test.sql`. Dependencia nueva:
`qrcode-generator@2.0.4` (sin dependencias ni scripts de instalación), sólo en la
API; `pnpm audit --prod --audit-level high` no reporta hallazgos altos.

### Punto de partida para T14 y T15

- T15 debe leer `FloorPlanRepository.getReadiness(scope)` (mesas activas, mesas con
  QR activo y `ready`) o `private.floor_plan_readiness`; cero mesas o una mesa sin
  QR vigente significa plano incompleto.
- T16 resuelve el QR con `FloorPlanRepository.resolveQr(scope, token)` (o
  `private.resolve_floor_table_qr`) usando el alcance que ya probó el host. Todavía
  no existe la ruta pública `/m/:token`.
- T13 no mueve pedidos, pagos ni sesiones al agrupar o separar: la agrupación es
  sólo plano. T16 en adelante debe definir cómo una sesión de mesa consume
  `floor_group_members`.
- Eventos de auditoría nuevos: `floor_plan.saved` y `floor_table.qr_rotated`.

## Estado de T14 — completada

Commits en `chore/workspace-bootstrap`, sobre `302b4f1`: funciones de equipo y
sectores; medios de pago con regla del último medio y credenciales selladas;
contratos; repositorios; API; prueba de integración con dos tenants; paneles
`/panel/equipo` y `/panel/pagos`; y la corrección de logs de Server Actions.
Runbook: `docs/runbooks/equipo-y-pagos.md`.

Migraciones (con rollback en `supabase/rollbacks`, probadas aplicar → revertir →
reaplicar) y pgTap:

- `20261024030000_create_team_management.sql` → `staff_team.test.sql` (24).
- `20261024031000_create_payment_methods.sql` → `payment_methods.test.sql` (24).

Decisiones:

- **Sectores.** Sólo el Mozo se asigna a sectores del salón
  (`private.staff_sector_assignments` → `private.floor_sectors`). Cocina y Barra no
  se asignan: su rol ya es su sector de producción de T11. Quitar un sector del plano
  borra sus asignaciones (el acceso sólo se reduce). Un Mozo sin sectores no tiene
  mesas asignadas; T16 define el uso.
- **PIN.** Lo fija el Administrador y nunca se devuelve. Restablecerlo, desactivar o
  cambiar el rol revoca las sesiones abiertas. No se puede desactivar ni degradar al
  último Encargado activo de la ubicación (lectura nuestra de la regla de T06).
- **Pagos.** Cinco medios por ubicación, creados al primer uso con efectivo
  habilitado. «Disponible» = habilitado y, en Mercado Pago, con clave pública y
  credencial. La regla del último medio es una función con bloqueo de filas más un
  _constraint trigger_ diferido. La credencial se cifra en la API con
  `PAYMENT_SECRET_KEY` (opcional; sin ella se responde 503) y sólo el _ciphertext_ está
  en SQL; no existe función ni endpoint que lo devuelva.
- **Host.** `apps/web/src/app/panel/admin-api.ts` llama a la API con `tenantFetch`.
  Con él se verificó el recorrido real sin proxy.
- Eventos de auditoría nuevos: `staff.*` (created, role_changed, renamed,
  sectors_changed, deactivated, activated, credential_reset) y `payment_method.*`
  (enabled, disabled, configured, secret_stored, secret_cleared).

### Punto de partida para T15

- Equipo: `TeamRepository.getSummary(scope)` (`activeMembers`, `activeManagers`) o
  `private.staff_team_summary`. Crear empleados **no** es requisito para publicar.
- Pagos: `PaymentMethodsRepository.getReadiness(scope)` (`availableMethods`, `ready`)
  o `private.payment_readiness`; hace falta al menos un medio disponible. Efectivo
  inicia habilitado, así que un negocio nuevo ya lo cumple mientras no lo deshabilite
  con otro medio disponible.
- La simulación de T15 no debe tocar `payment_methods` ni credenciales reales.

## Estado de T15 — completada

Cierra la Fase 4 (el Checkpoint 4 sigue abierto: falta la aprobación humana de
Valentín antes de operar de verdad). Commits en `claude/t15-readiness-8ccee6`, sobre
`6cb1f22`: contratos (`58e9ec7`), matriz y publicación en SQL (`e96d7b0`), circuito
aislado (`6e21314`), repositorio, API, panel `/panel/publicar`, prueba de integración
del alta ficticia y la corrección del panel. Runbook:
`docs/runbooks/publicacion-y-modo-prueba.md`.

Migraciones (con rollback en `supabase/rollbacks`, probadas aplicar → revertir →
reaplicar) y pgTap:

- `20261024050000_create_business_readiness.sql` → `business_readiness.test.sql` (32).
- `20261024051000_create_business_sandbox.sql` → `business_sandbox.test.sql` (26).

Decisiones:

- **La matriz vive en la base.** `private.location_readiness` compone los mismos
  orígenes que T13/T14 (`floor_plan_readiness`, `payment_readiness`,
  `staff_team_summary`) más perfil y carta; el contrato sólo explica y enlaza, y falla
  cerrado ante códigos desconocidos. Siete bloqueos y tres recomendaciones; crear
  empleados no es requisito. Un borrador de carta o una importación sin aprobar nunca
  cuenta como carta.
- **Publicar = una transacción.** `private.publish_location` serializa la ubicación,
  toma `FOR SHARE` sobre perfil, plano, mesas activas y medios de pago, y recién
  entonces revalida. Es la única función que escribe
  `private.location_publications` (una marca por ubicación; sin "despublicar").
  Auditoría `business.published`. No publica la carta ni aprueba importaciones.
- **Modo prueba aislado en la base.** `sandbox_runs/steps/orders`, namespace
  `sandbox`, referencias `SBX-`, sin referencias desde tablas reales, sin privilegios
  para el runtime, sólo lectura de plano y carta, sin tocar `payment_methods` ni
  credenciales. Auditoría con prefijo `sandbox.` para que cualquier métrica o reporte
  de negocio lo excluya (`action not like 'sandbox.%'`).
- **API.** `GET /v1/tenant/readiness`, `POST /v1/tenant/publication`,
  `POST /v1/tenant/sandbox/runs` y `DELETE /v1/tenant/sandbox`; sólo Administrador,
  cuerpo vacío (cualquier campo da 400). El panel valida la vista con
  `parseReadinessView` (reconstruye textos desde la matriz y comprueba `ready`) y llama
  con `tenantFetch` vía `admin-api.ts`.

### Plantas en el plano (posterior a T15)

El plano ahora admite varias plantas (`private.floor_levels`, `floor_tables.level_id`).
Decisiones y reglas en `docs/runbooks/plano-salon.md` (sección «Plantas»): planta y sector
son distintos, las agrupaciones no cruzan plantas, mover una mesa de planta conserva su id y su
QR, y los planos existentes quedaron en una «Planta baja». T16 debería mostrar el nombre de la
planta al resolver el QR (`FloorPlanRepository.resolveQr` aún no la devuelve).

### Estado de T16 — entrada por QR

Hecho: ver `docs/runbooks/entrada-por-qr.md`. `FloorPlanRepository.resolveTableEntry` y
`POST /v1/public/table-entry` son el punto de entrada del comensal; la página es
`/m/[token]`. La tabla `floor_table_service_states` es la única fuente del estado de
mesa y la deben escribir T19/T22/T26. T22 debe colgar la sesión de `group.id` (o de la
mesa) y T22/T27 debe aplicar «no agrupar mesas con cuentas abiertas distintas» (hecho en T27: `PT278`).

### Estado de T17 — carta y borrador privado

Hecho: ver `docs/runbooks/carta-y-borrador-comensal.md`. La selección vive sólo en el
dispositivo y no contiene importes; `POST /v1/public/drafts/recalculate` vuelve a
resolver QR, mesa, carta, variantes y disponibilidad en cada cambio. La UI pública
ofrece Carta, detalle y «Mi pedido», y marca líneas inválidas sin reservar stock.

T18 ya convierte este borrador en una intención validada y vuelve a comprobarlo de
forma atómica. Todavía no existe sesión de mesa ni cuenta (T22), y nada se envía a
producción. El E2E usa una conexión `supabase_admin` sólo para sembrar y limpiar las
tablas locales de catálogo que tienen ese propietario; el runtime sigue usando
`authenticator` y las APIs tenant-scoped.

### Estado de T18 — intención validada y atención presencial

Hecho: ver `docs/runbooks/intenciones-de-pedido.md`. `POST
/v1/public/order-intents` recibe sólo el contrato del comensal y obtiene tenant y
ubicación desde `Host`. `private.create_order_intent` revalida el QR, la mesa, la
publicación, la selección, los precios, el medio y el stock opcional dentro de una
transacción; `(tenant, location, commandId)` vuelve los reintentos persistentes e
idempotentes incluso si llegan juntos. El rol `authenticator` no accede a las tablas,
sólo a las dos funciones públicas acotadas.

Los medios presenciales dejan `awaiting_waiter` y un llamado abierto
`order_validation`; T19 debe resolverlo. Mercado Pago deja `payment_pending` sin
llamado; T24 implementará el cobro real. Ninguno confirma, reserva stock, abre la
sesión/cuenta ni envía a producción. T20 y T22 conservan esas responsabilidades. La UI
borra el borrador únicamente después de una respuesta aceptada.

### Punto de partida para T16 (histórico)

- Las tablas de pedidos reales no deben leer ni escribir `sandbox_*`; toda métrica,
  saldo o cierre debe excluir el namespace `sandbox` y la acción `sandbox.*`.
- Para abrir al público, T16 puede exigir `private.location_publications` (el negocio
  fue publicado por su Administrador) además de la resolución de QR de T13.
- `FloorPlanRepository.resolveQr(scope, token)` sigue siendo el punto de entrada para
  la ruta pública `/m/:token`.

## Invariantes que Fase 4 debe preservar

- El tenant y la ubicación se resuelven desde sesión y dominio; ningún body,
  query param ni identificador importado puede elegirlos.
- Los endpoints de alta requieren Administrador. Una identidad de plataforma no
  entra en un tenant sin el flujo de soporte temporal existente.
- Carta, plano, equipo y pagos se guardan como avance. Sólo T15 puede declarar el
  negocio listo para operar.
- Una importación aprobada modifica únicamente el borrador de carta. Publicar la
  carta sigue siendo una operación explícita, versionada y atómica.
- Los QR pertenecen a mesas físicas estables: mover o agrupar una mesa nunca
  reemplaza su ID ni su token público.
- Credenciales de proveedores no vuelven al navegador, respuestas, trazas ni
  eventos. Las operaciones SQL permanecen parametrizadas y tenant-scoped.
- El modo de prueba de T15 debe usar un namespace o marca explícita y no alimentar
  métricas, saldos ni operación reales.

## Secuencia recomendada

### T13 — Plano, mesas, agrupaciones y QR (completada, ver arriba)

1. Definir primero el modelo persistente: plano versionado, sectores, mesas,
   sillas, geometría y membresías de agrupación separadas de la identidad física.
2. Generar tokens QR opacos, únicos e inmutables por tenant/mesa; almacenar sólo
   el material necesario para resolverlos y prever rotación auditada.
3. Implementar comandos idempotentes y con control de versión para guardar,
   mover, agrupar y separar sin last-write-wins silencioso.
4. Entregar el editor responsive con recomendación no bloqueante de pantalla
   amplia y verificar serialización, teclado y geometría en navegador real.

### T14 — Equipo y medios de pago (completada, ver arriba)

Puede avanzar en paralelo con T13 después de fijar contratos compartidos.

1. Reutilizar identidades y roles fijos de T06; las asignaciones de sector deben
   referenciar los sectores estables de T11/T13.
2. Separar configuración pública del proveedor y secreto cifrado/referenciado.
   Las lecturas sólo devuelven estado, nunca credenciales.
3. Mantener efectivo habilitado por defecto y validar transaccionalmente que no
   se desactive el último medio disponible.
4. Auditar altas, desactivaciones, cambios de rol/sector y cambios de medios sin
   registrar PIN, token ni secreto.

### T15 — Readiness, simulación y publicación

Debe comenzar cuando T13 y T14 tengan sus contratos estables y cerrarse después
de ambas tareas.

1. Construir una matriz autoritativa de requisitos sobre T10–T14 que devuelva
   códigos, explicación y enlace al paso faltante sin impedir guardar avances.
2. Aislar la simulación de QR → pedido → producción → pago → cierre → limpieza
   desde base de datos hasta observabilidad; una bandera sólo en UI no alcanza.
3. Exigir Administrador y transacción para publicar el negocio. Revalidar todos
   los mínimos dentro de la misma operación para evitar TOCTOU.
4. Cubrir con E2E el alta ficticia completa y demostrar que datos simulados,
   importaciones pendientes y borradores sin publicar no entran en producción.

## Puertas de verificación

Antes de cerrar cada slice:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm security:secrets
pnpm audit --prod --audit-level high
```

Para migraciones, ejecutar además los pgTap del módulo y los recorridos de
integración local con dos tenants. T13 y T15 requieren verificación responsive en
navegador real. T14 requiere inspeccionar red y logs para demostrar que los
secretos no salen del servidor.

## Riesgos y pendientes conscientes

- **Cabecera `Host` desde el servidor web (resuelto sólo para T13).** `fetch` de
  Node/undici descarta `Host`, así que la API resolvía el host de su propia URL y
  respondía `TENANT_NOT_FOUND`; las pruebas con `server.inject` no lo detectan. El
  plano (`/panel/plano`) ya usa `tenantFetch`
  (`apps/web/src/app/panel/tenant-fetch.ts`, basado en `node:http`), que sí envía
  `Host`; la API sigue validando el Bearer y no recibe `tenantId`, `locationId` ni
  `X-Forwarded-Host`. **Resuelto en T15:** las llamadas administrativas de T10–T12 (`panel/actions.ts` y
  `app/api/business-media`) ahora usan `tenantFetch`; antes la subida de imágenes y el
  guardado de perfil/carta fallaban con 404 en el recorrido real. Quedan con `fetch`
  sólo las rutas de plataforma (`/v1/platform/...`) y las de sesión de empleados
  (`app/interno`), que no resuelven un tenant desde el host administrativo.
- **Servidor de desarrollo de Next.** Imprimía los argumentos de las Server Actions
  (PIN y credenciales). `next.config.ts` fija `logging.serverFunctions: false`; toda
  acción nueva con datos sensibles depende de ello y de que no se registren cuerpos.
- `pnpm format:check` falla únicamente en `apps/web/next-env.d.ts`, archivo que Next
  regenera idéntico al commit (sin cambios desde `0b40071`); no es de T14.
- Rotación de `PAYMENT_SECRET_KEY` y descifrado servidor-servidor pendientes: T24 los
  necesita (`PaymentSecretSealer.open` ya existe con pruebas).
- Local: `catalog_media_validation.test.sql` falla en la base de desarrollo incluso
  sin la migración de T13, y `local-catalog.integration.test.ts` no puede limpiar
  `published_catalogs` porque las tablas de T11 pertenecen a `supabase_admin` y las
  de T12/T13 a `postgres`. No afecta a T13.
- El plano valida los límites del lienzo pero no avisa de solapamientos entre
  mesas.
- No hay botón de rotación de QR ni impresión por lotes; las descargas son SVG
  individuales.

- La prueba de integración de T15 deja un tenant `alta-*` cuando la base de desarrollo
  tiene `published_catalogs` a nombre de `supabase_admin`; rompe `tenancy_rls.test.sql`
  hasta limpiarlo (comando en el runbook de T15). En una base creada con un único
  dueño de tablas se limpia sola.
- El panel de publicación no puede revertir la publicación ni mostrar historial de
  corridas del modo prueba; sólo el resultado de la última simulación.
- El modo prueba recorre un circuito simplificado en la base (primer producto de la
  carta publicada, primera mesa con QR); cuando T16–T24 existan, habrá que decidir si
  se enchufa al flujo real con la misma marca y limpieza.
- El adaptador OCR externo no forma parte de T12: PDF e imagen quedan revisables
  con `OCR_UNAVAILABLE`, sin bloquear CSV/XLSX ni carga manual.
- El límite de Server Actions es 9 MB para admitir un archivo máximo de 8 MB más
  el overhead multipart; API y contrato vuelven a imponer el límite de 8 MB.
- El Checkpoint 3 conserva pendiente la aprobación humana de la diferencia visual
  entre borrador, publicado y disponibilidad inmediata.
- El warning de webpack de OpenTelemetry sobre `require-in-the-middle` es
  preexistente y no impide el build; no debe confundirse con un fallo de T12.

## Estado de T19 — operación del salón

Hecho: ver `docs/runbooks/operacion-del-salon.md`. Migración
`20261024090000_create_waiter_operations.sql` (rollback en `supabase/rollbacks`, pgTap
`waiter_operations.test.sql`, 71 aserciones). La API del personal vive en
`apps/api/src/waiter` y `staff-auth/staff-session.guard.ts`; la web en
`apps/web/src/app/interno/[tenantSlug]/operacion/salon`.

Punto de partida para T20–T22:

- T20 debe leer `private.confirmed_orders` / `confirmed_order_items` (cada ítem trae
  `production_sector_id` de la carta publicada). T19 **no** crea tickets ni estados de
  producción; los pedidos confirmados son append-only, así que los estados por ítem
  deben vivir en tablas nuevas.
- T22 debe crear la sesión de mesa (colgada de `group.id` o de la mesa) y el ledger. Hoy
  `confirmed_orders` no tiene saldo ni pago; el contrato fija `payment: not_recorded` y
  `accountDecision: pending`. «Cobrar ahora» y «Dejar cuenta abierta» están
  deshabilitados en `confirmed-order-panel.tsx`. `floor_table_service_states` sigue sin
  escribirse: nadie pasa una mesa a `occupied` todavía.
- T24 debe confirmar las intenciones `payment_pending` por webhook; un `check` de
  `order_intents` impide que lo haga un Mozo.
- Pendientes: llamado genérico del comensal, apagar la disponibilidad con stock cero y
  Realtime en lugar de polling (T31).

## Estado de T20 — producción por sector

Hecho: ver `docs/runbooks/produccion-por-sector.md`. Migración
`20261024100000_create_production.sql` (rollback en `supabase/rollbacks`, pgTap
`production.test.sql`, 47 aserciones). La API vive en `apps/api/src/production`
(`GET /v1/staff/production`, `POST …/orders/:orderId/items/:lineId/status`), el
repositorio en `packages/database/src/production-repository.ts`, los contratos en
`packages/contracts/src/production.ts` y la web en
`apps/web/src/app/interno/[tenantSlug]/operacion/produccion`.

Punto de partida para T21–T22:

- T21 debe agregar «Entregado» y las excepciones **sin tocar** `confirmed_*`: el estado de
  ítem vive en `private.production_items` (sólo avanza `queued → preparing → ready`; su
  trigger `guard_production_item_change` hay que ampliar con cuidado, nunca borrar filas)
  y su historial en `production_item_events` (append-only, una fila por paso real). El
  orden derivado está en `private.production_status_of`; un estado nuevo debe entrar ahí
  y en el contrato `ProductionItemStatus`.
- Los avances reutilizan `private.claim_waiter_command` / `finish_waiter_command`
  (`waiter_commands`, por empleado): T21 puede hacer lo mismo para ser idempotente.
- Los ítems de sectores `other` quedan en cola sin pantalla; el Encargado no tiene
  pantalla de producción ni capacidad (`production.*` sólo existe para Cocina y Barra).
- T22 sigue sin tener cuenta ni ledger; nada de T20 los toca.
- Los tests de integración que limpian tablas con triggers append-only deben usar una
  transacción con `set local session_replication_role = replica`; desactivar triggers
  con `ALTER TABLE` es global y rompe a otros archivos en paralelo.

## Estado de T21 — entrega, faltantes y cancelaciones

Hecho: ver `docs/runbooks/entrega-faltantes-y-cancelaciones.md`. Migración
`20261024110000_create_order_adjustments.sql` (pgTap `order_adjustments.test.sql`, 76
aserciones). API en `apps/api/src/order-adjustments`, repositorio
`packages/database/src/order-adjustments-repository.ts`, contratos
`packages/contracts/src/order-adjustments.ts` y web en
`apps/web/src/app/interno/[tenantSlug]/operacion/salon/orders-in-progress.tsx` (pestaña
«Pedidos en curso») y `produccion/production-board.tsx` («Faltante…»).

- Los ajustes (`order_adjustments`) son la fuente de la diferencia económica de un
  reemplazo o una cancelación; T22 los lee (triggers sobre la tabla) y T23 usa la
  cancelación posterior al cobro como saldo a favor para una devolución presencial.
- El estado de un ítem sólo da los pasos documentados (`guard_production_item_change`); un
  estado nuevo debe entrar ahí, en `production_status_of`, en el check de
  `production_item_events` y en `ProductionItemStatus`.

## Estado de T22 — cuenta y libro mayor

Hecho: ver `docs/runbooks/cuenta-de-mesa.md`. Migración
`20261024120000_create_table_accounts.sql` (pgTap `table_accounts.test.sql`, 88
aserciones). API en `apps/api/src/table-accounts`, repositorio
`packages/database/src/table-accounts-repository.ts`, contratos
`packages/contracts/src/table-accounts.ts` y web en `salon/accounts-panel.tsx`.

Punto de partida para T23–T26:

- El libro es `private.account_entries` (append-only, un movimiento por fuente y tipo).
  **Nunca** guardes un saldo: usá `private.account_summary`. El cobro presencial ya
  existe (`record_account_payment`, medios presenciales, propina aparte); T23 agrega
  turnos, caja, arqueo ciego y devoluciones (`refund` ya está permitido por el esquema)
  sobre estas mismas entradas.
- T24 debe confirmar pagos online escribiendo `payment` con su propio `source_id` en el
  libro; la sesión y el cobro presencial no se tocan.
- T25 divide por persona: `confirmed_orders` ya conserva atribución por persona o mesa.
- T26 cierra la sesión (`status = 'closed'`, único cambio permitido por
  `guard_table_session_change`) y libera la mesa (`floor_table_service_states`).
- Los pedidos confirmados antes de T22 no tienen cuenta (sólo datos locales).
- Los tests de integración nuevos deben limpiar `account_entries`, `account_decisions` y
  `table_sessions` antes de borrar el negocio (usar `session_replication_role = replica` en
  una transacción, nunca `ALTER TABLE … DISABLE TRIGGER`).

## Estado de T23 — caja y pagos presenciales

Hecho: ver `docs/runbooks/caja-y-arqueo.md`. La caja exige turno abierto para cobrar,
registra movimientos y devoluciones, y cierra con arqueo ciego y justificación de
diferencias. La UI está en la pestaña **Caja** del Encargado y en **Cuentas**; ningún
formulario presencial solicita datos de tarjeta. El E2E cubre el recorrido completo en
móvil y escritorio.

## Estado de T24 — Mercado Pago

Hecho: ver `docs/runbooks/mercado-pago.md`. Migración
`20261025020000_create_mercado_pago.sql` con rollback y pgTap. La API vive en
`apps/api/src/mercado-pago`, los contratos en `packages/contracts/src/mercado-pago.ts`
y el repositorio en `packages/database/src/mercado-pago-repository.ts`.

La web agrega OAuth en `/panel/pagos`, checkout sandbox/Card Payment Brick en `/m/:token`
y devolución online separada de caja en **Cuentas**. `e2e/mercado-pago.spec.ts` verifica
acreditado, pendiente, rechazado y devolución parcial en móvil y escritorio. Los
cleanups eliminan explícitamente eventos, pagos, estados OAuth y conexiones.

Para activar el proveedor real todavía hacen falta `client_id`, `client_secret`, secreto
de webhook, callback/return URL HTTPS públicos y una `PAYMENT_SECRET_KEY` de 32 bytes.
Hasta entonces debe mantenerse `MERCADO_PAGO_MODE=fake` fuera de producción.

## Estado de T25 — dividir el saldo

Hecho: ver `docs/runbooks/dividir-cuenta.md`. Migración `20261026010000_create_account_splits.sql` (rollback y pgTap `account_splits.test.sql`). `waiter_accounts_view` ahora trae `split` por cuenta; el cobro de partes reutiliza `record_account_payment`, así que caja, límites y libro no cambian. Después se completó lo pendiente: división por consumo, reserva desde el teléfono y pago de una parte con Mercado Pago (migraciones `20261026020000`, `20261026030000` y `20261026040000`, todas con rollback y pgTap). Siguiente: **T26** (cerrar la sesión cuando el saldo es cero, pasar la mesa a pendiente de limpieza, habilitarla solo con personal autorizado y emitir el comprobante). Al cerrar una sesión hay que cancelar divisiones abiertas (`supersede_account_split`) y no cerrar con pagos online en `needs_refund`. La API se prueba en serie (`--no-file-parallelism`) por el pool de Supavisor.

## Estado de T26 — cierre, limpieza y comprobante

Hecho: ver `docs/runbooks/cierre-limpieza-y-comprobante.md`. Migración
`20261027010000_close_clean_and_receipt.sql` (rollback probado aplicar → revertir → reaplicar, pgTap
`table_closing.test.sql` con 59 aserciones). API en `apps/api/src/table-closing`, repositorio
`packages/database/src/table-closing-repository.ts`, contratos `packages/contracts/src/table-closing.ts`
y web en `salon/closed-accounts-panel.tsx`, `salon/accounts-panel.tsx` («Cerrar cuenta»),
`salon/waiter-tables.tsx` («Marcar limpia») y `comprobante/[sessionId]`.

- Cerrar exige saldo cero y ningún pago online en `needs_refund`, anula la división abierta con
  `supersede_account_split`, deja **todas** las mesas de la sesión en `needs_cleaning` y emite un
  comprobante numerado por ubicación, inmutable y no fiscal. El libro de una cuenta cerrada sólo acepta
  devoluciones (`PT273`). Códigos nuevos: `PT270`–`PT276`.
- `floor_table_service_states` tiene ahora máquina de estados (`PT275`): una mesa pendiente de
  limpieza o fuera de servicio nunca pasa a ocupada; sólo `mark_table_clean` (Mozo de la mesa o
  Encargado) borra la fila y la deja Disponible.
- «Avisar a caja» = una solicitud abierta por sesión, sin datos fiscales; el Encargado la marca atendida.
- Los cleanups de integración/E2E que borran sesiones deben borrar antes `cashier_requests`,
  `account_receipts` y `receipt_counters` (con `session_replication_role = replica`).
- La caja del E2E y de la demo empieza cerrada; Marta (PIN 246810) la abre desde Caja.

Punto de partida para T27: al separar mesas, el cierre ya considera el grupo de la sesión
(`private.session_table_ids`); T27 debe decidir qué ancla conserva la sesión abierta y cómo se reparten
los estados `needs_cleaning`. Pendientes conscientes: envío del comprobante por correo/WhatsApp, PDF generado
en servidor (hoy se imprime o guarda desde el navegador) y que el comensal vea su comprobante.

Corregido aparte de T26: `local-table-entry.integration.test.ts` ahora borra `location_publications` en su limpieza (se puede correr seguido) y los pgTap `tenancy_rls`, `platform_operations`, `business_sandbox` y `catalog_imports` acotan sus conteos a su propio fixture, así que ya no dependen de los datos de la base de desarrollo.

## Estado de T27 — unir y separar mesas

Hecho: ver `docs/runbooks/unir-y-separar-mesas.md`. Migración `20261027020000_regroup_tables.sql` (rollback probado
aplicar → revertir → reaplicar, pgTap `table_regrouping.test.sql` con 85 aserciones). API en
`apps/api/src/table-regrouping`, repositorio `packages/database/src/table-regrouping-repository.ts`, contratos
`packages/contracts/src/table-regrouping.ts` y web en `salon/waiter-tables.tsx`, `regrouping-actions.ts` y
`staff/regroup-view.ts`.

- Una sesión abierta **sigue al grupo** al unir y **se queda con la mesa ancla** al separar; el libro y
  `confirmed_orders` no se tocan. Dos cuentas abiertas distintas no se unen (`PT278`); separar con cuenta
  abierta sin ancla es `PT279`; el editor del plano no puede romper un grupo con cuenta abierta (`PT280`).
  Códigos usados hasta ahora: `PT270`–`PT280`.
- Sólo `join_tables` y `separate_tables` pueden cambiar `scope_key`/`group_id`/`table_id` de una sesión abierta
  (`private.regroup_session = on` local a la transacción). Abrir una sesión toma un candado compartido por
  ubicación (`private.table_groups_lock_key`) que unir, separar y guardar el plano toman exclusivo: cualquier
  función nueva que abra sesiones o cambie grupos debe respetarlo.
- `private.table_group_events` es la historia append-only de cada unión y separación. Los limpiadores que borran
  `table_sessions` deben borrar antes `table_group_events` (además de `cashier_requests`, `account_receipts` y
  `receipt_counters`), con `session_replication_role = replica` en una transacción.
- Unir y separar suben `floor_plans.version`: un editor con versión vieja recibe `FLOOR_PLAN_VERSION_CONFLICT`.
- La API se prueba en serie (`--no-file-parallelism`) con `DATABASE_ADMIN_URL` del dueño de las tablas
  (`supabase_admin.<tenant>`); Playwright usa 3100/3101 y la caja de la demo queda cerrada (Marta, PIN 246810).

Punto de partida para el Checkpoint 8 / T28+: el salón ya cubre mesa → pedido → cobro → cierre → limpieza y
unir/separar. Pendientes conscientes: sacar una sola mesa de un grupo grande, que el comensal confirme que se une a
la cuenta del grupo, envío del comprobante y PDF en servidor (T26), y la regla de tasa de tokens (T33).

## Estado de T28 — cuenta de comensal y consentimientos

Hecho: ver `docs/runbooks/cuenta-de-comensal.md`. Migración `20261028010000_create_diner_identity.sql` (rollback probado
aplicar → revertir → reaplicar, pgTap `diner_identity.test.sql` con 58 aserciones y dos tenants). API en
`apps/api/src/diner-identity`, repositorio `packages/database/src/diner-identity-repository.ts`, contratos
`packages/contracts/src/diner-identity.ts`, configuración `DINER_AUTH_*` en `packages/config` y web en `app/api/diner`,
`app/diner-account` y `app/cuenta`.

- La cuenta global del comensal (`private.diner_accounts`) **no** reutiliza `staff_members` ni `tenant_memberships`. Cada restaurante
  ve sólo `private.diner_profiles` (id opaco por tenant); el único puente es `diner_profile_links`, que ninguna función de tenant lee.
- Consentimientos (`whatsapp_verified`, `marketing`): append-only, versionados por texto. Códigos nuevos `PT281`–`PT286`; **seguí desde `PT287`**.
- El comensal se vincula a la **sesión** (`private.diner_session_links`), nunca a la mesa; `table_sessions` y `account_entries` no cambiaron.
  `link_diner_to_session` toma el candado compartido `private.table_groups_lock_key`. La resolución del QR no consulta la cuenta.
- Los limpiadores que borran un tenant deben borrar antes (con `session_replication_role = replica` en una transacción)
  `diner_session_links`, `diner_consent_events`, `diner_profile_links`, `diner_profiles`, `diner_sessions`, `diner_login_exchanges` y las cuentas
  creadas, además de `cashier_requests`, `account_receipts`, `receipt_counters`, `table_group_events` y `table_sessions`.
- Las páginas del comensal declaran `referrer: no-referrer`: sus POST llevan `Origin: null`. Los chequeos de mismo sitio usan
  `Sec-Fetch-Site` (`isOwnSite`) y recién después `Origin`. Una llamada sin cuerpo no debe declarar `content-type: application/json` (Fastify la rechaza).
- Playwright usa `DINER_AUTH_MODE=fake` (`e2e/stack-env.ts`); la API se prueba en serie con `DATABASE_ADMIN_URL` del dueño de las tablas.

Punto de partida para T29: visitas, premios y cumpleaños cuelgan de `diner_profiles` (por tenant) y de `diner_session_links`; no
agregues columnas de cliente a `table_sessions` ni a `account_entries`. Pendientes conscientes: verificación real del número de
WhatsApp (hoy sólo se registra el consentimiento y el teléfono), pantalla del restaurante para sus clientes
(`private.list_tenant_diner_profiles` ya existe), texto legal propio por restaurante desde el panel, y limpiar sesiones y códigos vencidos.

## Estado de T29 — visitas, cumpleaños y premios

Hecho: ver `docs/runbooks/fidelizacion.md`. Migración `20261029010000_create_loyalty.sql` (rollback probado aplicar → revertir →
reaplicar, pgTap `loyalty.test.sql` con 61 aserciones y dos tenants). API en `apps/api/src/loyalty`, repositorio
`packages/database/src/loyalty-repository.ts`, contratos `packages/contracts/src/loyalty.ts` y web en `app/api/diner/loyalty`,
`app/cuenta/loyalty-panel.tsx`, `operacion/loyalty-actions.ts`, `salon/loyalty-rewards.tsx` y `salon/loyalty-settings-panel.tsx`.

- Todo cuelga de `diner_profiles` y `diner_session_links`; `table_sessions` y `account_entries` no cambiaron. Sin fila en
  `loyalty_settings` el programa está apagado. Códigos nuevos `PT287`–`PT292`; **seguí desde `PT293`**.
- Las visitas se acreditan con un disparador sobre `table_sessions` (open → closed) que se traga sus errores: nunca demora ni
  hace fallar el cierre. Una devolución total (`refund` en el libro) las revoca con otro disparador sobre `account_entries`.
- Canjear un premio con cobro (`redeem_loyalty_reward_with_payment`) es una sola transacción: el orden de candados es siempre
  la cuenta y después el premio. Si el cobro falla, el premio vuelve a `available` y la respuesta queda guardada para el `commandId`.
- Los limpiadores que borran un tenant deben borrar además `loyalty_visits`, `loyalty_rewards`, `diner_birthdays` y
  `loyalty_settings` (con `session_replication_role = replica`).
- Los E2E del comensal siguen usando `DINER_AUTH_MODE=fake`; `e2e/loyalty.spec.ts` reutiliza el negocio de ajustes (Ana, PIN 246810).

Punto de partida para T30 (WhatsApp): las automatizaciones deben leer consentimientos (`diner_consent_state`) y no el teléfono
directo; `loyalty_rewards` y `diner_birthdays` ya dan los eventos (premio ganado, premio por vencer, cumpleaños). Pendientes
conscientes: canje con Mercado Pago, premio de cumpleaños, atribución por asiento en mesas grupales (hoy partes iguales), devolución
parcial y la lista de visitas por cliente para el restaurante.

## Estado de T30 — WhatsApp y automatizaciones básicas

Hecho: ver `docs/runbooks/whatsapp.md`. Migración `20261030010000_create_messaging.sql` (rollback probado aplicar → revertir →
reaplicar, pgTap `messaging.test.sql` con 173 aserciones y dos tenants). Contratos `packages/contracts/src/messaging.ts`,
repositorio `packages/database/src/messaging-repository.ts`, **paquete nuevo `@platform/integrations`** (`PaymentSecretSealer`, que ahora
vive ahí y la API reexporta, adaptador simulado y de Meta, firma y lectura del webhook), cola de envío en `apps/worker/src/messaging-worker.ts`,
API en `apps/api/src/messaging` y panel en `operacion/mensajeria`. Códigos nuevos `PT293`–`PT298`; **seguí desde `PT299`**.

- La política de envío es **una** función (`private.messaging_send_decision`) y ante cualquier duda bloquea. `begin_messaging_send` toma un
  candado por persona y marca `sending` en la misma transacción: ahí se respetan topes y la unicidad del envío.
- Los envíos reales están **apagados por defecto** en tres niveles (`WHATSAPP_MODE`, `sending_enabled` por conexión, aprobación/confirmación).
  El Checkpoint 9 sigue abierto: falta la revisión legal y comercial antes de activarlos.
- Un mensaje `sending` con el lease vencido se cierra como `failed` y **no se reenvía**.
- El BAJA tiene origen propio en los consentimientos (`whatsapp_optout`, se agregó al `check` de `diner_consent_events.source`).
- `rawBody: true` en `apps/api/src/main.ts` es necesario para la firma del webhook.
- Los limpiadores que borran un tenant deben borrar además `messaging_events`, `messaging_outbox`, `messaging_automations`,
  `whatsapp_templates` y `whatsapp_connections` (el historial y la cola rechazan `delete`; usar `session_replication_role = replica`).
- `pnpm install` necesita el workspace nuevo: tras actualizar, `corepack pnpm install --frozen-lockfile` y construir
  `contracts`, `integrations`, `database`, `config` y `observability`. Playwright pone `WHATSAPP_MODE=simulated` (`e2e/stack-env.ts`).

**Segundo canal: avisos de la PWA (Web Push).** Ver `docs/runbooks/avisos-pwa.md`. Migración
`20261030020000_add_web_push_channel.sql` (rollback probado): columna `channel` en plantillas, automatizaciones y cola,
`push_subscriptions` y `push_settings`. Misma política, cola, historial y panel; la entrega la hace
`packages/integrations/src/web-push.ts` (RFC 8291 y VAPID sin dependencias, verificado con el vector del RFC). Variables
`WEB_PUSH_MODE`, `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` (sólo el worker) y `WEB_PUSH_SUBJECT`. En la web:
`public/sw.js`, `app/manifest.ts`, `cuenta/push-panel.tsx`. La suscripción cubre los avisos operativos; una promoción por push
exige además `marketing`. Los cupos se comparten con WhatsApp. `claim_messaging_outbox` recibe ahora los canales que entrega
el worker. Las pruebas de WhatsApp asumen 8 automatizaciones (4 tipos por 2 canales).

Fuera de alcance, a propósito: verificación del número del comensal, integración con el sandbox real de Meta (se probó con el simulador y con
el adaptador de Meta sobre un `fetch` falso), costos facturables (el costo por mensaje es una estimación cargada a mano) y OAuth/Embedded Signup.
