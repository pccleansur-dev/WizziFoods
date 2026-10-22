# Contexto tenant

## Autoridad del contexto

El contexto de negocio siempre se obtiene de una fuente verificada. Ningún
endpoint acepta `tenant_id` enviado en el cuerpo, la consulta o una cabecera del
cliente como autoridad.

- En rutas públicas, la API normaliza el encabezado HTTP `Host` y busca un
  dominio activo que pertenezca a un tenant activo. Un host desconocido,
  ambiguo o inválido responde de forma segura sin revelar otro negocio.
- La aplicación no confía directamente en `X-Forwarded-Host`. En producción,
  Coolify y el proxy deben conservar el `Host` original al reenviar la
  solicitud.
- En rutas administrativas del negocio, primero se verifica la sesión, luego el
  host y finalmente se exige que la membresía autenticada coincida tanto con el
  tenant como con la ubicación resueltos por ese host.
- Un Superadmin administra la plataforma, pero no entra silenciosamente en la
  operación de un tenant.

El endpoint `GET /v1/tenant/context` aplica las tres verificaciones en ese orden
y devuelve el contexto que el backend ya autorizó.

## Dominios iniciales y publicación

Al aprovisionar un negocio se reserva automáticamente
`<slug>.<PLATFORM_BASE_DOMAIN>` como subdominio principal. El dominio puede
estar activo mientras el tenant continúa en estado `draft`: hasta que el tenant
sea publicado y pase a `active`, el contexto público permanece inaccesible.

Los dominios personalizados y su verificación se incorporarán en una etapa
posterior. No deben activarse sólo porque el cliente haya enviado un nombre de
dominio.

## Jobs, Storage y Realtime

Los límites asíncronos reutilizan el mismo objeto `TenantScope`, compuesto por
`tenantId` y `locationId`:

- Los jobs usan un `TenantJobEnvelope` estricto y el worker comprueba que su
  alcance coincida con el de la cola antes de ejecutar el payload.
- Storage obtiene la ruta desde `tenantStoragePrefix(scope)`; no concatena un
  identificador recibido sin validar.
- Realtime obtiene el nombre del canal desde `tenantRealtimeChannel(scope)`;
  productor y consumidor deben validar el mismo alcance.

Estos helpers definen el formato seguro. Los módulos funcionales que incorporen
archivos o eventos deben usarlos y sumar sus políticas RLS específicas.

## Prueba local

Con Supabase local saludable y las URLs de base configuradas, ejecutar:

```powershell
pnpm --filter @platform/api test:integration
```

El smoke test crea dos tenants con subdominios diferentes, verifica que cada
host resuelva exclusivamente su propio negocio, intenta falsificar
`X-Forwarded-Host` y confirma que un host desconocido responda `404`. Los datos
descartables se eliminan al finalizar.

Los contratos y guards también tienen pruebas unitarias para rechazar alcances
cruzados, campos extra y `tenant_id` inyectado por el cliente.
