# Acceso del personal

El personal usa cuentas individuales por negocio y ubicación. No utiliza Google
OAuth ni las credenciales administrativas: ingresa con un nombre de usuario y un
PIN numérico de seis dígitos desde `/interno/{tenantSlug}`.

## Política

- Roles fijos: Encargado, Mozo, Cocina y Barra.
- El PIN se deriva con `scrypt`, sal aleatoria de 32 bytes y un pepper del
  servidor (`STAFF_PIN_PEPPER`). Nunca se persiste ni devuelve el PIN en claro.
- Cinco intentos fallidos bloquean la cuenta durante 15 minutos.
- La sesión dura ocho horas y el navegador conserva sólo el token opaco en una
  cookie `HttpOnly`, `SameSite=Strict`, limitada a la ruta del negocio.
- El Encargado revalida su PIN para operaciones sensibles. Esa validación tiene
  vigencia de 15 minutos.
- Login, fallos, bloqueos, vencimientos, revocaciones y revalidaciones quedan en
  `private.staff_auth_events` sin secretos.

## API interna

| Método   | Ruta                                       | Uso                        |
| -------- | ------------------------------------------ | -------------------------- |
| `POST`   | `/v1/tenants/{tenantSlug}/staff-sessions`  | Iniciar sesión             |
| `GET`    | `/v1/staff-sessions/current`               | Resolver identidad y rol   |
| `DELETE` | `/v1/staff-sessions/current`               | Cerrar y revocar la sesión |
| `POST`   | `/v1/staff-sessions/current/revalidations` | Revalidar PIN de Encargado |

Las tres rutas de sesión actual reciben `Authorization: Bearer {token}`. La API
almacena exclusivamente el SHA-256 del token. Los errores de usuario inexistente,
PIN incorrecto, cuenta inactiva y bloqueo comparten una respuesta pública para
no revelar cuentas válidas.

## Base de datos

Las identidades visibles para el Administrador viven en `public.staff_members` y
están protegidas por RLS. Credenciales, sesiones y auditoría viven en el esquema
`private`; `anon` y `authenticated` no pueden leerlas. El rol de ejecución de la
API obtiene sólo los permisos y funciones acotadas necesarios para autenticar y
resolver una sesión.

## Verificación local

Además de las pruebas unitarias, ejecutar la integración con URLs separadas para
el rol de API y el propietario de la base:

```powershell
$env:DATABASE_URL = "postgresql://authenticator.<tenant>:<password>@127.0.0.1:54322/postgres"
$env:DATABASE_ADMIN_URL = "postgresql://postgres.<tenant>:<password>@127.0.0.1:54322/postgres"
pnpm --filter @platform/database test:integration
```

Las migraciones incluyen rollback y pruebas pgTAP de aislamiento y permisos.
