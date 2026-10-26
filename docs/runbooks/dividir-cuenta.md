# Dividir la cuenta de una mesa (T25)

Qué hace: el mozo o el Encargado divide el **saldo pendiente vigente** de una cuenta en
partes (iguales o por consumo) y cada parte se cobra una sola vez. Una misma persona puede
pagar varias partes de una vez, con medios mixtos (en cobros separados). Los consumos
posteriores no tocan las partes: quedan como saldo nuevo.

## Partes iguales

- La división congela el pendiente al momento de crearla; los centavos sobrantes van a las
  primeras partes (1000 en 3 partes: 334 + 333 + 333). La suma de las partes es siempre el
  pendiente de ese momento.
- Hay una división abierta por cuenta. Crear otra anula las partes sin cobrar (y las
  reservadas) de la anterior (`superseded`) y se calcula sobre el pendiente actual.
- Cobrar partes (`private.pay_split_shares`) toma el candado de la cuenta, verifica que
  **todas** las partes pedidas estén abiertas o reservadas y luego registra un cobro
  presencial normal (`record_account_payment`) por su suma. Si la caja está cerrada (PT240),
  el pendiente bajó por debajo de la suma (PT230) o una parte ya se cobró (PT260), no se
  reclama nada.
- Dos cobros simultáneos nunca toman la misma parte ni superan el pendiente: se serializan en
  el candado de la cuenta. Un reintento con el mismo `commandId` devuelve el mismo resultado
  sin un segundo cobro.
- Cuando se cobraron todas las partes la división queda `done`; el resto del pendiente (por
  ejemplo un pedido posterior) se cobra como siempre.
- El nombre de quien paga es una referencia del mozo (hasta 40 caracteres). Ningún
  formulario pide datos de tarjeta.
- SQL: `supabase/migrations/20261026010000_create_account_splits.sql` (rollback y pgTap
  `account_splits.test.sql`). API: `POST /v1/staff/accounts/:sessionId/splits` y
  `.../split-payments` (capacidad `payments.collect`). Error `SPLIT_SHARE_UNAVAILABLE` (409).
  Web: botón **Dividir…** en **Cuentas**.

## Dividir por consumo

- El mozo elige **Dividir…** → _Dividir por consumo_, indica cuántas personas son y a quién
  pertenece cada ítem vigente (los cancelados o reemplazados no se ofrecen). Lo que no se
  asigna es **compartido** y se reparte en partes iguales.
- Cada persona paga su peso (lo suyo × personas + lo compartido) sobre el **pendiente
  vigente**, con resto mayor, así que descuentos, cobros previos y propinas se respetan y la
  suma es exacta. Quien quedaría en cero se rechaza (PT212).
- SQL: `private.create_item_split` (migración `20261026020000_split_by_items_and_claims.sql`,
  asignaciones inmutables en `account_split_assignments`). La vista de cuentas trae
  `liveItems` (`20261026030000_account_live_items.sql`).
- API: `POST /v1/staff/accounts/:sessionId/item-splits`.

## Reservar la parte desde el teléfono

- En `/m/:token` el comensal abre **Dividir la cuenta**, escribe su nombre y toca **Tomar** en
  una parte libre. La reserva es atómica bajo el candado de la cuenta: seis teléfonos que
  compiten por la misma parte dejan exactamente un ganador (el resto recibe
  `SPLIT_SHARE_UNAVAILABLE`).
- Cada teléfono guarda un secreto aleatorio (`localStorage`); la base solo conoce su hash
  SHA-256, y solo ese teléfono puede **soltar** la parte. Un token de otra mesa o de otro
  negocio no ve ni toma nada.
- El mozo ve _reservada por X_ y cobra la parte como cualquier otra. Una división nueva anula
  también las reservadas.
- API pública: `POST /v1/public/account-splits/{view,claim,release}` (proxy Next en
  `/api/account-splits/*`).

## Pagar la parte con Mercado Pago

- El comensal que reservó una parte toca **Pagar acá**. El monto es el de la parte (nada de lo
  que envíe el teléfono lo cambia) y se usa el mismo flujo de T24: intento propio, simulador o
  Card Payment Brick, webhook firmado y estado autoritativo.
- Solo un pago **acreditado** paga la parte y escribe el movimiento `payment` (medio
  `mercado_pago`, actor sistema, fuera de la caja). Si cuando llega la acreditación la parte ya
  no está reservada (por ejemplo se anuló la división), el saldo bajó o la cuenta se cerró, el
  pago queda `needs_refund` y se devuelve solo, igual que en T24.
- Pendiente y rechazado dejan la parte reservada para reintentar; un reintento tras acreditar
  no cobra dos veces. Las devoluciones parciales usan el mismo camino que un pago de pedido.
- SQL: `20261026040000_share_online_payments.sql` (`online_payments` ahora pertenece a un
  intent **o** a una parte). API: `POST /v1/public/online-payments/share/{start,pay,status}`.
- Pruebas: pgTap `account_share_payments`, integración en
  `local-mercado-pago.integration.test.ts` y E2E en `e2e/mercado-pago.spec.ts`.

## Pruebas del resto

pgTap `account_split_items`, integración con carreras reales
(`local-account-splits.integration.test.ts`) y E2E en `e2e/account-splits.spec.ts`
(tres personas con una pagando dos partes; consumo con una parte reservada desde el teléfono).

## Fuera de alcance

Propinas en el pago online de una parte y repartir el saldo restante por persona después de
cobrar quedan para tareas posteriores.
