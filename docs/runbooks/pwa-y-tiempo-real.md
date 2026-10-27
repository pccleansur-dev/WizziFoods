# PWA, reconexión y tiempo real (T31)

Las pantallas del personal se mantienen al día con Supabase Realtime, el comensal ve cuándo no hay conexión y
**ninguna escritura crítica se da por enviada hasta que el servidor la confirma**. Realtime es una mejora: sin él
(o sin su secreto) todo sigue funcionando con el polling de siempre.

## Regla de oro

Realtime **avisa que algo cambió; nunca lleva datos**. Al recibir el aviso, y después de cada reconexión, la
pantalla le pide a la API el estado autoritativo con la sesión de la persona. Un aviso perdido no cuesta nada: el
próximo sondeo o la próxima reconexión lo repara.

## Canales privados

Cada cambio en la base se anuncia en un canal `tenant:<negocio>:location:<local>:<tema>` (migración
`20261031010000_realtime_invalidation.sql`, rollback probado, pgTap `realtime_invalidation.test.sql`):

| Tema                 | Lo escuchan                                     | Lo disparan                                                                                    |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `salon`              | quien atiende, valida o cobra (mozo, Encargado) | llamados, intenciones, pedidos confirmados, sesiones, pedidos de caja, plano, grupos, el libro |
| `cash`               | el Encargado (`operations.approve`)             | turnos y movimientos de caja, el libro                                                         |
| `production-kitchen` | Cocina                                          | ítems de producción de sectores de cocina                                                      |
| `production-bar`     | Barra                                           | ítems de producción de sectores de barra                                                       |

- **Quién puede oír qué** lo decide un token de 10 minutos que firma la API (`POST /v1/staff/realtime/token`, con
  la sesión del personal) con el claim `channels`. La política de `realtime.messages` deja suscribirse sólo a los
  canales de ese claim. Un navegador **no puede escribir** en ningún canal (no hay política de inserción), un usuario de
  Supabase Auth sin ese claim no oye nada y un token vencido o de otra clave es rechazado.
- **Cobertura:** un cambio que alguna pantalla lee y no anuncia tarda hasta 60 s en verse (el latido). Por eso hay
  disparadores en 24 tablas: llamados, intenciones, pedidos, sesiones, caja, libro, plano, grupos, partes de cuenta (y quién las
  tomó), decisiones de cuenta, ajustes, pagos online, estado de servicio y asignación de sectores. **Si una pantalla
  nueva lee una tabla nueva, hay que agregarle su disparador** (migración + prueba pgTap).
- Dentro de una transacción un tema se anuncia **una sola vez** y publicar nunca hace fallar la escritura (todo
  envío está protegido). Un aviso de una transacción que se revierte no sale.
- No hay repetición: si una pantalla estuvo desconectada no recibe lo que se perdió; por eso **vuelve a consultar al
  reconectar**.

### Configuración

```text
SUPABASE_JWT_SECRET=...   # el JWT_SECRET de la pila Supabase (>= 32 caracteres). Sólo la API.
```

Sin esa variable la API responde 503 al pedir un token y las pantallas siguen con sondeo cada 5 s. En el navegador
se usan `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ya existentes). Con
`NEXT_PUBLIC_PWA_CACHE=1` el service worker cachea también en desarrollo (en producción es automático).

## Cómo se mantiene una pantalla (`apps/web/src/lib/live-sync.ts`)

Un solo mecanismo para el salón y la producción, probado con reloj simulado:

1. Pide el estado cuando Realtime confirma la suscripción (y otra vez cada vez que se resuscribe).
2. Ante un aviso espera 150 ms (junta ráfagas), pide el estado y, si llegó otro aviso mientras tanto, pide una vez más.
3. Mientras Realtime está arriba, un latido de seguridad cada 60 s; sin Realtime, sondeo cada 5 s. Sólo con la
   pestaña visible, y al volver a ella pide el estado enseguida.
4. **Sin conexión** (el navegador lo avisa): cierra Realtime, no pide nada, muestra «Sin conexión. Estás viendo la última
   información de las HH:MM…» y bloquea lo que cambia datos. Al volver olvida la caché del service worker, pide el
   estado y reabre Realtime. Se repite las veces que haga falta (probado cinco ciclos en pruebas y tres en E2E).
5. **Servidor caído o lento**: si el estado no se puede leer, dice «No podemos comunicarnos con el servidor…» y
   vuelve a preguntar a los pocos segundos aunque Realtime siga arriba; una respuesta lenta se espera sin falsa alarma.
6. El token se renueva al 80 % de su vida; si no se puede renovar y vence, cae al sondeo.

El indicador (`data-live-status`: `live`, `polling`, `reconnecting`, `offline`) está siempre en la página; sólo los
estados degradados muestran texto.

## Escrituras críticas: esperan al servidor y no se duplican

- Sin conexión **nada sale**: ni se encola ni se muestra como enviado. Mozo/Cocina/Barra muestran «Sin conexión: no se
  envió nada…» y el comensal no puede enviar el pedido.
- Con conexión, el resultado es lo que contesta el servidor (nunca una confirmación optimista).
- Si la llamada **falla en el camino** (se cortó la red, se perdió la respuesta) el resultado es _desconocido_
  (`settleAction`): se avisa «No pudimos confirmar si se envió. Podés volver a intentarlo: no se repite.» y se **conserva el
  `commandId`**. Reintentar manda el mismo comando y el servidor devuelve lo que ya hizo. Antes, una llamada cortada dejaba
  la pantalla «ocupada» para siempre.
- Una respuesta definitiva (éxito o rechazo con código) cierra el comando; un cambio de datos genera uno nuevo. El pedido
  del comensal ya usaba un `commandId` estable por contenido.

## Service worker (`apps/web/public/sw.js`)

Registrado en toda la web (`PwaRegistrar`, al terminar de cargar y con el navegador libre; un fallo es silencioso).

- **Siempre:** guarda `/offline.html` y la muestra cuando una navegación no llega al servidor.
- **Con `?cache=1` (producción):** archivos con hash de `/_next/static/` primero de caché, y la carta del comensal
  `/m/<token>` primero de red (la última copia sólo si falla la red, máximo 12). La página dice que puede estar vieja,
  no deja enviar pedidos y al volver la conexión olvida la copia y pide la carta de nuevo (`DinerConnection`).
- **Nunca:** pantallas del personal, `/cuenta`, `/panel`, respuestas de API, cuentas, pedidos ni nada que no sea un GET.
- Reconectar le avisa al worker (`postMessage({type:"invalidate"})`) y descarta las lecturas guardadas.
- Un solo script (`serviceWorkerUrl()`): push y offline comparten el mismo registro, así el navegador no lo alterna.
- El manifest y los íconos con el logo del restaurante son los de T30.

## Pruebas

- pgTap `realtime_invalidation.test.sql` (13): un cambio anuncia una vez, sin datos, sólo en el canal del negocio;
  quién oye (token con el canal, con otro canal, de otro negocio, sin canales, claim malformado, anónimo); nadie escribe.
- `apps/api/src/realtime/realtime.test.ts` (6): canales por rol, token firmado/verificado/vencido, apagado sin secreto.
- **Carga y aislamiento** `local-realtime.integration.test.ts` (5, contra Realtime real): cada rol oye sólo lo suyo,
  un mozo no puede pedir el canal de Cocina ni un vecino el de otro local, token vencido rechazado, sin repetición tras
  desconectar, y 120 oyentes de dos negocios (`REALTIME_LOAD_CLIENTS`, 60 por negocio por defecto) con 20 cambios en
  ráfaga: todos reciben exactamente los de su negocio.
  **Límite medido:** con 300 oyentes la pila local rechaza suscripciones; el tenant de Realtime de desarrollo permite
  unas 200 conexiones concurrentes. En producción hay que dimensionar `max_concurrent_users`, `max_events_per_second`
  y `max_joins_per_second` del tenant de Realtime según la cantidad de pantallas abiertas.
- `live-sync.test.ts` (9), `settle-action.test.ts`, `connection-view.test.ts` y `service-worker.test.ts` (11).
- Playwright `e2e/connectivity.spec.ts` (móvil y escritorio): la Cocina recibe un pedido por Realtime en segundos (el
  latido es de un minuto), tres ciclos sin conexión con cambios ocurridos mientras tanto, servidor 503 y servidor
  lento, una respuesta perdida reintentada sin duplicar (un solo evento y un solo comando en la base), recarga sin
  conexión que muestra la página sin conexión y vuelve sola, y el comensal sin conexión (carta vieja, no envía, y al
  volver el pedido sale una sola vez).

## Fuera de alcance / pendientes

- El comensal sigue sin Realtime: ve el estado de su pedido con las consultas de siempre.
- El modo `cache=1` está probado en unidad y con una compilación de producción no corrida en CI; falta un E2E contra
  `next start` con la caché activa.
- Cola de escrituras sin conexión: a propósito **no existe** (la regla es no dar nada por enviado).
- Reintentos automáticos de acciones críticas: hoy el reintento lo decide la persona, con el mismo comando.
- Dimensionar y probar el Realtime de producción (límites arriba).
