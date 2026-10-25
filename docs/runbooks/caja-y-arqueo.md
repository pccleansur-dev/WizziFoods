# Caja, cobros presenciales y arqueo

## Alcance

La caja se opera desde **Interno → Salón → Caja** y sólo está disponible para el
Encargado. Un turno registra responsable, fondo inicial, ingresos/retiros manuales,
cobros presenciales, devoluciones y cierre. Con la caja cerrada nadie puede registrar
cobros presenciales.

Los medios físicos son anotaciones contables: la aplicación nunca pide PAN, vencimiento,
CVV ni PIN de una tarjeta. El cobro real ocurre fuera de la plataforma.

## Operación

1. El Encargado abre la caja e informa el efectivo inicial.
2. Mozo o Encargado registra cobros desde **Cuentas**. Puede cobrar una parte y dejar
   el resto pendiente; el formulario se limpia después de cada cobro.
3. El Encargado registra ingresos o retiros de efectivo con motivo obligatorio.
4. Una devolución presencial se vincula al pago original, exige motivo y no puede
   superar ni el pago ni el saldo a favor de la cuenta.
5. Para cerrar se informa primero el efectivo contado. El sistema revela el esperado y
   la diferencia sólo después del conteo; una diferencia exige justificación.

El cierre no borra saldos pendientes: los muestra para el traspaso operativo.

## Diagnóstico

- `CASH_SHIFT_REQUIRED`: la caja está cerrada; debe abrirla un Encargado.
- `CASH_SHIFT_ALREADY_OPEN`: ya existe un turno abierto en la ubicación.
- `REFUND_EXCEEDS_AVAILABLE`: el monto supera lo cobrado o el crédito disponible.
- Una diferencia no es un error técnico: revisar fondo, movimientos, cobros y
  devoluciones antes de justificarla.

Migración: `20261025010000_create_cash_register.sql`. Rollback equivalente en
`supabase/rollbacks`. Prueba de base: `cash_register.test.sql`. El E2E
`cash-register.spec.ts` cubre apertura, cobro mixto, devolución y cierre ciego.
