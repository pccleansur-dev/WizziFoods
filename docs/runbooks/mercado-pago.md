# Mercado Pago por negocio

## Invariantes

- El tenant y la ubicación salen del dominio y la sesión, nunca del body.
- OAuth guarda una conexión por ubicación. Access/refresh tokens quedan cifrados con
  AES-256-GCM y `PAYMENT_SECRET_KEY`; sólo la clave pública llega al navegador.
- El Card Payment Brick de Mercado Pago es el único que recolecta datos de tarjeta. La
  aplicación recibe un token descartable y nunca PAN, vencimiento ni CVV.
- El webhook sólo identifica qué pago cambió. La firma se verifica, el evento se
  deduplica y el estado se vuelve a leer desde Mercado Pago antes de conciliar.
- Sólo `approved` confirma pedido, abre sesión/cuenta y agrega el movimiento. Pendiente
  y rechazado no confirman. Si el pedido ya no se puede servir, queda `needs_refund`.

## Configuración

Producción requiere estas variables sólo en el servidor API:

```text
MERCADO_PAGO_MODE=live
MERCADO_PAGO_CLIENT_ID=...
MERCADO_PAGO_CLIENT_SECRET=...
MERCADO_PAGO_WEBHOOK_SECRET=...
MERCADO_PAGO_REDIRECT_URI=https://api.ejemplo.com/v1/payments/mercado-pago/callback
MERCADO_PAGO_RETURN_URL=https://local.ejemplo.com/panel/pagos
PAYMENT_SECRET_KEY=<32 bytes aleatorios en base64>
```

El callback y el webhook deben ser HTTPS públicos. No reutilizar claves entre
ambientes. Rotar `PAYMENT_SECRET_KEY` exige una migración que abra con la clave vieja y
vuelva a sellar con la nueva; no reemplazarla directamente.

En desarrollo/E2E se usa `MERCADO_PAGO_MODE=fake`. El simulador está prohibido cuando
`APP_ENV=production` y ofrece resultados acreditado, pendiente y rechazado sin datos de
tarjeta.

## Conexión y cobro

1. El Administrador abre **Panel → Pagos → Conectar Mercado Pago**.
2. Autoriza el negocio. El `state` es aleatorio, hasheado, de un solo uso y expira.
3. El comensal elige Mercado Pago. La intención queda `payment_pending`.
4. La web inicia el intento y, en producción, monta el Card Payment Brick con la clave
   pública y el monto devuelto por la API.
5. El webhook y la consulta explícita convergen en la misma conciliación idempotente.

## Devoluciones

El Encargado usa **Cuentas → Devolver por Mercado Pago**. La devolución no requiere
caja abierta ni modifica efectivo. Exige pago original, monto, motivo y `commandId`;
Mercado Pago y el ledger limitan acumulativamente lo devuelto.

## Diagnóstico

- `MERCADO_PAGO_NOT_CONNECTED`: conectar el negocio y confirmar que el medio esté
  habilitado.
- Firma inválida: comprobar el secreto del webhook y que el proxy preserve query y
  cabeceras originales.
- Pendiente prolongado: usar **Consultar estado**; nunca confirmar manualmente desde el
  cliente.
- `needs_refund`: el cobro se acreditó pero el pedido no pudo confirmarse; devolverlo
  desde Cuentas y conservar el evento para auditoría.

Migración: `20261025020000_create_mercado_pago.sql`. E2E:
`mercado-pago.spec.ts`. La API real se habilita sólo cuando existan las credenciales y
URLs anteriores.
