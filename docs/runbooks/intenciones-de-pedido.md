# Intenciones de pedido (T18)

T18 convierte el borrador privado de T17 en una intención persistida. Todavía no
confirma una comanda, no abre una cuenta y no envía ítems a producción: esas
transiciones pertenecen a T19, T20 y T22.

## Entrada pública y alcance

- `GET /v1/public/order-intents/options` devuelve únicamente medios disponibles para
  la ubicación resuelta desde `Host`.
- `POST /v1/public/order-intents` recibe el contrato canónico: `commandId`, token QR,
  nombre, atribución, silla, medio/camino de pago e ids/cantidades de las líneas. No
  acepta tenant, ubicación, precios ni totales.
- La ruta pública usa `TenantHostGuard` y no requiere `Authorization` del comensal.
  Un host desconocido o suspendido no obtiene contexto tenant.
- `/api/order-intents` es el proxy same-origin de la web. Conserva el `Host` mediante
  `tenantFetch` y rechaza cuerpos mayores a 65.536 bytes antes de reenviarlos.

El cliente exige nombre siempre. La silla es opcional para cuenta general y
obligatoria para consumo propio. Sólo `mercado_pago` usa `paymentPath=online`; efectivo,
crédito, débito y otro medio son presenciales.

## Transacción e idempotencia

La migración `20261024080000_create_order_intents.sql` crea
`private.order_intent_commands`, `order_intents`, `order_intent_items`,
`waiter_calls` y el stock operativo opcional. El runtime no tiene acceso directo a
esas tablas: sólo puede ejecutar `private.list_public_payment_methods` y
`private.create_order_intent`, ambas `security definer`, con tenant y ubicación ya
resueltos por la API.

`create_order_intent` reclama `(tenant_id, location_id, command_id)` antes de validar.
Dos solicitudes simultáneas idénticas esperan la misma fila y reciben exactamente el
mismo resultado; reutilizar el comando con otro payload falla. Toda la operación
revalida y bloquea, dentro de una transacción:

1. QR activo, mesa vigente, estado habilitado y publicación del negocio.
2. Última carta publicada, producto, variante, cantidad y disponibilidad.
3. Medio de pago habilitado/configurado y coherencia entre medio y camino.
4. Precio y total calculados desde la publicación, nunca desde el navegador.
5. Stock operativo, sólo si existe una fila para ese producto.

La intención pendiente no reserva ni descuenta stock.

## Estados y siguientes responsables

- Un medio presencial persiste `awaiting_waiter` y un único llamado abierto con motivo
  `order_validation`, productos y medio. T19 debe permitir que el mozo lo valide o
  rechace.
- Mercado Pago persiste `payment_pending`, sin llamado. No confirma pedido ni lo manda
  a producción; T24 implementará la preferencia, webhook y transición de pago real.
- T20 enviará únicamente pedidos ya confirmados a producción. T22 abrirá la sesión y
  el libro mayor append-only; T18 no adelanta ninguno de esos modelos.

La web conserva el borrador y reutiliza su `commandId` si el envío falla. Sólo borra la
selección después de recibir una intención aceptada.

## Verificación y operación local

```powershell
Get-Content -Raw supabase/tests/database/order_intents.test.sql |
  docker exec -i supabase-db psql -U supabase_admin -d postgres -q -t -A
pnpm test
pnpm e2e
```

- pgTap: 18 aserciones sobre funciones acotadas, privilegios runtime, aislamiento,
  precio autoritativo, disponibilidad, stock e idempotencia.
- Unitarias/repositorio/API/web: incluidas en la suite del monorepo.
- Playwright: cuenta general, consumo propio con silla, Mercado Pago pendiente,
  reintentos concurrentes sin duplicación y conservación del borrador ante fallo, en
  móvil y escritorio. Usa 3100/3101 y no toca la demo.

El rollback es `supabase/rollbacks/20261024080000_create_order_intents.down.sql`. Es
destructivo para intenciones y llamados de T18; sólo debe ejecutarse antes de operación
real o después de respaldar esos datos.
