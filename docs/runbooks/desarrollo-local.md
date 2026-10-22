# Desarrollo local

## Supabase

La infraestructura local usa una copia fijada de la composición oficial de
Supabase. Incluye PostgreSQL, Auth, Storage, Realtime, Studio, PostgREST y los
servicios auxiliares que esos componentes necesitan.

### Requisitos

- Docker Desktop con Docker Compose.
- Como mínimo 4 GB de RAM disponibles; se recomiendan 8 GB.
- Los puertos `18000`, `54322` y `65432` libres.

El gateway usa `18000` para no colisionar con Coolify, que en el entorno de
desarrollo puede ocupar `8000`.

### Arranque y estado

```powershell
pnpm infra:up
pnpm infra:status
```

En el primer arranque, `infra:setup` genera `infra/supabase/.env` a partir de
`.env.example`. Las credenciales son aleatorias, el registro público queda
deshabilitado hasta implementar los flujos de autenticación y el archivo real
está ignorado por Git. Si el archivo ya existe, el comando lo conserva.

Para detener los contenedores sin eliminar información:

```powershell
pnpm infra:down
```

PostgreSQL y Storage escriben en rutas persistentes ignoradas dentro de
`infra/supabase/volumes/`. `infra:down` no usa `--volumes`, por lo que apagar,
recrear o actualizar contenedores no borra la base ni los archivos.

### Desarrollo frente a producción

- Desarrollo: secretos generados en `infra/supabase/.env`, solo para la máquina
  local y reemplazables si se reinicia deliberadamente el entorno.
- Producción: secretos distintos, largos y gestionados como variables protegidas
  de Coolify. Nunca se copia el `.env` local ni se versionan valores reales.
- El VPS debe montar volúmenes persistentes fuera del ciclo de vida de los
  contenedores y tener una copia de seguridad externa tanto de PostgreSQL como
  de Storage.

La preparación local no constituye todavía el despliegue productivo: red,
dominios, TLS, copias, restauración y rotación de secretos se cerrarán en la
tarea específica de Coolify.

### Verificación realizada

El 20 de octubre de 2026 se comprobó:

1. salud de PostgreSQL, Auth, Storage y Realtime;
2. escritura de un registro temporal y un archivo temporal;
3. apagado y recreación completa de los contenedores;
4. lectura exacta de ambos elementos después del reinicio;
5. eliminación de los datos temporales de prueba.

## Aplicaciones

```powershell
pnpm dev
```

- Web: `http://localhost:3000`.
- API: `http://localhost:3001`.
- Endpoint de salud: `http://localhost:3001/health`.
- Correos locales de Auth: `http://localhost:9000` (Inbucket; no entrega
  mensajes fuera de la máquina).

El arranque local agrega un capturador SMTP aislado para probar invitaciones y
recuperación de contraseña sin enviar correos reales. Producción no usa este
servicio: allí `SMTP_HOST`, credenciales y remitente deben apuntar al proveedor
de correo configurado en Coolify.

El recorrido local de creación y entrega de negocios está documentado en
[Aprovisionamiento de negocios](./aprovisionamiento-negocios.md).

## Controles antes de integrar cambios

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

### Estado de auditoría de dependencias

Al 20 de octubre de 2026, `pnpm audit --prod --audit-level high` no informa
vulnerabilidades conocidas en dependencias de producción. La auditoría completa
sí informa `GHSA-vfj7-8cjw-p6xm` en `braces`, dependencia transitiva de las
herramientas de ESLint. El registro no publica aún una versión corregida. El
riesgo queda limitado al proceso local de lint (sin patrones aportados por
usuarios) y debe revisarse cuando Next.js actualice su cadena de ESLint.
