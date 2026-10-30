# Despliegue con Coolify (desde GitHub)

Coolify clona el repositorio de GitHub, construye las imágenes con el `Dockerfile` de la raíz y levanta todo con
`infra/deploy/docker-compose.yml`: **Supabase** (base, Auth, Storage, Realtime, gateway), una tarea **`migrate`** que aplica
las migraciones y las tres aplicaciones (**`api`**, **`worker`**, **`web`**). Cada despliegue nuevo vuelve a construir y a
migrar; los datos viven en volúmenes con nombre y no se pierden.

## Qué hay en el repositorio para esto

| Archivo                                | Para qué                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Dockerfile`                           | Un solo archivo, tres imágenes (`--target api`, `worker`, `web`). Sin secretos adentro.                                                                                                                                                                      |
| `infra/deploy/docker-compose.yml`      | La pila de producción. Reutiliza (`extends`) las definiciones fijadas de `infra/supabase/docker-compose.yml`, salvo el gateway (sin Studio ni puerto publicado). Sin etiquetas YAML propias (`!reset`, `!override`): el analizador de Coolify no las acepta. |
| `infra/deploy/migrate.sh`              | Aplica `supabase/migrations/*.sql` en orden, registra cada una con su checksum y **se niega** a seguir si una ya aplicada cambió.                                                                                                                            |
| `packages/infra/src/production-env.ts` | `pnpm deploy:env --domain <dominio>`: genera todos los secretos y las direcciones públicas.                                                                                                                                                                  |
| `.dockerignore`                        | Deja fuera `.env`, secretos, datos locales y todo lo que no hace falta para construir.                                                                                                                                                                       |

## 1. Dominio y acceso desde internet

Esquema de nombres de **un solo nivel** bajo un dominio que ya está en Cloudflare (acá `wizzi.com.ar`, sufijo `carta`). Un solo
certificado comodín gratuito de Cloudflare (`*.wizzi.com.ar`) los cubre a todos:

| Nombre                         | Va a                   | Para qué                                                 |
| ------------------------------ | ---------------------- | -------------------------------------------------------- |
| `app-carta.wizzi.com.ar`       | `web` (puerto 3000)    | Panel del administrador y pantallas del personal         |
| `api-carta.wizzi.com.ar`       | `api` (puerto 3001)    | Webhooks (Mercado Pago, WhatsApp) y callbacks de ingreso |
| `supabase-carta.wizzi.com.ar`  | `api-gw` (puerto 8000) | Auth, Storage y Realtime que usa el navegador            |
| `<negocio>-carta.wizzi.com.ar` | `web` (puerto 3000)    | Un nombre por negocio: carta del comensal y operación    |

Cada negocio nuevo recibe `<slug>-carta.wizzi.com.ar` (plantilla `PLATFORM_TENANT_HOST_TEMPLATE`). **Cambiar de esquema mañana**
(un dominio propio del producto, o el dominio propio de un cliente con un CNAME) es cambiar esa variable o registrar otra dirección
del negocio (`tenant_domains`, tipo `custom`); no hay que tocar código.

Esta computadora ya tiene **Cloudflare Tunnel** (`cloudflared`) delante de Coolify: en Cloudflare Zero Trust → Tunnels → _Public
hostnames_ agregá cada nombre de arriba apuntando al proxy de Coolify (`http://localhost:80`). Para los negocios, agregá un nombre
por negocio (o el comodín `*-carta.wizzi.com.ar` si Cloudflare lo permite en tu plan). Cloudflare pone el HTTPS; no hace falta abrir puertos en el router.

## 2. Variables

En esta máquina, desde la raíz del repositorio:

```bash
corepack pnpm deploy:env --domain wizzi.com.ar --suffix carta     # sin --suffix: app.<dominio>, <negocio>.<dominio>
```

Escribe `deploy-secrets/production.env` (solo para vos, ignorado por Git) con secretos nuevos y las direcciones
derivadas. **No lo imprime y no lo pisa si ya existe**: regenerar los secretos de un sistema en marcha dejaría fuera a todos y haría
ilegibles los tokens de pago guardados. **Guardá una copia fuera de esta máquina** (gestor de contraseñas): sin
`PAYMENT_SECRET_KEY` no se pueden leer las credenciales de pago guardadas.

Lo que queda **vacío a propósito** y completás cuando exista la cuenta: `SMTP_*` (correo: sin esto no llegan invitaciones ni
recuperación de contraseña), `MERCADO_PAGO_*` (modo `off`), `WHATSAPP_*` y `WEB_PUSH_*` (modo `off`), `GOOGLE_DINER_*`, `ANTHROPIC_API_KEY`.

## 3. Crear el recurso en Coolify

1. **Proyecto → Nuevo recurso → Docker Compose** (origen: _Private Repository_, con la GitHub App o la deploy key de Coolify
   instalada en el repositorio `pccleansur-dev/WizziFoods`).
2. Rama `main`. **Base Directory**: `/infra/deploy`. **Docker Compose Location**: `/docker-compose.yml`.
3. **Environment Variables → Developer view**: pegá el contenido de `deploy-secrets/production.env`.
4. En cada servicio con dominio, asigná el nombre de la tabla de arriba:
   `web` → `https://app.<dominio>:3000` y el comodín `https://*.<dominio>:3000`; `api` → `https://api.<dominio>:3001`;
   `api-gw` → `https://supabase.<dominio>:8000`. Marcá **«Connect to Predefined Network»** si el proxy no alcanza los servicios.
5. **Deploy**. El orden lo resuelve el compose: base → Auth/Storage/Realtime/REST → gateway → `migrate` → `api` y `worker` → `web`.

## 4. Primer ingreso

1. Esperá que `migrate` termine (`done: N migration(s) applied` en su registro) y que `api` quede _healthy_
   (`/ready` responde 200: llega a la base).
2. Crear al primer superadministrador de la plataforma: ver `docs/runbooks/aprovisionamiento-negocios.md` (las cuentas se crean por los flujos
   de la plataforma; el registro libre está desactivado).
3. Probar desde afuera: `https://api.<dominio>/ready` → `200`, `https://app.<dominio>/acceso` → pantalla de ingreso.

## 5. Actualizar y volver atrás

- **Actualizar:** `git push` a `main` (o _Redeploy_ en Coolify). Construye de nuevo, `migrate` aplica lo pendiente y recién ahí cambian `api`, `worker` y `web`.
- **Una migración ya aplicada no se edita.** Si cambió el archivo, `migrate` se detiene con el nombre del archivo: el cambio va en una migración nueva.
- **Volver atrás:** ver `lanzamiento.md` (sección «Cómo se vuelve atrás»): _Rollback_ de la aplicación en Coolify y, si la migración no convive con la versión
  anterior, su archivo de `supabase/rollbacks/`.
- **Si la construcción falla bajando paquetes** (`ERR_PNPM_BROKEN_METADATA_JSON`, `error (23)`, timeout contra `registry.npmjs.org` al ejecutar `pnpm deploy`): antes el
  `deploy` de `api` y `worker` usaba `--legacy`, que vuelve a resolver las dependencias contra el registro (con los metadatos completos que pide `minimumReleaseAge`;
  solo `next` pesa decenas de MB) y se colgaba hasta 30 minutos sin tocar el código. Ahora instala desde el `pnpm-lock.yaml` (`inject-workspace-packages` activado solo
  para ese comando): unos 20-35 segundos y sin `next` en las imágenes de API y worker. El `Dockerfile` también da más margen de red (4 reintentos, 120 s) y guarda los
  metadatos de pnpm en una caché de BuildKit. Un despliegue fallido deja la versión anterior en ejecución; reintentar con _Redeploy_.
- **Base que ya se migró a mano** (por ejemplo la local de desarrollo): `docker run … sh /migrate.sh --baseline` la marca como al día sin ejecutar nada.

## 6. Copias, monitoreo y seguridad en este servidor

- Copias y restauración: `copias-y-restauracion.md`. En este despliegue la base está en el volumen `db-data` y los archivos en `storage-data`
  (dentro del Docker de Coolify); los scripts de `infra/backup/` se ajustan a esos nombres (`DB_CONTAINER`, `STORAGE_DIR`).
- Monitoreo: `observabilidad-produccion.md` (apuntar a los nombres de servicio de la red del proyecto).
- Antes de abrir a un negocio real: `lanzamiento.md` (puertas, pendientes que cierra una persona y firma).
- **Una sola máquina** es un punto único de falla (la PC de esta computadora): sin destino externo de copias, un fallo del disco
  pierde todo. Es el primer pendiente de `docs/pendientes-y-mejoras.md`.
