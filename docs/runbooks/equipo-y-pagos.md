# Equipo y medios de pago

Pasos 6 y 7 del alta (T14). Sólo el Administrador del negocio opera estas
pantallas: `/panel/equipo` y `/panel/pagos`. El negocio y la ubicación salen de
la sesión y del dominio; ningún cuerpo, consulta o cabecera del cliente los elige.

## Equipo

Reutiliza `public.staff_members` y las credenciales de T06. Roles fijos: Encargado
(`manager`), Mozo (`waiter`), Cocina (`kitchen`) y Barra (`bar`).

| Método  | Ruta                               | Uso                                                  |
| ------- | ---------------------------------- | ---------------------------------------------------- |
| `GET`   | `/v1/tenant/team`                  | Listar empleados y sus sectores                      |
| `POST`  | `/v1/tenant/team`                  | Crear empleado (usuario, nombre, rol, PIN, sectores) |
| `PATCH` | `/v1/tenant/team/:memberId`        | Cambiar nombre, rol y sectores                       |
| `PUT`   | `/v1/tenant/team/:memberId/active` | Activar o desactivar                                 |
| `PUT`   | `/v1/tenant/team/:memberId/pin`    | Restablecer el PIN (responde 204)                    |

### A qué sector se asigna cada rol

Hay dos tipos de sector y no se mezclan:

- **Sectores del salón** (`private.floor_sectors`, T13): sólo el **Mozo** se asigna a
  ellos, en `private.staff_sector_assignments`. Un trigger y la función rechazan
  asignar sectores a otro rol o a un sector de otro negocio. Quitar un sector del
  plano elimina sus asignaciones (el acceso se reduce, nunca se amplía). Un Mozo sin
  sectores todavía no tiene mesas asignadas; T16 decide cómo se usa la asignación.
- **Sectores de producción** (T11: cocina o barra, dentro del JSON de la carta): no se
  asignan por persona. El rol Cocina y el rol Barra ya corresponden a su sector de
  producción (`production.kitchen.manage` / `production.bar.manage`).

### Reglas

- El PIN lo define el Administrador (seis dígitos), se hashea en la API con el
  `STAFF_PIN_PEPPER` y sólo el hash llega a SQL. No se devuelve, no se registra y no
  aparece en la auditoría. Restablecerlo limpia intentos y bloqueo y cierra las
  sesiones abiertas del empleado.
- **No se puede desactivar ni degradar al último Encargado activo** de la ubicación
  (`PT001` → `409 TEAM_LAST_MANAGER`). La verificación bloquea las filas de los
  Encargados activos, así dos cambios simultáneos no dejan la ubicación sin ninguno.
  Esta es nuestra lectura de la regla de T06 (el Encargado es quien revalida el PIN
  y aprueba operaciones sensibles).
- Desactivar, restablecer el PIN o cambiar el rol **revoca las sesiones activas**
  (evento `session_revoked` en `private.staff_auth_events`); `resolveSession` ya
  rechazaba a un usuario inactivo.
- Un usuario duplicado responde `409 TEAM_USERNAME_TAKEN`.

### Auditoría (`private.audit_events`)

`staff.created`, `staff.role_changed`, `staff.renamed`, `staff.sectors_changed`,
`staff.deactivated`, `staff.activated`, `staff.credential_reset`. El motivo es un
texto fijo; no contiene usuario, PIN, hash ni nombre. El sujeto es el UUID del
empleado.

## Medios de pago

`private.payment_methods` (una fila por medio y ubicación; se crean al primer uso):
`cash`, `credit_card`, `debit_card`, `other_in_person` y `mercado_pago`.

| Método   | Ruta                                            | Uso                                    |
| -------- | ----------------------------------------------- | -------------------------------------- |
| `GET`    | `/v1/tenant/payment-methods`                    | Estado de los cinco medios             |
| `PUT`    | `/v1/tenant/payment-methods/:method`            | Habilitar/deshabilitar y clave pública |
| `PUT`    | `/v1/tenant/payment-methods/:method/credential` | Guardar la credencial privada          |
| `DELETE` | `/v1/tenant/payment-methods/:method/credential` | Eliminarla (deshabilita el medio)      |

- **Efectivo inicia habilitado.** Sólo puede deshabilitarse si queda otro medio
  _disponible_ (`PT004` → `409 PAYMENT_LAST_METHOD`). Un medio está disponible si
  está habilitado y, en Mercado Pago, además tiene clave pública y credencial.
  La regla se aplica dos veces dentro de la base: la función bloquea todas las filas
  de la ubicación (los cambios son seriales) y un _constraint trigger_ diferido
  repite la comprobación al confirmar, aunque alguien escriba las tablas directo.
- Habilitar un proveedor sin configurar responde `422 PAYMENT_PROVIDER_NOT_CONFIGURED`.
- **Configuración pública y secreto están separados.** La clave pública vive en
  `public_config` (validada por `CHECK`). La credencial privada se cifra en la API con
  AES-256-GCM (`PAYMENT_SECRET_KEY`, 32 bytes en base64; nonce aleatorio; tenant,
  ubicación y medio como datos autenticados) y sólo el _ciphertext_ llega a
  `private.payment_method_secrets`. Ninguna función SQL ni endpoint la devuelve: las
  lecturas informan `configured: true|false`. Sin `PAYMENT_SECRET_KEY` la API arranca
  pero rechaza guardar credenciales (`503 PAYMENT_SECRETS_UNAVAILABLE`).
- Rotar la clave: `key_version` queda guardado por fila. Aún no hay rotación; el
  flujo de cobro de T24 deberá añadir el acceso servidor-servidor que descifra
  (`PaymentSecretSealer.open`) con la clave vigente.
- Auditoría: `payment_method.enabled`, `.disabled`, `.configured`, `.secret_stored`,
  `.secret_cleared`, sin claves ni valores.

## Lo que no debe filtrarse

- Server Actions de Next reciben PIN y credenciales como argumentos. El servidor de
  desarrollo los imprimía en consola; `next.config.ts` fija
  `logging.serverFunctions: false` (hay una prueba que lo exige).
- Los contratos rechazan filas con campos extra: si la base devolviera `pinHash` o
  `ciphertext`, la API fallaría en lugar de enviarlos.
- La telemetría ya redacta claves `pin`, `secret`, `token`, `authorization`.

## Verificación

```bash
docker exec -i supabase-db psql -U postgres -d postgres -q -t -A < supabase/tests/database/staff_team.test.sql
docker exec -i supabase-db psql -U postgres -d postgres -q -t -A < supabase/tests/database/payment_methods.test.sql
```

Integración con dos tenants (`apps/api/src/team/local-team-payments.integration.test.ts`)
con las mismas variables locales que el resto de pruebas de integración.

Rollbacks: `supabase/rollbacks/20261024030000_create_team_management.down.sql` y
`20261024031000_create_payment_methods.down.sql` (aplicar → revertir → reaplicar
probado).
