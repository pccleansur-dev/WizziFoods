# Cerrar la cuenta, limpiar la mesa y emitir el comprobante (T26)

Cerrar una cuenta **no libera la mesa**: la deja en «Pendiente de limpieza». Sólo el personal
autorizado la marca limpia y la vuelve «Disponible». El comprobante es un documento operativo
**no fiscal**; «Avisar a caja» sólo crea un recordatorio interno.

## Ciclo de la sesión

```text
Disponible ──primer pedido──▶ Ocupada ──cerrar cuenta (saldo 0)──▶ Pendiente de limpieza
     ▲                                                                   │
     └──────────────── «Marcar limpia» (mozo de la mesa o Encargado) ◀───┘
```

- **Cerrar** (`private.close_table_session`) sólo acepta una cuenta con saldo **exactamente cero**.
  Un saldo pendiente o a favor del comensal (devolución sin hacer) es `409 BALANCE_NOT_SETTLED`.
- Tampoco cierra si hay un pago online acreditado esperando devolución (`needs_refund`):
  `409 ONLINE_REFUND_PENDING`. Se considera del cierre el pago cuya sesión es esa, el de una parte
  de su división, o el de un pedido de una de sus mesas creado después de abrirla.
- Al cerrar, la división sin terminar se **anula** (`private.supersede_account_split`, incluidas
  las partes reservadas desde un teléfono): un pago online que llegue después de esa parte queda
  `needs_refund` y se devuelve solo, como en T24/T25.
- Se toma el mismo candado de la cuenta que usan cobros y confirmaciones. Dos cierres
  simultáneos terminan en un solo comprobante (el segundo recibe `409 ACCOUNT_ALREADY_CLOSED`);
  el mismo `commandId` devuelve siempre el mismo resultado.
- Todas las mesas de la sesión (la propia y las del grupo) pasan a `needs_cleaning`; una mesa que
  ya estaba fuera de servicio sigue así.
- El libro de una cuenta cerrada queda **congelado**: sólo acepta una devolución (`refund`) que
  llegue después, por ejemplo de Mercado Pago (`PT273`). Una confirmación que compitió con el
  cierre espera el candado y falla en vez de cargar un ítem a una cuenta cerrada.
- `closed_at` se toma **después** del candado: ningún movimiento del libro es más nuevo que el cierre.

## Máquina de estados de la mesa

`private.floor_table_service_states` (sin fila = disponible). El trigger rechaza (`PT275`) cualquier
cambio que no sea:

| Desde                 | Hacia                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- |
| Ocupada               | Pendiente de limpieza · Fuera de servicio                                          |
| Pendiente de limpieza | Fuera de servicio                                                                  |
| Cualquiera            | Disponible: sólo borrando la fila con «Marcar limpia» (`private.mark_table_clean`) |

Una mesa pendiente de limpieza o fuera de servicio **nunca** pasa a ocupada: `ensure_table_session`
falla y `assert_table_accepts_orders` ya rechazaba pedidos (`PT210`). El QR del comensal muestra la
carta pero «El pedido lo toma el mozo». `mark_table_clean` exige estado `needs_cleaning`
(`409 TABLE_NOT_PENDING_CLEANING`), un Mozo que sirva esa mesa o un Encargado (`PT200` para
Cocina/Barra y empleados de otro negocio, `PT201` para una mesa fuera de su sector).

## Comprobante

`private.account_receipts`: uno por sesión, **numerado por ubicación** (`receipt_counters`, sin
huecos aunque compitan cierres), inmutable y emitido al cerrar con lo que dice el libro en ese
momento: negocio, ubicación, mesas, horas, ítems vigentes, consumo, descuentos (con motivo),
propina, cobrado por medio (propina incluida), devoluciones y saldo. Lleva siempre:

- `Comprobante de consumo — no válido como factura`
- `¿Necesitás factura? Por el momento, la facturación se realiza en caja`

El contrato (`parseAccountReceipt`) sólo acepta el comprobante con ambos textos, saldo cero y
ningún campo fuera de la lista: **no hay lugar para CUIT, razón social ni domicilio fiscal**.

La pantalla `/interno/<negocio>/operacion/comprobante/<sesión>` lo muestra y el botón «Imprimir o
guardar como PDF» usa el diálogo del navegador (no se genera un PDF en el servidor ni sale nada
del dispositivo). La ven el Mozo de esas mesas y el Encargado.

## Avisar a caja

`private.cashier_requests`: una solicitud **abierta** por sesión (índice parcial único), con la
sesión (mesa y comprobante) y quién avisó, nada más. Tocar «Avisar a caja» varias veces, aunque sea
a la vez, devuelve la misma solicitud y audita una sola vez (`cashier.requested`). Sólo se puede
avisar de una cuenta ya cerrada (`409 RECEIPT_NOT_READY`). El Encargado la marca atendida
(`cashier.request_resolved`); un aviso posterior crea otra. El cliente completa sus datos fiscales
directamente en caja: la plataforma no los pide ni los guarda.

## Operaciones

| Operación                  | Ruta                                                  | Capacidad            |
| -------------------------- | ----------------------------------------------------- | -------------------- |
| Cuentas cerradas recientes | `GET /v1/staff/closed-accounts`                       | `tables.serve`       |
| Cerrar                     | `POST /v1/staff/accounts/:sessionId/close`            | `tables.serve`       |
| Ver comprobante            | `GET /v1/staff/accounts/:sessionId/receipt`           | `tables.serve`       |
| Avisar a caja              | `POST /v1/staff/accounts/:sessionId/cashier-requests` | `tables.serve`       |
| Marcar atendido            | `POST /v1/staff/cashier-requests/:requestId/resolve`  | `operations.approve` |
| Marcar mesa limpia         | `POST /v1/staff/tables/:tableId/clean`                | `tables.serve`       |

Todas las escrituras llevan sólo `{ commandId }` (cualquier otro campo es 400), son idempotentes
(`private.waiter_commands`) y quedan auditadas: `table_session.closed`, `table.cleaned`,
`cashier.requested`, `cashier.request_resolved`.

## Pantallas

- **Cuentas:** «Cerrar cuenta» aparece sólo con saldo cero; con saldo a favor se explica que hay
  que devolverlo antes. Debajo, «Cuentas cerradas» con el comprobante, «Avisar a caja» y, para el
  Encargado, «Aviso atendido».
- **Salón y llamados:** una mesa o grupo pendiente de limpieza ofrece «Marcar limpia»; en un grupo
  limpia las mesas de su alcance que esperan limpieza.

## Verificación

```powershell
Get-Content -Raw supabase/tests/database/table_closing.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm --filter @platform/api exec vitest run --no-file-parallelism   # con DATABASE_URL, DATABASE_ADMIN_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
pnpm e2e e2e/table-closing.spec.ts                                 # 3100/3101
```

- pgTap `table_closing.test.sql` (59 aserciones, dos negocios): saldo, permisos, comprobante,
  libro congelado, transiciones inválidas, grupo, división anulada, devolución pendiente, solicitud
  a caja y auditoría.
- Integración HTTP con PostgreSQL (`local-table-closing.integration.test.ts`): seis cierres
  simultáneos, el mismo comando seis veces, cierre contra cobro y pedido simultáneos (el comprobante
  sigue igual al libro), limpiezas simultáneas, aviso a caja sin duplicar, división anulada y cierre
  bloqueado por una devolución pendiente. La API se prueba **en serie** (`--no-file-parallelism`)
  por el pool de Supavisor.
- Playwright (móvil 375 px y escritorio, puertos 3100/3101): cobro → cierre → QR bloqueado →
  limpieza → nueva sesión; comprobante, «Avisar a caja» y resolución. La caja del E2E (y la de la
  demo) empieza **cerrada**: Marta (PIN 246810) la abre desde Caja antes de cobrar.

Migración `20261027010000_close_clean_and_receipt.sql`; rollback en
`supabase/rollbacks/20261027010000_close_clean_and_receipt.down.sql` (destructivo: borra
comprobantes, contadores y solicitudes; las sesiones siguen cerradas). Probada aplicar → revertir
→ reaplicar.

## Límites conocidos

- El comprobante no se envía por correo ni WhatsApp todavía; se imprime o se guarda como PDF desde
  el navegador. El comensal no lo ve desde su teléfono (su QR queda en sólo lectura).
- Cerrar no exige que los ítems estén entregados: es decisión del mozo. Un pago online en curso
  (`created`/`pending`) de una parte anulada se devuelve solo cuando se acredita.
- Los avisos a caja no se listan en un tablero propio; el Encargado los ve en «Cuentas cerradas».
- «Reabrir» una cuenta cerrada no existe: una venta posterior abre una sesión nueva tras limpiar.
