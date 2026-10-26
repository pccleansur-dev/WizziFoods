# Visitas, cumpleaños y premios (T29)

Un comensal con perfil acumula **visitas verificadas** en un restaurante, gana **premios
personales** al llegar a la meta y los usa en el cobro de una cuenta. Todo es opcional: la
carta de `/m/<token>` no consulta este módulo y nunca espera por él.

## Modelo

Todo cuelga de `private.diner_profiles` (perfil por restaurante, id opaco) y de
`private.diner_session_links` (vínculo a la **sesión** de mesa). `table_sessions` y
`account_entries` no ganaron columnas.

| Tabla              | Qué guarda                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `loyalty_settings` | Una fila por ubicación: activo, consumo mínimo, permanencia mínima, meta de visitas, premio, vigencia y reglas del cumpleaños.   |
| `loyalty_visits`   | Una visita acreditada por persona y sesión. Única por **persona y día local** mientras esté acreditada. No se borra ni se edita. |
| `loyalty_rewards`  | Premios personales: `available` → `reserved` → `redeemed` (o `revoked`). Guarda el tipo y el valor vigentes al ganarlo.          |
| `diner_birthdays`  | Sólo mes y día (nunca el año), con el número de cambios.                                                                         |

Sin fila en `loyalty_settings` el programa está apagado: cerrar una cuenta no acredita nada.

## Visitas

Se acreditan solas cuando una sesión pasa a `closed` (disparador sobre `table_sessions`). El
disparador **nunca falla ni demora el cierre**: si algo sale mal, la visita simplemente no se
acredita. Una visita exige:

- el programa activo y una permanencia mínima (`min_session_minutes`);
- consumo neto (consumido − descuentos) mayor que cero y **sin devoluciones**;
- un perfil vinculado a la sesión y no anonimizado;
- que la parte de la persona llegue al **consumo mínimo**.

Atribución en una cuenta de mesa o de grupo: el consumo neto se reparte en **partes iguales**
entre los perfiles vinculados a la sesión. `confirmed_orders` atribuye por nombre y asiento, no
por perfil, así que no hay una forma confiable de saber qué consumió cada persona; el reparto
igualitario es la regla honesta hasta que exista ese vínculo.

- **Día local:** se toma de `locations.timezone` sobre el momento en que se **abrió** la sesión
  (`private.loyalty_local_day`). Una cena que cruza la medianoche cuenta como un solo día.
- **Una por día:** el índice único parcial `loyalty_visits_one_per_day_idx` es la última defensa;
  además cada acreditación toma un candado por persona.
- **Meta:** cada `visits_goal` visitas sin asignar se convierten en un premio (las más antiguas
  primero). Cambiar la configuración no altera premios ya ganados.

### Devolución total

Un movimiento `refund` en el libro dispara la revisión: si lo devuelto alcanza lo cobrado de esa
sesión, sus visitas pasan a `revoked`. El premio que esas visitas habían desbloqueado y que aún no
se usó (`available` o `reserved`) pasa a `revoked` y las demás visitas vuelven a contar. Un premio ya
canjeado se queda como está.

## Cumpleaños

`PUT /v1/public/diner/loyalty/birthday {month, day}`. Se exige antigüedad del perfil
(`birthday_min_age_days`, `PT288`) y un límite de cambios (`birthday_max_changes`, `PT289`). Repetir la
misma fecha es inofensivo; 29 de febrero es válido, el 30 de febrero no (`PT291`). **T29 sólo valida y
guarda la fecha**: no otorga ningún premio por cumpleaños todavía.

## Premios: reservar, cobrar y canjear

```text
available ──reservar (comensal, cuenta propia)──▶ reserved ──canjear con cobro (caja)──▶ redeemed
    ▲                                                │
    └──liberar / vence la reserva / el cobro falla───┘
```

- **Reservar** (`POST /v1/public/diner/loyalty/rewards/reserve {rewardId, sessionId}`): sólo para una
  cuenta **abierta** a la que el comensal está vinculado. Toma el candado de la cuenta y después el del
  premio. No escribe nada en el libro; devuelve el descuento calculado. Una cuenta tiene un solo premio
  reservado. La reserva vence a los `reservation_minutes`.
- **Canjear con cobro** (`POST /v1/staff/accounts/:sessionId/reward-redemptions {commandId, rewardId, method, tipCents?}`,
  capacidad `payments.collect`): en **una transacción** escribe el descuento (`discount`, causa «Premio de
  fidelización»), cobra el resto con el medio elegido (`record_account_payment`) y marca el premio
  `redeemed`. Nadie envía montos: el descuento sale de la base.
- **Si el cobro falla** (caja cerrada, medio inválido, etc.) se deshace el descuento y el premio vuelve a
  `available` para el comensal; la respuesta es `{redeemed:false, released:true}` y queda guardada para el
  mismo `commandId`.
- **Doble canje:** el segundo intento espera el candado del premio, lo encuentra usado y recibe `PT290`.

## Rutas

| Método      | Ruta                                               | Quién                            |
| ----------- | -------------------------------------------------- | -------------------------------- |
| `GET`       | `/v1/public/diner/loyalty`                         | Comensal con sesión              |
| `PUT`       | `/v1/public/diner/loyalty/birthday`                | Comensal con sesión              |
| `POST`      | `/v1/public/diner/loyalty/rewards/reserve`         | Comensal con sesión              |
| `POST`      | `/v1/public/diner/loyalty/rewards/release`         | Comensal con sesión              |
| `GET`/`PUT` | `/v1/staff/loyalty/settings`                       | Encargado (`operations.approve`) |
| `GET`       | `/v1/staff/accounts/:sessionId/rewards`            | Caja (`payments.collect`)        |
| `POST`      | `/v1/staff/accounts/:sessionId/reward-redemptions` | Caja (`payments.collect`)        |

El restaurante y la cuenta salen del host y de la sesión; los cuerpos con campos de más devuelven 400.
Ninguna respuesta lleva correo, `account_id` ni datos de otro restaurante. Errores: `PT287` programa
apagado, `PT288`/`PT289` cumpleaños, `PT290` premio no disponible, `PT291` datos inválidos, `PT292` cuenta
no aplicable. **Códigos usados hasta ahora: `PT201`–`PT292`.**

## Pantallas

- **Comensal:** `/cuenta` → «Mis premios»: progreso hacia el próximo premio, premios disponibles, «Usar en
  mi cuenta» (si hay una cuenta abierta vinculada), «Liberar premio» y el cumpleaños. Se carga después del
  resto de la página.
- **Caja:** en **Cuentas** → «Cobrar ahora», aparece «Premios reservados» con «Canjear premio de X y cobrar».
- **Encargado:** en **Caja**, «Programa de premios» (activo, visitas para ganar, consumo mínimo, tipo y valor,
  permanencia mínima).

## Pruebas

- pgTap `supabase/tests/database/loyalty.test.sql` (61 aserciones, dos tenants): permisos, ajustes, zonas
  horarias (Buenos Aires y Tokio), visita, una por día, mínimo, descuento total, mesa grupal con reparto
  igualitario, reserva/canje/pago fallido, devolución total, cumpleaños y aislamiento sin correo.
- Rollback probado aplicar → revertir → reaplicar: `supabase/rollbacks/20261029010000_create_loyalty.down.sql`.
- Carreras reales: `packages/database/src/loyalty-repository.integration.test.ts` (dos cuentas del mismo día
  que cierran a la vez, seis canjes simultáneos del mismo premio, cobro fallido contra liberación).
- Contratos, controladores de la API y E2E `e2e/loyalty.spec.ts` (móvil y escritorio): el comensal reúne la
  meta, reserva el premio, la caja lo canjea y cobra, y esa misma compra gana el siguiente premio.

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A < supabase/tests/database/loyalty.test.sql
```

Los limpiadores que borran un tenant deben borrar antes, con `session_replication_role = replica`, además de
la lista de T28: `loyalty_visits`, `loyalty_rewards`, `diner_birthdays` y `loyalty_settings`.

## Límites conocidos

- El canje con descuento sólo existe en la **caja presencial**. El pago online (Mercado Pago) todavía no usa premios.
- No hay premio de cumpleaños: sólo se valida y guarda la fecha.
- La atribución en grupos es por partes iguales hasta que exista un vínculo entre asiento y perfil.
- Una devolución **parcial** no revoca visitas; sólo la total.
- El restaurante no ve todavía una lista de visitas por cliente.
