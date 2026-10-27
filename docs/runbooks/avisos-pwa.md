# Avisos en la app (Web Push de la PWA)

Segundo canal de mensajería (T30), al lado de WhatsApp (`docs/runbooks/whatsapp.md`). Un comensal con
perfil puede activar **avisos en su dispositivo**; el restaurante le manda notificaciones del navegador
o de la app instalada. Es **opcional**: la carta, el login y los pedidos no dependen de esto y el
módulo apagado no bloquea nada.

> **Los envíos reales están apagados por defecto.** Hay tres llaves: `WEB_PUSH_MODE` (servidor),
> «Avisos en la app activados» (por local) y la aprobación de cada automatización o la confirmación
> de cada evento puntual. El Checkpoint 9 (revisión legal y comercial) rige igual para este canal.

## Qué comparte con WhatsApp y qué no

Comparte **todo** lo que decide y registra: la política de envío (`private.messaging_send_decision`),
la cola con reintentos, el historial append-only, las automatizaciones que se aprueban una vez, los
eventos puntuales que se confirman cada vez, el worker y el panel. Cada mensaje de la cola tiene un
`channel` (`whatsapp` o `web_push`).

| Tema           | WhatsApp                                                                                | Push de la PWA                                                                |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Cómo se llega  | al teléfono del perfil                                                                  | a cada navegador que la persona suscribió (hasta 10)                          |
| Textos         | plantillas aprobadas por Meta                                                           | mensajes que escribe el Encargado (hasta 240 caracteres), aprobados de origen |
| Conexión       | número, cuenta y token por restaurante                                                  | ninguna por restaurante: claves VAPID **de la plataforma**                    |
| Consentimiento | `whatsapp_verified` (+ `marketing` si es promoción)                                     | la suscripción (operativo) y además `marketing` si es promoción               |
| Baja           | responder BAJA                                                                          | desactivar los avisos, o revocar «Novedades y promociones»                    |
| Costo          | por mensaje, estimado en el panel                                                       | ninguno                                                                       |
| Cupos          | 2 por semana y 8 por mes por persona **entre ambos canales** (los operativos no gastan) | idem                                                                          |

La suscripción es un acto explícito de la persona (permiso del navegador más nuestro botón), queda
registrada con fecha y se puede revocar. **No** es un consentimiento de marketing: una promoción por
push exige además `marketing`, leído del historial append-only como en WhatsApp. Las reglas de horario
(10 a 20 h en la zona del local, las operativas salen enseguida), los 12 meses sin actividad y el perfil
anonimizado se aplican igual. Anonimizar un perfil revoca sus navegadores.

## Modelo

Migración `20261030020000_add_web_push_channel.sql` (rollback probado aplicar → revertir → reaplicar:
`supabase/rollbacks/20261030020000_add_web_push_channel.down.sql`):

- `push_subscriptions`: una fila por navegador (`endpoint` único, claves `p256dh` y `auth`), con
  `revoked_at` y motivo (`diner`, `gone`, `replaced`, `anonymized`). Sin correo ni cuenta global.
- `push_settings`: el interruptor por local (`sending_enabled`, apagado por defecto).
- Columna `channel` en `whatsapp_templates`, `messaging_automations` y `messaging_outbox`. Una
  automatización toma el canal de su plantilla; hay una por tipo y canal. Desconectar WhatsApp no toca
  los mensajes ni las automatizaciones de push.
- `claim_messaging_outbox` ahora recibe los canales que el worker puede entregar: uno que no entrega
  push deja esos mensajes en la cola para otro.
- Un mensaje de push repetido (mismo evento y persona) se descarta por la clave de idempotencia, que
  lleva el prefijo `push:`; el mismo evento puede llegar por los dos canales.

## Entrega

El worker (`apps/worker/src/messaging-worker.ts`) cifra el mensaje por navegador (RFC 8291,
`aes128gcm`) y lo firma con VAPID (RFC 8292) en `packages/integrations/src/web-push.ts`, sin
dependencias externas. La cifra se verifica contra el vector de prueba del propio RFC.

- Una persona con varios navegadores cuenta como **enviada** si al menos uno lo recibió (reintentar
  repetiría el aviso en ese).
- Un navegador que el servicio de push ya no conoce (404 o 410) se **revoca** y no se vuelve a usar.
  Si ninguno queda, el mensaje falla sin reintentos y los siguientes se bloquean (`no_subscription`).
- Falla temporal (red, 429, 5xx): vuelve a la cola con espera creciente, igual que WhatsApp.
- Las operativas salen con urgencia alta y las promocionales con baja.

## Configuración

```text
WEB_PUSH_MODE=off          # off (predeterminado) | simulated | live
WEB_PUSH_PUBLIC_KEY=...    # P-256 sin comprimir, base64url (65 bytes). La API se la da al navegador.
WEB_PUSH_PRIVATE_KEY=...   # 32 bytes en base64url. SOLO en el worker, nunca en la API ni en el repo.
WEB_PUSH_SUBJECT=mailto:soporte@ejemplo.com   # o https://...
```

Generar el par una sola vez y guardarlo como secreto de la plataforma (no por restaurante):

```bash
node -e "const c=require('node:crypto').createECDH('prime256v1');c.generateKeys();console.log('PUBLIC='+c.getPublicKey().toString('base64url'));console.log('PRIVATE='+c.getPrivateKey().toString('base64url'))"
```

Cambiar la clave pública invalida **todas** las suscripciones existentes (los navegadores deben volver
a suscribirse). `simulated` no envía nada y está prohibido en producción.

## Lo que ve cada persona

- **Comensal:** en `/cuenta`, «Avisos en este dispositivo» (sólo con perfil y si el restaurante lo
  ofrece): «Activar avisos» / «Desactivar avisos». En iPhone pide primero agregar la página a la
  pantalla de inicio (Apple sólo permite notificaciones a una web instalada). Un permiso bloqueado en
  el navegador se explica, no se insiste.
- **Encargado:** en «Mensajería», sección «Avisos en la app»: interruptor, cuántas personas lo tienen
  activo, sus mensajes (nombre, tipo, texto con `{{1}}` = nombre) y las automatizaciones y eventos
  puntuales con la plantilla de cada canal. El registro de envíos muestra ambos canales.

## Ícono y nombre: el logo del restaurante

La app instalada y sus notificaciones usan **el nombre, los colores y el logo que el Encargado ya cargó en el perfil del
negocio**; nada se configura aparte. Cada restaurante tiene su propio host, así que las mismas direcciones responden con la
marca del que corresponde.

- `GET /v1/public/brand` (API, por host) devuelve nombre, colores y una **versión** del logo (nunca la ruta del archivo);
  `GET /v1/public/brand/icon?size=180|192|512[&maskable=1]` devuelve un PNG cuadrado. Función de base:
  `private.get_public_brand` (migración `20261030030000_public_brand.sql`, rollback probado, pgTap `public_brand.test.sql`).
  Sólo cuenta un logo del mismo local en estado `ready` y de tipo `logo`.
- El logo vive en un bucket **privado**; el API lo lee con la clave de servicio y lo dibuja con `sharp` centrado sobre el
  color de fondo del restaurante (80 % del lado; 56 % en la versión `maskable`, para que Android pueda recortarlo en círculo).
  Sin logo, o si no se puede leer, se genera un cuadro del color principal con la inicial del nombre: un ícono nunca falla.
  Los íconos se guardan en memoria (64 como máximo) y se sirven con `cache-control: public, max-age=86400`.
- En la web: `app/manifest.ts` (dinámico, por host: nombre, `theme_color`, `background_color` y tres íconos con `?v=<versión>`
  para que un logo nuevo cambie la dirección), `app/api/brand/icon/route.ts` (reenvía al API con el host),
  `apple-touch-icon` en el layout (los iPhone ignoran los íconos del manifest) y `icon` en la notificación del service worker.
  El manifest y el ícono los pide el navegador por su cuenta: **ninguna página espera por la marca**.
- Si el API no responde, el manifest sale igual con un nombre neutro y el ícono pide el cuadro de respaldo.
- Cambiar el logo en el panel cambia la versión y, con ella, la dirección de los íconos. La app ya instalada refresca su
  ícono según las reglas del navegador (puede tardar).
- La marca es pública (es lo que ya muestra la página del local): no lleva correo, cuenta ni datos de otro restaurante.
  Un tamaño fuera de 180/192/512 es 400 y un host desconocido es 404.

## Rutas

| Método | Ruta                                                        | Quién                            |
| ------ | ----------------------------------------------------------- | -------------------------------- |
| `GET`  | `/v1/public/diner/push/config`                              | Comensal con sesión              |
| `POST` | `/v1/public/diner/push/subscriptions` (`/state`, `/revoke`) | Comensal con sesión              |
| `PUT`  | `/v1/staff/messaging/push/sending`                          | Encargado (`operations.approve`) |
| `PUT`  | `/v1/staff/messaging/push/templates`                        | Encargado                        |

El restaurante sale del host y la cuenta de la sesión; los cuerpos con campos de más devuelven 400. En
la web: `app/api/diner/push/*` (proxy), `public/sw.js` (service worker), `app/manifest.ts`,
`diner-account/push-client.ts` y `cuenta/push-panel.tsx`.

El service worker **sólo** muestra la notificación y abre la página al tocarla (siempre una ruta del
mismo sitio): no cachea nada ni intercepta pedidos. La instalación completa con caché y el modo sin
conexión son de T31.

## Pruebas

- pgTap `supabase/tests/database/messaging.test.sql` (173 aserciones): suscripción y su validación,
  estado por navegador, mensajes propios, la política por canal (sin suscripción, promoción sin
  `marketing`, horario, cupo compartido con WhatsApp), texto con variables, 404/410, baja del comensal,
  anonimización, automatizaciones por canal, auditoría de audiencia sin exponer navegadores y que
  desconectar WhatsApp no toque push.
- Carreras reales: seis promociones a la vez (tres por canal) contra el mismo tope.
- Worker con proveedor simulado: entrega a todos los navegadores, navegador caído, reintento, canal que
  no entrega, cupo entre canales y promoción sin consentimiento.
- Cifrado verificado byte a byte contra el vector del RFC 8291, JWT de VAPID verificado con la clave
  pública, y clasificación de respuestas del servicio de push.
- API con sesión de comensal real (401, 400, otro restaurante, revocación), service worker, helpers del
  navegador y E2E (móvil y escritorio) donde el comensal activa y desactiva y el Encargado escribe,
  aprueba y confirma. El E2E reemplaza la suscripción del navegador (no llega a un servicio de push
  real), el resto es real.

## Fuera de alcance / pendientes

- Probar contra un servicio de push real (FCM, Mozilla, Apple) con un navegador de verdad.
- Instalación completa con caché y modo sin conexión (T31); sonido, imágenes y botones en la notificación.
- Un ícono pensado para fondo oscuro, o un logo con mucho margen propio: hoy se centra sobre el color de fondo del perfil.
- Rotar las claves VAPID sin perder suscripciones.
- Revisión legal y comercial por país (Checkpoint 9), también para este canal.
