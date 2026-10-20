# Origen de la composición

Esta carpeta deriva de `supabase/supabase/docker` y está fijada al release
oficial `self-hosted/v0.8.2` (commit `564eab8`). Se conserva localmente para que
el desarrollo y los despliegues no dependan de archivos remotos mutables.

Cambios deliberados del proyecto:

- secretos locales generados por `packages/infra` en vez de valores de ejemplo;
- claves JWT asimétricas y JWKS habilitadas;
- registro público y autenticación por teléfono/correo desactivados por defecto;
- gateway público local en `18000` para evitar la colisión con Coolify;
- PostgreSQL y el pool transaccional publicados en `54322` y `65432`;
- datos de PostgreSQL y Storage persistidos fuera de los contenedores.

Antes de actualizar la copia se deben revisar las notas del release, comparar el
directorio oficial completo, adaptar nuestros cambios y repetir las pruebas de
salud y persistencia. Referencias:

- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys
- https://github.com/supabase/supabase/tree/master/docker
