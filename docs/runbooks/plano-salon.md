# Plano del salón y QR de mesas

## Modelo

El plano es un recurso versionado por ubicación. Tres conceptos se guardan por
separado para que editar uno no altere los otros:

| Concepto            | Tablas privadas                        | Cambia al…                           |
| ------------------- | -------------------------------------- | ------------------------------------ |
| Identidad física    | `floor_tables`, `floor_table_qr_codes` | crear o retirar la mesa; rotar el QR |
| Geometría           | `floor_table_geometry`                 | mover, rotar, redimensionar, sillas  |
| Agrupación temporal | `floor_groups`, `floor_group_members`  | agrupar o separar                    |

Moverla, renombrarla, cambiarla de sector o agruparla nunca modifica el ID de la
mesa ni su QR. Quitar una mesa la retira (`retired_at`), revoca su QR y no permite
reutilizar su ID.

## Guardado

`PUT /v1/tenant/floor-plan` con `{ commandId, expectedVersion, plan }`:

- Sólo Administrador del tenant y ubicación resueltos por sesión y dominio. Un
  `tenantId` o `locationId` en el cuerpo se rechaza (`INVALID_FLOOR_PLAN`).
- `expectedVersion` distinto de la versión actual responde `409
FLOOR_PLAN_VERSION_CONFLICT`; nada se sobrescribe.
- Repetir `commandId` con el mismo contenido devuelve el plano actual con
  `applied: false`; con otro contenido responde `409 FLOOR_PLAN_COMMAND_REUSED`.
- Límites: lienzo 4000×3000, mesas de 40 a 600, rotación 0–359, 0–24 sillas,
  hasta 20 sectores, 200 mesas y 50 agrupaciones (2 a 20 mesas cada una). Los
  mismos límites viven en el contrato, en la API y como `check` en la base.
- Los nombres de mesa son únicos, sin distinguir mayúsculas, entre mesas activas.

## QR

- Token de 64 caracteres hexadecimales aleatorios, único globalmente e inmutable.
  La URL `…/m/<token>` no contiene IDs, tenant ni datos del negocio.
- `GET /v1/tenant/floor-plan/qr` devuelve, sólo al Administrador, el SVG y la URL
  de cada mesa activa. El panel los descarga como `qr-mesa-<nombre>.svg`.
- `POST /v1/tenant/floor-plan/qr/verify` con `{ token }` (nunca en la URL)
  responde si el token es válido **para el negocio del dominio actual**; el mismo
  token en otro tenant responde `valid: false`.
- `POST /v1/tenant/floor-plan/tables/:tableId/qr/rotate` revoca el QR vigente y
  emite otro, con evento de auditoría `floor_table.qr_rotated`.
- No registrar tokens en logs, trazas ni auditoría. Un QR comprometido se rota.

## Verificación local

Con Supabase local saludable:

```powershell
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261024010000_create_floor_plan.sql
docker exec -i supabase-db psql -U postgres -d postgres -q -t -A < supabase/tests/database/floor_plan.test.sql
pnpm --filter @platform/api exec vitest run src/floor-plan/local-floor-plan.integration.test.ts
```

Para revertir se usa `supabase/rollbacks/20261024010000_create_floor_plan.down.sql`
(elimina las tablas y los QR emitidos).
