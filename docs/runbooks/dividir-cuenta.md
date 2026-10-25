# Dividir la cuenta de una mesa (T25)

Qué hace: el mozo o el Encargado divide el **saldo pendiente vigente** de una cuenta en N
partes iguales (2 a 20) y cada parte se cobra una sola vez. Una misma persona puede pagar
varias partes de una vez, con medios mixtos (una parte en efectivo y otra con tarjeta, en
cobros separados). Los consumos posteriores no tocan las partes: quedan como saldo nuevo.

## Reglas

- La división congela el pendiente al momento de crearla; los centavos sobrantes van a las
  primeras partes (1000 en 3 partes: 334 + 333 + 333). La suma de las partes es siempre el
  pendiente de ese momento.
- Hay una división abierta por cuenta. Crear otra anula las partes sin cobrar de la
  anterior (`superseded`) y se calcula sobre el pendiente actual.
- Cobrar partes (`private.pay_split_shares`) toma el candado de la cuenta, verifica que
  **todas** las partes pedidas estén abiertas y luego registra un cobro presencial normal
  (`record_account_payment`) por su suma. Si la caja está cerrada (PT240), el pendiente bajó
  por debajo de la suma (PT230) o una parte ya se cobró (PT260), no se reclama nada.
- Dos cobros simultáneos nunca toman la misma parte ni superan el pendiente: se serializan en
  el candado de la cuenta. Un reintento con el mismo `commandId` devuelve el mismo resultado
  sin un segundo cobro.
- Cuando se cobraron todas las partes la división queda `done`; el resto del pendiente (por
  ejemplo un pedido posterior) se cobra como siempre.
- El nombre de quien paga es una referencia del mozo (hasta 40 caracteres). Ningún
  formulario pide datos de tarjeta.

## Dónde

- SQL: `supabase/migrations/20261026010000_create_account_splits.sql` (rollback y pgTap
  `account_splits.test.sql`). Las tablas son inmutables salvo cerrar una parte o una
  división una vez.
- API: `POST /v1/staff/accounts/:sessionId/splits` y `.../split-payments`
  (capacidad `payments.collect`). Error `SPLIT_SHARE_UNAVAILABLE` (409).
- Web: botón **Dividir…** en **Cuentas**.
- Pruebas: pgTap, integración con carreras reales (`local-account-splits.integration.test.ts`)
  y E2E de tres personas (`e2e/account-splits.spec.ts`).

## Pendiente (otras tareas)

División por consumo (ítems por persona), participaciones del comensal desde su teléfono y
pagos con Mercado Pago por parte quedan fuera de T25.
