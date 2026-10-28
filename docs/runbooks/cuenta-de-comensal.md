# Cuenta de comensal con Google y consentimientos (T28)

El comensal **puede** ingresar con Google; nunca **tiene que** hacerlo. La carta de `/m/<token>`
se muestra igual sin cuenta, con «Continuar sin cuenta» siempre a la vista, y no espera ninguna
consulta de identidad: la barra de cuenta se carga después, desde el navegador.

## Quién sabe qué

| Quién            | Sabe                                                                                                                   | No sabe                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Wizzi Foods      | La cuenta global (`private.diner_accounts`): hash con pepper del `sub` de Google y el correo                           | —                                                                 |
| Cada restaurante | Sólo el **perfil** que ese comensal creó con él (`private.diner_profiles`): nombre, teléfono opcional, consentimientos | El correo, el `account_id`, ni los perfiles de otros restaurantes |

La única tabla que une cuenta y perfil es `private.diner_profile_links`; ninguna función que
mira un restaurante la lee. El identificador del perfil (`profile_id`) es aleatorio y distinto en
cada restaurante: dos perfiles de la misma persona no se pueden correlacionar desde un tenant.

La cuenta del comensal es **independiente** de `staff_members` (PIN) y de `tenant_memberships`
(administradores con Supabase Auth). Tiene su propia sesión (`private.diner_sessions`) y no
reutiliza ninguna de esas tablas.

## Ingreso

```
carta (host del local) ──POST /api/diner/login──▶ API /v1/public/diner-auth/start
        ▲                                             │ authorizeUrl (state firmado)
        │                                             ▼
        │                                       Google (o el simulado)
        │                                             │ code + state
        │                                             ▼
        │            API /v1/diner-auth/google/callback  (dominio de la plataforma)
        │                                             │ 302 al host del local con un código de un solo uso
        └──GET /api/diner/complete?code&next ◀────────┘
              POST /v1/public/diner-auth/session {code, binding}  →  cookie diner_session
```

- El `state` va firmado (HMAC con `DINER_AUTH_STATE_SECRET`), vence a los 10 minutos y lleva el
  tenant, el host que inició el ingreso y la ruta de vuelta. El callback **sólo** redirige a ese host.
- **Vinculación al navegador.** Al iniciar, el navegador guarda un secreto aleatorio en la cookie
  `diner_binding` (HttpOnly) y sólo su hash viaja con el `state`. El código de un solo uso se guarda como
  `sha256(código ‖ hash)`: sin esa cookie el código no sirve (evita completar el ingreso de otra
  persona).
- El código dura 60 segundos, es de un solo uso y se canjea sólo en el restaurante que lo inició.
- La sesión (30 días) se guarda en la base como SHA-256; el navegador conserva el token en una cookie
  `diner_session`: HttpOnly, SameSite=Lax, sin `Domain` (sólo ese host) y `Secure` en producción. La sesión
  de un restaurante no vale en otro.
- Sólo se aceptan identidades de Google con el correo verificado. Del `id_token` se usan `sub` y `email`.
  Los tokens de Google no se guardan.
- Si el comensal cierra o rechaza la pantalla de Google, vuelve a la carta sin sesión.

### Modos (`DINER_AUTH_MODE`)

| Modo   | Qué hace                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `off`  | (por defecto) No se ofrece el botón; `availability` responde `false`.                                                          |
| `fake` | Google simulado dentro de la API (`/v1/dev/fake-google/authorize`); **se rechaza en producción**.                              |
| `live` | OpenID Connect de Google. Requiere `GOOGLE_DINER_CLIENT_ID`, `GOOGLE_DINER_CLIENT_SECRET` y `DINER_AUTH_REDIRECT_URI` (HTTPS). |

`fake` y `live` requieren `DINER_AUTH_STATE_SECRET` y `DINER_SUB_PEPPER` (32 caracteres o más cada uno). Cambiar
`DINER_SUB_PEPPER` desvincula a todos los comensales de sus cuentas: no se rota sin una migración.
La URI autorizada en Google es `DINER_AUTH_REDIRECT_URI` (`https://<api>/v1/diner-auth/google/callback`).

## Rutas

Todas toman el restaurante del `Host` y la cuenta de la sesión; ningún cuerpo puede traer tenant, cuenta ni correo
(los campos extra devuelven 400). Las escrituras desde el navegador pasan por `/api/diner/*` y exigen origen propio.

| Método   | Ruta (API)                           | Uso                                                      |
| -------- | ------------------------------------ | -------------------------------------------------------- |
| `GET`    | `/v1/public/diner-auth/availability` | ¿Se ofrece el ingreso?                                   |
| `POST`   | `/v1/public/diner-auth/start`        | `{bindingHash, returnPath}` → `authorizeUrl`             |
| `POST`   | `/v1/public/diner-auth/session`      | `{code, binding}` → `sessionToken`                       |
| `DELETE` | `/v1/public/diner-auth/session`      | Cerrar sesión (204)                                      |
| `GET`    | `/v1/public/diner/me`                | Perfil de este local, permisos y textos legales vigentes |
| `PUT`    | `/v1/public/diner/profile`           | `{displayName, whatsappPhone?}`                          |
| `POST`   | `/v1/public/diner/consents`          | `{commandId, kind, action, textVersion, source}`         |
| `POST`   | `/v1/public/diner/session-links`     | `{token}` → `{linked}`                                   |
| `GET`    | `/v1/public/diner/export`            | Exporta los datos propios                                |
| `DELETE` | `/v1/public/diner/account`           | Anonimización lógica (204)                               |

Errores de negocio: `PT281` sesión/cuenta no disponible (401), `PT282` falta el perfil, `PT283` texto legal
desactualizado, `PT284` falta el teléfono (o no se puede cambiar con WhatsApp aceptado), `PT285` nada que
revocar, `PT286` `commandId` reutilizado con otros datos (409). Códigos usados hasta ahora: `PT270`–`PT286`.

## Consentimientos

Dos tipos **independientes**: `whatsapp_verified` y `marketing`. Nunca vienen marcados.

- `private.diner_consent_events` es **append-only** (trigger `PT209`): aceptar o revocar agrega una fila con la
  versión del texto, el origen (`menu`, `profile` o `anonymization`), el `commandId` y la fecha. Nada se edita ni se borra.
  El estado vigente es la última fila de cada tipo (`private.diner_consent_state`).
- `private.diner_consent_texts` guarda cada texto por versión (también inmutable). Un restaurante puede publicar su
  propia versión más nueva; aceptar con una versión vieja es `PT283`. Revocar registra la versión que estaba aceptada.
- Aceptar dos veces la misma versión no agrega filas; el mismo `commandId` es idempotente. Dos pedidos simultáneos
  (por ejemplo revocar mientras se acepta) se serializan por perfil y tipo y nunca dejan dos aceptaciones seguidas.
- **Alcance de T28 sobre WhatsApp:** se registra el consentimiento y el teléfono, pero **todavía no hay verificación
  del número** (código por WhatsApp): el nombre del tipo se mantiene para no cambiar el esquema cuando exista el proveedor.
  El restaurante sólo ve el teléfono mientras el consentimiento de WhatsApp está aceptado (`list_tenant_diner_profiles`).

## Vinculación con la sesión de mesa

`POST /v1/public/diner/session-links {token}` resuelve el QR **en ese momento** y vincula al comensal con la **sesión**
abierta del grupo vigente (o de la mesa suelta) en `private.diner_session_links`, nunca con la mesa. Es opcional y no
bloquea nada:

- No agrega columnas a `table_sessions` ni a `account_entries`.
- Toma el candado compartido por ubicación (`private.table_groups_lock_key`): una unión o separación en curso termina antes.
- Si todavía no hay sesión abierta devuelve `{linked:false}`; la barra de la carta lo reintenta cada 15 segundos y al
  volver a la pestaña. Vincular dos veces la misma cuenta es inofensivo (una sola fila).
- La resolución del QR (`/m/<token>`) no consulta la cuenta.

## Exportación y anonimización

- `export_diner_data`: correo, y por restaurante nombre, teléfono, historia completa de consentimientos y las sesiones
  vinculadas. Son datos propios del comensal; el navegador los descarga como `mis-datos.json`.
- `anonymize_diner_account`: bloquea la cuenta, borra `sub` y correo, deja los perfiles como «Comensal anonimizado»
  sin teléfono, agrega filas `revoked` (origen `anonymization`) a los consentimientos aceptados, revoca las sesiones
  y los códigos pendientes. **No** borra perfiles ni vínculos: las visitas, cuentas y pedidos conservan sus referencias.
  Es idempotente; una cuenta anonimizada responde `PT281` y el mismo Google que vuelve a ingresar crea una cuenta nueva.

## Pruebas

- pgTap: `supabase/tests/database/diner_identity.test.sql` (58 aserciones, dos tenants: aislamiento, login de un solo uso,
  consentimientos append-only, revocación, versiones, vinculación, exportación y anonimización).
- Rollback probado aplicar → revertir → reaplicar: `supabase/rollbacks/20261028010000_create_diner_identity.down.sql`.
- Integración con carreras reales: `packages/database/src/diner-identity-repository.integration.test.ts`
  (vincular la misma cuenta ×8, revocar mientras se acepta, anonimizar mientras se vincula, canje simultáneo de un código).
- Contratos, repositorio, servicio, controladores, pasarela de Google y proxy web con pruebas unitarias.
- Playwright: `e2e/diner-identity.spec.ts` (invitado sin bloqueo, registrado, sesión de otro local inútil, vínculo al grupo,
  borrado de cuenta). Usa `DINER_AUTH_MODE=fake` (ver `e2e/stack-env.ts`).

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A < supabase/tests/database/diner_identity.test.sql
```

Los limpiadores de pruebas que borran un tenant deben borrar antes, con `session_replication_role = replica` dentro de
una transacción: `diner_session_links`, `diner_consent_events`, `diner_profile_links`, `diner_profiles`, `diner_sessions`,
`diner_login_exchanges` y las cuentas creadas, además de `table_sessions` (y, como siempre, `cashier_requests`,
`account_receipts`, `receipt_counters` y `table_group_events`).

## Lo que T28 no hace

Visitas, premios y cumpleaños son T29. Tampoco hay todavía pantalla del restaurante para ver sus clientes (la función
SQL `private.list_tenant_diner_profiles` ya devuelve sólo lo que ese tenant puede ver), ni verificación real del WhatsApp,
ni mecanismo para que un restaurante publique su texto legal propio desde el panel (la tabla lo admite).
