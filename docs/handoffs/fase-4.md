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
  `X-Forwarded-Host`. **Pendiente:** las llamadas de T10–T12 (perfil, carta,
  importaciones) siguen usando `fetch` y deben migrarse a `tenantFetch`, igual que
  toda llamada administrativa nueva de T15 (T14 ya usa `tenantFetch` desde
  `admin-api.ts`). La corrección completa está en la
  rama `claude/interesting-proskuriakova-25c6df` (commit `173c15d`).
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

- El adaptador OCR externo no forma parte de T12: PDF e imagen quedan revisables
  con `OCR_UNAVAILABLE`, sin bloquear CSV/XLSX ni carga manual.
- El límite de Server Actions es 9 MB para admitir un archivo máximo de 8 MB más
  el overhead multipart; API y contrato vuelven a imponer el límite de 8 MB.
- El Checkpoint 3 conserva pendiente la aprobación humana de la diferencia visual
  entre borrador, publicado y disponibilidad inmediata.
- El warning de webpack de OpenTelemetry sobre `require-in-the-middle` es
  preexistente y no impide el build; no debe confundirse con un fallo de T12.
