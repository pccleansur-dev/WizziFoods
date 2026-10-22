# Aprovisionamiento de negocios

## Alcance

Este recorrido permite que el Superadmin cree y entregue un negocio sin operar
su carta, salón ni equipo. El resultado inicial es un tenant en estado `draft`,
una ubicación principal, un subdominio principal de la plataforma y una
membresía de Administrador pendiente de activación.

## Recorrido

1. Un Superadmin con sesión AAL2 completa el formulario de alta.
2. La web envía `POST /v1/platform/tenants` con un `Idempotency-Key` estable.
3. La API crea la solicitud, el tenant, la ubicación, el subdominio principal y
   la membresía en una sola transacción.
4. Supabase Auth envía al Administrador una invitación de un solo uso.
5. El Administrador acepta la invitación, define su contraseña y registra el
   segundo factor.
6. Su primer acceso AAL2 al contexto del tenant activa el aprovisionamiento.

La respuesta pública nunca incluye el enlace de invitación, su token ni el
identificador interno del usuario de Auth. En desarrollo, Inbucket captura el
correo dentro de la máquina; la aplicación no lo imprime ni lo presenta en la
interfaz.

## Idempotencia y recuperación

El cliente conserva la misma clave mientras reintenta un alta fallida y genera
una nueva únicamente después de una respuesta exitosa. La API y PostgreSQL
reconocen esa clave y reutilizan la solicitud existente, por lo que un reintento
no duplica tenant, ubicación, dominio ni membresía. Si cambia
`PLATFORM_BASE_DOMAIN`, un reintento conserva el dominio originalmente asignado
a esa solicitud.

Estados del recorrido:

- `pending_invitation`: la base quedó preparada y falta vincular el usuario de
  Auth.
- `invited`: Auth aceptó la invitación y la membresía quedó vinculada.
- `activated`: el Administrador completó el acceso seguro y ya puede continuar
  con el asistente de alta.

## Prueba local automatizada

Con la infraestructura local saludable, exportar desde la configuración local
ignorada por Git las siguientes variables, sin copiarlas al repositorio:

- `DATABASE_URL`
- `DATABASE_ADMIN_URL`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `LOCAL_MAIL_URL`

Luego ejecutar:

```powershell
pnpm --filter @platform/api test:integration
```

La prueba crea un alta descartable, obtiene el correo desde Inbucket sin mostrar
el token, acepta la invitación, define una contraseña aleatoria, registra TOTP,
comprueba una sesión AAL2, resuelve exclusivamente el tenant invitado y repite la
activación. Al finalizar elimina usuarios, datos y correos de prueba.

## Verificación registrada

El 22 de octubre de 2026 se verificó localmente el recorrido completo y su
limpieza. También pasaron las pruebas unitarias de API, tipos, lint y el escaneo
de secretos.
