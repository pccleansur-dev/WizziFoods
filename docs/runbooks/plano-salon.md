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

## Plantas (pisos)

Un local puede tener varias plantas («Planta baja», «Planta alta», «Terraza»…). Migración
`20261024060000_create_floor_levels.sql` (rollback en `supabase/rollbacks`, pgTap
`floor_levels.test.sql`).

- **Planta ≠ sector.** La planta es el piso físico; el sector es la zona de servicio. Una
  mesa tiene **una planta y un sector**, y se cambian por separado. Los sectores siguen
  siendo del local completo.
- **Plano.** `plan.floors` (`id`, `name`, `position`, `shortName` opcional de hasta 10
  caracteres, por ejemplo «PB») y `table.floorId`. Hasta 10 plantas por local; el nombre
  es único sin distinguir mayúsculas. Cada mesa referencia una planta que exista en el
  mismo plano (`UNKNOWN_FLOOR`).
- **Agrupaciones.** Todas las mesas de una agrupación están en la misma planta
  (`MIXED_FLOORS`); la base lo vuelve a comprobar. Al pasar una mesa a otra planta sale de
  su agrupación.
- **Identidad y QR.** Pasar una mesa de planta no cambia su id ni su QR (lo verifican
  pgTap y la integración HTTP con dos tenants). El nombre de mesa sigue siendo único en
  todo el local.
- **Migración de datos.** Cada plano existente recibe una «Planta baja» y todas sus mesas
  activas quedan en ella. Una mesa retirada no tiene planta (como no tiene sector).
- **Editor.** Pestañas sobre el plano (una por planta, con su cantidad de mesas), panel
  «Plantas» para agregar, renombrar (con nombre corto) y quitar; sólo se quita una planta
  sin mesas y siempre queda una. La mesa seleccionada tiene un selector de **Planta**. El
  lienzo y su zoom muestran una sola planta. Si el local no tiene plantas, «Planta baja» se
  crea con la primera mesa.
- **Rollback.** Revertir la migración descarta las plantas y restaura las funciones de T13
  con una sola planta implícita.

## Grupos: sillas y QR

- **Sillas.** Al agrupar, las mesas siguen siendo mesas distintas. En el plano, el lado de cada
  mesa que toca a otra del grupo queda sin sillas y esas sillas pasan a los lados libres (el
  total no cambia). Es solo dibujo (`seatPositionsWithin`); no se guarda nada extra.
- **QR.** Cada mesa conserva su QR y su token. `private.resolve_floor_table_qr` (migración
  `20261024061000_resolve_qr_with_group.sql`, rollback y pgTap `floor_plan_group_qr.test.sql`)
  devuelve además `group_id`, `group_name` y `group_table_labels` (mesas activas del grupo), y
  `FloorTableQrResolution.group` los expone. T16 debe tratar a todo el grupo como una sola
  sesión usando `group.id`. La vista de códigos QR marca las mesas agrupadas.

### Requisito para T16 y T19: cómo se ve un grupo para el personal

Aprobado con mockup. Las mesas de un grupo siguen siendo mesas, pero el salón las muestra como
una sola unidad.

- **Plano del salón.** El grupo se dibuja con su contorno y la etiqueta «Mesas 1 + 2» (más el
  nombre del grupo si lo tiene). Tiene un solo estado y un solo total.
- **Ficha.** Tocar cualquier mesa del grupo abre la misma ficha: una cuenta, los pedidos juntos y
  cada ítem con la mesa de origen («Mesa 2», «Llevar a mesa 2»).
- **Cocina y barra.** El ticket dice «Mesas 1+2 · Cumpleaños» y la mesa de origen en una línea
  aparte. Los llamados al mozo también salen con la mesa de origen.
- **Cuenta.** Es una sola; cobrar o dividir se hace sobre el grupo (T25). El comensal ve
  «Estás en Cumpleaños (mesas 1 y 2)».
- **Agrupar y separar con la mesa en uso.** Se hace desde el salón (no desde el editor), nunca mueve
  la deuda ni pierde historial y, al separar, el personal elige con qué mesa queda la cuenta (T27,
  `unir-y-separar-mesas.md`). El editor del plano ya no puede romper los grupos de una cuenta abierta.
- **Cuentas distintas.** No se agrupan mesas que ya tienen cuentas abiertas distintas: se bloquea
  hasta que una cierre, para no mezclar deuda de personas distintas.
