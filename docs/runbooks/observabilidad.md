# Observabilidad y correlación

Esta etapa deja una base común para `web`, `api` y `worker`. Cada proceso emite
logs JSON, operaciones trazables y métricas Prometheus. El stack de paneles y alertas está descrito en `observabilidad-produccion.md`; Loki y Tempo se incorporarán con la infraestructura de producción; la aplicación
ya usa identificadores y formatos que permiten conectarlos sin cambiar la lógica
de negocio.

## Puertos locales

| Servicio | Aplicación | Métricas Prometheus |
| -------- | ---------: | ------------------: |
| Web      |       3000 |                9466 |
| API      |       3001 |                9464 |
| Worker   |          — |                9465 |

Por ejemplo, `http://localhost:9464/metrics` expone el total y la duración de
solicitudes HTTP de la API. Los puertos son obligatorios y se configuran en el
`.env` local a partir de `.env.example`.

## Seguir una solicitud

El cliente puede enviar `x-request-id` con entre 8 y 128 caracteres seguros. Si
no lo hace o el valor es inválido, la plataforma genera un UUID. Web y API
devuelven:

- `x-request-id`: correlación funcional de la solicitud.
- `x-trace-id`: identificador de la traza que aparece en los logs.

Prueba rápida contra la API:

```powershell
curl.exe -i -H "x-request-id: request-smoke-01" http://localhost:3001/health
```

Para reconstruir el recorrido, buscar el mismo `requestId` o `traceId` en los
logs JSON. Toda entrada propia incluye además `service`, `environment`,
`entryPoint` y `event`.

## Privacidad y cardinalidad

- Autorizaciones, cookies, contraseñas, secretos, tokens, PIN, teléfono,
  WhatsApp, email y datos de tarjeta se reemplazan por `[REDACTED]` cuando están
  presentes como campos estructurados.
- No registrar cuerpos completos, encabezados completos ni parámetros de
  consulta.
- Las métricas HTTP usan únicamente etiquetas acotadas: servicio, método, ruta
  definida por el servidor y clase de estado (`2xx`, `4xx`, etc.). Nunca llevan
  tenant, usuario, mesa, email o identificadores de solicitud.

## Diagnóstico inicial

1. Confirmar que el proceso emitió `service_started` y revisar su `metricsPort`.
2. Consultar `/health` en la API y el endpoint de métricas del servicio.
3. Buscar `http_request_completed` por `requestId`.
4. Buscar `trace_completed` por el `traceId` asociado.
5. En el worker, verificar la presencia periódica de `worker_heartbeat`.

## Procesamiento de imágenes del negocio

Las preguntas operativas que debe responder la telemetría son:

1. ¿El worker está completando, rechazando o recuperando trabajos?
2. ¿Hay fallos transitorios que estén dejando trabajos para reintento?
3. ¿La cola o la base dejaron de estar disponibles antes de tomar un trabajo?

Los eventos estables son `business_media_job_completed`,
`business_media_job_rejected`, `business_media_job_recovered`,
`business_media_job_retry` y `business_media_queue_retry`. Los cuatro primeros
incluyen correlación de traza y el identificador interno del mensaje, pero nunca
la ruta del archivo, su contenido ni el error devuelto por el proveedor. Un
trabajo con `business_media_job_retry` no se confirma: vuelve a estar visible al
vencer `WORKER_VISIBILITY_TIMEOUT_SECONDS`. Un evento
`business_media_job_recovered` confirma que el procesamiento ya había llegado a
estado terminal y que el worker completó el acuse pendiente sin reprocesar la
imagen.

Si falta una variable obligatoria, el servicio finaliza antes de aceptar tráfico
y emite `service_start_failed`. Nunca debe reemplazarse una variable ausente por
un valor de producción implícito.

## Puerta local y CI

`pnpm ci:check` reproduce los controles deterministas de CI. La auditoría de
dependencias requiere red y se ejecuta por separado con:

```powershell
pnpm audit --prod --audit-level high
```

La detección de secretos se puede ejecutar sola con `pnpm security:secrets`. El
resultado informa únicamente archivo, línea y regla; nunca imprime la posible
credencial.
