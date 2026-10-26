# WhatsApp y automatizaciones básicas (T30)

Cada restaurante conecta **su** número de WhatsApp Business (Cloud API de Meta) y la plataforma
envía avisos de fidelización respetando consentimiento, horario, topes y bajas. Todo es opcional:
la carta, el login y los pedidos no consultan este módulo y la falta de configuración no los
bloquea ni los demora.

> Existe un segundo canal sobre la misma política, cola y panel: los **avisos en la app (Web Push de
> la PWA)**, descritos en `docs/runbooks/avisos-pwa.md`. Los cupos (2 por semana y 8 por mes) son por
> persona y valen para ambos canales.

> **Los envíos reales están apagados por defecto.** Hay tres llaves independientes y las tres
> deben abrirse a propósito: `WHATSAPP_MODE` (servidor), «Envíos activados» (por conexión) y la
> aprobación de cada automatización o la confirmación de cada evento puntual. El Checkpoint 9
> exige revisión legal y comercial de consentimientos y mensajes **antes** de activar envíos
> reales.

## Modelo

Tablas privadas, todas con `tenant_id` y `location_id` (migración `20261030010000_create_messaging.sql`):

| Tabla                      | Qué guarda                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `whatsapp_connections`     | Una por ubicación: `phone_number_id` (único en toda la plataforma), WABA id, `sending_enabled` (apagado por defecto) y el token **sellado**.           |
| `whatsapp_templates`       | Nombre, idioma, categoría (`operational`/`promotional`), texto, estado de aprobación y costo estimado por mensaje (lo carga el Encargado).             |
| `messaging_automations`    | Las cuatro permanentes (`reward_earned`, `reward_expiring`, `birthday`, `inactivity`). Nacen `pending_approval`; el Encargado las aprueba **una vez**. |
| `messaging_outbox`         | La cola: estado, intentos, `next_attempt_at`, lease y clave de idempotencia por **perfil y evento** (`unique (tenant, profile, event_key)`).           |
| `messaging_events`         | Historial **append-only**: en cola, enviado, entregado, leído, fallido, bloqueado (con motivo), pospuesto, reintento, cancelado y baja.                |
| `messaging_webhook_events` | Cada notificación de Meta se registra una vez (deduplicación).                                                                                         |

El token nunca llega al navegador ni a una respuesta: lo sella la API con el mismo
`PaymentSecretSealer` que Mercado Pago (AES-256-GCM, autenticado con tenant, ubicación y método
`whatsapp`; ahora vive en `@platform/integrations`) y el worker lo abre en memoria. Las funciones de
un tenant nunca devuelven correo, `account_id` ni datos de otro tenant; el teléfono del comensal sólo
sale hacia el worker en el instante de enviar.

## La política de envío

Vive en **una** función: `private.messaging_send_decision`. Si algo falla, falta o es desconocido,
el mensaje se **bloquea**; nunca se envía por defecto. Orden de las reglas:

1. perfil anonimizado, sin teléfono, número no conectado, **envíos apagados**;
2. plantilla aprobada y de la misma categoría que al encolar; automatización `approved` o evento
   puntual confirmado;
3. consentimiento vigente leído de `diner_consent_state` (nunca del teléfono suelto): operativo
   exige `whatsapp_verified`; promocional exige `marketing` **y** `whatsapp_verified` (decisión
   más estricta que el mínimo del plan: no se promociona a un número no verificado);
4. los operativos salen enseguida y no consumen cupo. Los promocionales además:
   - 12 meses sin actividad (visita, vínculo a una cuenta, consentimiento o cambio de perfil) los
     frena hasta renovar el consentimiento, que cuenta como actividad;
   - tope de **2 por semana y 8 por mes** por persona y restaurante (ventanas móviles de 7 y 30
     días; cuentan los que están `sending`, `sent` o `delivered`);
   - horario de **10:00 a 20:00** en `locations.timezone` (20:00 ya es fuera). Fuera de horario no
     se bloquea: se **pospone** a las 10:00 siguientes sin gastar un intento.

`begin_messaging_send` toma un candado por persona antes de decidir y marca el mensaje `sending`
en la misma transacción: por eso dos workers (o dos mensajes) no pueden saltarse los topes ni
enviar dos veces el mismo mensaje. Sólo un mensaje `queued` puede empezar.

### BAJA

Si la persona responde `BAJA` (o `STOP`, sin importar mayúsculas, acentos ni puntuación), el
webhook revoca `marketing` con el origen propio `whatsapp_optout` (los consentimientos siguen
siendo append-only), bloquea al instante lo promocional que esperaba y deja un evento `opt_out`.
Sólo afecta al restaurante cuyo número recibió el mensaje. El consentimiento operativo no cambia.

## Cola, reintentos y ciclo de vida

```text
queued ──claim──▶ (lease) ──begin──▶ sending ──finish──▶ sent ──webhook──▶ delivered
   ▲                  │ block/defer        │ transient (≤ 5 intentos)
   └──────────────────┴────────────────────┘ espera 30 s, 1 min, 2 min… (máx. 1 h)
```

- `claim_messaging_outbox` usa `for update skip locked` y un lease (como la cola del importador de
  catálogo): un mensaje reclamado es invisible para otros workers.
- Falla transitoria (red, 5xx, 429, códigos de límite de Meta): vuelve a `queued` con espera
  creciente; no consume cupo porque el mensaje no salió. Al quinto intento queda `failed`
  (`retries_exhausted`). Falla permanente (número inválido, token revocado): `failed` de inmediato.
- Un mensaje que quedó `sending` con el lease vencido **no se reenvía** (no se sabe si salió): se
  cierra como `failed` (`lost_lease`). Es preferible perder un aviso que duplicarlo.
- Eventos que crean mensajes: el premio ganado (disparador sobre `loyalty_rewards`, que se traga
  sus errores y nunca falla la visita) y, desde el worker cada minuto, premio por vencer (3 días),
  cumpleaños (día local) e inactividad (90 días). Sin automatización aprobada no se encola nada.

## Automatizaciones y eventos puntuales

- **Permanentes:** el Encargado elige una plantilla aprobada, la aprueba una vez y corren solas.
  Cambiar la plantilla —o que Meta cambie su texto o categoría— vuelve a `pending_approval`. Se
  pueden pausar y reanudar sin nueva aprobación.
- **Puntuales** (promoción, show, aviso único): el Encargado elige plantilla y personas (hasta 200)
  y **prepara** el envío; nada sale hasta **confirmar** cada vez. Confirmar dos veces no envía dos
  veces. Es un envío a personas elegidas, no un constructor de campañas masivas.

## Rutas

| Método         | Ruta                                                    | Quién                              |
| -------------- | ------------------------------------------------------- | ---------------------------------- |
| `GET`          | `/v1/staff/messaging`                                   | Encargado (`operations.approve`)   |
| `GET`          | `/v1/staff/messaging/events`, `/audience`               | Encargado                          |
| `PUT`/`DELETE` | `/v1/staff/messaging/connection`                        | Encargado                          |
| `PUT`          | `/v1/staff/messaging/sending`                           | Encargado                          |
| `POST`         | `/v1/staff/messaging/templates/sync`                    | Encargado                          |
| `PUT`          | `/v1/staff/messaging/templates/:id/cost`                | Encargado                          |
| `PUT`          | `/v1/staff/messaging/automations`                       | Encargado                          |
| `POST`         | `/v1/staff/messaging/automations/:id/decision`          | Encargado                          |
| `POST`         | `/v1/staff/messaging/one-off-events` y `…/:id/decision` | Encargado                          |
| `GET`/`POST`   | `/v1/webhooks/whatsapp`                                 | Meta (firma `X-Hub-Signature-256`) |

El restaurante sale de la sesión del personal; los cuerpos con campos de más devuelven 400. Conectar
exige que Meta acepte el token (se listan las plantillas antes de guardar nada). Sin
`WHATSAPP_MODE` las rutas responden 503 (`MESSAGING_NOT_AVAILABLE`) y el webhook 404.

### Webhook

`GET` responde el desafío sólo con el `WHATSAPP_VERIFY_TOKEN` correcto. `POST` verifica la firma
HMAC-SHA256 de los **bytes exactos** del cuerpo (`rawBody: true` en `main.ts`) antes de leer nada;
cada notificación se registra una vez (`status:<id>:<estado>`, `message:<id>`); una que falló a
mitad queda sin cerrar y se reaplica cuando Meta reintenta. El restaurante se identifica por el
`phone_number_id` de la notificación, nunca por algo que diga el remitente.

## Configuración

```text
WHATSAPP_MODE=off            # off (predeterminado) | simulated | meta
WHATSAPP_APP_SECRET=...      # >= 16 caracteres; firma del webhook (secreto de la app de Meta)
WHATSAPP_VERIFY_TOKEN=...    # >= 16 caracteres; desafío de registro del webhook
WHATSAPP_GRAPH_VERSION=v21.0 # opcional
PAYMENT_SECRET_KEY=<32 bytes aleatorios en base64>   # obligatoria si el modo no es off
```

Lo leen la API y el worker. `simulated` está **prohibido en producción** (como el simulador de
Mercado Pago) y no envía nada: registra lo que se le pidió y puede fallar a pedido
(`SimulatedWhatsappProvider.failNext`). `meta` usa la WhatsApp Cloud API
(`MetaWhatsappProvider`). La conexión es manual: el Encargado carga ID del número, ID de la cuenta
y token en el panel **Mensajería**; no hay OAuth ni Embedded Signup todavía.

## Pantalla

`/interno/<slug>/operacion/mensajeria` (sólo `operations.approve`): conexión (token una vez),
interruptor «Envíos activados», plantillas con costo estimado y uso del mes, las cuatro
automatizaciones (guardar plantilla → aprobar/pausar/reanudar), evento puntual (preparar →
confirmar/cancelar) y registro de envíos con el motivo de cada bloqueo.

## Pruebas

- pgTap `supabase/tests/database/messaging.test.sql` (173 aserciones, con el canal de push; dos tenants): permisos,
  aislamiento, credenciales, plantillas, aprobación, cada regla de la política (consentimientos,
  horario en 09/10/20/23 h, topes semanal y mensual, 12 meses, anonimizado), BAJA, cola, reintentos,
  lease perdido, deduplicación del webhook, historial append-only y desconexión.
- Rollback probado aplicar → revertir → reaplicar: `supabase/rollbacks/20261030010000_create_messaging.down.sql`
  (la restricción de origen de los consentimientos vuelve `NOT VALID` para no chocar con las bajas ya
  registradas, que no se pueden editar).
- Carreras reales: `packages/database/src/messaging-repository.integration.test.ts` (confirmar 8 veces
  el mismo evento, el mismo evento automático 8 veces, dos workers sobre el mismo mensaje, seis
  promocionales a la vez contra el tope, webhook repetido).
- Worker con proveedor simulado: `apps/worker/src/messaging-worker.integration.test.ts` (límites,
  reintentos con espera creciente y agotamiento, falla permanente, BAJA, horario, tres workers sin
  duplicar).
- API y webhook firmado: `apps/api/src/messaging/local-messaging.integration.test.ts` y
  `messaging.controller.test.ts`; adaptadores en `packages/integrations`; E2E `e2e/messaging.spec.ts`
  (móvil y escritorio).

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A < supabase/tests/database/messaging.test.sql
```

Los limpiadores que borran un tenant deben borrar antes, con `session_replication_role = replica`,
`messaging_events`, `messaging_outbox`, `messaging_automations`, `whatsapp_templates` y
`whatsapp_connections` (el historial y la cola rechazan `delete`), además de la lista de T28 y T29.

Códigos nuevos: `PT293` sin conexión, `PT294` número conectado en otro negocio, `PT295` plantilla
inexistente o sin aprobar, `PT296` automatización inválida, `PT297` datos inválidos, `PT298` evento
puntual inexistente. **Códigos usados hasta ahora: `PT201`–`PT298`.**

## Argentina y Chile

El módulo no tiene reglas por país: sirve para ambos con estos puntos.

- **Zona horaria:** el horario de 10 a 20 h usa `locations.timezone` de cada local
  (`America/Argentina/Buenos_Aires`, `America/Santiago`). Chile cambia de hora en verano e
  invierno y la política lo respeta (probado en pgTap con fechas de noviembre y julio).
- **Teléfonos:** formato internacional (`+54 9 11…`, `+56 9…`). Meta informa un móvil argentino
  a veces con el 9 (`+549…`) y a veces sin él (`+54…`); para asociar un BAJA a su perfil se ignora
  ese 9 (`private.messaging_phone_key`), de modo que el opt-out no falla por la grafía. El envío usa
  el número tal como lo guardó la persona; **hay que confirmar en el sandbox real de Meta que
  acepta `+549…` como destino**.
- **Idioma de las plantillas:** `es_AR` y `es_CL` son válidos. El simulador sólo trae `es_AR`, y los
  textos del panel están en voseo argentino.
- **Moneda:** el costo estimado por mensaje se muestra en pesos argentinos (`ARS`); para Chile
  (CLP, sin centavos) hay que parametrizar la moneda por local. Pendiente.
- **Revisión legal (Checkpoint 9):** hay que hacerla por país. Argentina: Ley 25.326 de protección
  de datos personales y el Registro «No llame» (Ley 26.951). Chile: Ley 19.628, la reforma de la
  Ley 21.719 (entra en vigencia a fines de 2026, verificar la fecha) y la Ley 19.496 del
  consumidor. Esto es una lista de lo que debería mirar un abogado, no una opinión legal.
- Un restaurante, un país: si algún día un mismo tenant opera en ambos, cada local ya tiene su
  propia zona, su propio número y sus propias plantillas.

## Fuera de alcance / pendientes

- **Verificación del número del comensal** (hoy sólo se registra el consentimiento y el teléfono): es
  una tarea aparte.
- **Sandbox real de Meta:** la integración se probó con el simulador y con el adaptador de Meta sobre
  un `fetch` falso. Falta una corrida contra un número de prueba real con plantilla aprobada.
- **Costos facturables:** el costo por mensaje es una estimación que carga el Encargado; no se concilia
  con la factura de Meta.
- Embedded Signup/OAuth de Meta, renovación de tokens y rotación de `PAYMENT_SECRET_KEY`.
- Estados de entrega en tiempo real en el panel y mensajes con encabezado, botones o medios.
- Revisión legal y comercial de textos y consentimientos (Checkpoint 9) antes de activar envíos reales.
