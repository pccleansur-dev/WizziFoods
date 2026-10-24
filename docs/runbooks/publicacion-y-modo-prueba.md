# Requisitos, modo prueba y publicación del negocio (T15)

Cierra la Fase 4. Reúne en un solo lugar lo que T10–T14 dejan como avance y es
el **único** camino para declarar el negocio listo para operar.

## Matriz de requisitos

La base de datos decide (`private.location_readiness`); el contrato
`packages/contracts/src/readiness.ts` sólo da a cada código su explicación y el
paso del panel que lo resuelve, y rechaza códigos desconocidos.

| Código                      | Tipo        | Cuándo aparece                                                                        | Paso            |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------- | --------------- |
| `PROFILE_MISSING`           | Bloqueo     | No hay perfil guardado (T10).                                                         | `/panel`        |
| `PROFILE_CONTACT_MISSING`   | Bloqueo     | El perfil no tiene teléfono ni dirección.                                             | `/panel`        |
| `CATALOG_NOT_PUBLISHED`     | Bloqueo     | No hay carta **publicada** (un borrador no cuenta) (T11).                             | `/panel`        |
| `CATALOG_LANGUAGE_MISSING`  | Bloqueo     | La carta publicada no cubre todos los idiomas actuales del perfil.                    | `/panel`        |
| `FLOOR_NO_TABLES`           | Bloqueo     | Cero mesas activas (T13, `floor_plan_readiness`).                                     | `/panel/plano`  |
| `FLOOR_TABLE_WITHOUT_QR`    | Bloqueo     | Alguna mesa activa sin QR vigente.                                                    | `/panel/plano`  |
| `PAYMENT_NO_METHOD`         | Bloqueo     | Ningún medio de pago disponible (T14, `payment_readiness`).                           | `/panel/pagos`  |
| `CATALOG_DRAFT_UNPUBLISHED` | Recomendado | Hay cambios de carta sin publicar; los clientes ven la última publicada.              | `/panel`        |
| `CATALOG_IMPORTS_PENDING`   | Recomendado | Hay importaciones en cola, procesando o en revisión (no están en la carta).           | `/panel`        |
| `TEAM_EMPTY`                | Recomendado | No hay empleados activos. **Crear empleados no es requisito** (`staff_team_summary`). | `/panel/equipo` |

Guardar avances nunca se bloquea: ninguna función de T10–T14 consulta la matriz.
Sólo `publish_location` la exige.

## Publicar

`POST /v1/tenant/publication` (cuerpo vacío; cualquier campo se rechaza con 400).

- Exige Administrador del negocio del dominio resuelto (guards de T05–T07). Una
  identidad de plataforma o de empleado no entra. No hay paso de aprobación de
  Valentín ni de la plataforma.
- `private.publish_location` corre en **una** transacción: serializa publicaciones
  concurrentes con un bloqueo de la ubicación, toma `FOR SHARE` sobre lo que valida
  (perfil, plano, mesas activas y medios de pago, en orden fijo) y recién ahí evalúa
  la matriz. Quien guarda esos datos toma el bloqueo de fila equivalente, así que
  espera a que termine la publicación o ya quedó confirmado cuando se evalúa. No hay
  ventana entre revisar y publicar (TOCTOU).
- Errores: `409 BUSINESS_NOT_READY` (incluye la matriz para mostrar qué falta),
  `409 BUSINESS_ALREADY_PUBLISHED`. Auditoría: `business.published`.
- Publicar el negocio **no** publica la carta (`POST /v1/tenant/catalog/publish`
  sigue siendo explícito y versionado). Tampoco aprueba importaciones.
- Es una marca de una vez (`private.location_publications`). Si después se rompe un
  mínimo (por ejemplo se borran las mesas) el panel vuelve a mostrar el bloqueo, pero
  no se "despublica" solo: despublicar y reabrir son decisiones de operación (T16+).

## Modo prueba

`POST /v1/tenant/sandbox/runs` (Administrador, cuerpo vacío) recorre en la base
QR → pedido → producción → pago simulado → cierre → limpieza.

Aislamiento (no es una bandera de UI):

- Tablas propias: `private.sandbox_runs`, `sandbox_steps`, `sandbox_orders`. Ninguna
  tabla de operación las referencia (lo verifica pgTap) y el rol de runtime no tiene
  privilegios sobre ellas; sólo `run_sandbox_simulation` y `cleanup_sandbox`.
- Marca explícita: `namespace = 'sandbox'` (constraint) y referencias `SBX-XXXXXXXX`.
- Sólo **lee** el plano y la carta publicada. No escribe en `payment_methods`, no usa
  credenciales ni medios reales (el pago es un monto en la tabla de simulación), no
  toca equipo, QR, tenant ni la publicación. pgTap y la integración comparan un hash
  del estado real antes y después.
- Guarda sólo el id estable del QR, nunca el token.
- Limpieza: el último paso borra los pedidos simulados y deja el historial de pasos.
  `DELETE /v1/tenant/sandbox` elimina restos (por ejemplo tras una corrida
  interrumpida) del negocio de la sesión.
- Observabilidad: la auditoría usa acciones `sandbox.run_completed` y
  `sandbox.cleanup_completed` (prefijo `sandbox.`, sujeto `sandbox_run`/`location`).
  Cualquier reporte o métrica de negocio debe excluir `action like 'sandbox.%'`. Las
  métricas HTTP ya llevan etiquetas acotadas por ruta, y las rutas del modo prueba
  son propias (`/v1/tenant/sandbox/...`); no llevan tenant, mesa ni referencia.
- Error `422 SANDBOX_PREREQUISITES_MISSING` si falta una mesa con QR o una carta
  publicada.

**Para quien implemente T16+ (pedidos reales):** las tablas de pedidos reales no deben
leer ni escribir `sandbox_*`, y toda agregación (métricas, saldos, cierres) debe
quedar fuera del namespace `sandbox`. Si alguna vez se simula contra el flujo real,
tiene que usar la misma marca y limpiarse en la misma transacción.

## Verificación

- pgTap: `supabase/tests/database/business_readiness.test.sql` (32) y
  `business_sandbox.test.sql` (26), con dos tenants.
- Integración local con dos tenants:
  `apps/api/src/readiness/local-onboarding.integration.test.ts` (alta ficticia,
  borrador e importación pendiente fuera de producción, simulación inerte,
  aislamiento, carrera publicar vs. guardar). Probado con una mutación: sin los
  `FOR SHARE` la prueba de carrera falla.
- Migraciones: `20261024050000_create_business_readiness.sql` y
  `20261024051000_create_business_sandbox.sql`, con rollback en `supabase/rollbacks`,
  probadas aplicar → revertir → reaplicar.
- Panel: `/panel/publicar` (verificado en navegador a escritorio y 375 px, sin
  desborde horizontal).

## Limpieza local

La prueba de integración usa identidades nuevas en cada corrida. En una base de
desarrollo donde `published_catalogs` pertenece a `supabase_admin` (tablas de T11) el
rol `postgres` no puede borrar el negocio de prueba y queda un tenant `alta-*`, que
rompe `tenancy_rls.test.sql` (cuenta tenants). Se limpia con:

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -c "delete from private.location_publications where tenant_id in (select id from public.tenants where slug like 'alta-%'); delete from private.published_catalogs where tenant_id in (select id from public.tenants where slug like 'alta-%'); delete from private.audit_events where tenant_id in (select id from public.tenants where slug like 'alta-%'); delete from public.tenants where slug like 'alta-%'"
```

## Probar el alta a mano (entorno de demo)

Con Supabase local arriba (`pnpm infra:up`):

```bash
pnpm demo:up
```

Siembra un negocio vacío y un Administrador con contraseña y TOTP (la API admin de
Supabase local), levanta API y web e imprime la URL y las credenciales. El estado
queda en `.supabase/` (ignorado por git). `pnpm demo:totp` da el código vigente,
`pnpm demo:reset` borra el negocio y el usuario para empezar de cero y
`pnpm demo:down` detiene los procesos.

## Asistente por pasos

El Administrador recorre la puesta en marcha en pantallas separadas, con una barra de
pasos arriba y **Anterior / Continuar** abajo (`apps/web/src/app/panel/onboarding/`):

| Paso | Pantalla          | Contenido                              |
| ---- | ----------------- | -------------------------------------- |
| 1    | `/panel/negocio`  | Datos, contacto, idiomas, identidad    |
| 2    | `/panel/carta`    | Importación asistida y editor de carta |
| 3    | `/panel/plano`    | Plano del salón y QR                   |
| 4    | `/panel/pagos`    | Medios de pago                         |
| 5    | `/panel/equipo`   | Equipo (opcional)                      |
| 6    | `/panel/publicar` | Requisitos, modo prueba y publicación  |

- `/panel` es el resumen: avance, estado de cada paso y «Continuar en el paso N».
- El estado de cada paso sale de la misma matriz de requisitos que decide si se puede
  publicar (`onboardingProgress`); no hay una segunda fuente. Equipo es opcional y
  publicar queda bloqueado hasta cumplir los pasos obligatorios.
- **Continuar nunca bloquea**: el plan permite guardar y seguir después. Cada pantalla
  guarda con su propio botón; el marco avisa que hay que guardar antes de continuar.
- Los enlaces «Ir al paso» de la matriz apuntan a estas pantallas.
- Pasos del plan de producto que todavía no existen y no se muestran: propuesta estética
  y vista previa para el cliente.
