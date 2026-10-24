# Carta y borrador del comensal (T17)

Después de resolver un QR válido en `/m/<token>`, el comensal puede navegar la carta
publicada, abrir el detalle de un producto, elegir una variante y mantener «Mi pedido»
en ese dispositivo. T17 no crea una sesión de mesa, una cuenta ni una reserva de stock.

## Fuente de verdad

- `GET /v1/public/catalog` entrega la última publicación y la disponibilidad inmediata
  del tenant y la ubicación resueltos sólo por el dominio.
- `POST /v1/public/drafts/recalculate` recibe `{ token, items }`. Cada ítem contiene
  únicamente `lineId`, `productId`, `variantId` y `quantity`; no acepta precio, tenant
  ni ubicación enviados por el cliente.
- Antes de cotizar, la API vuelve a resolver el QR y el estado vigente de la mesa. Luego
  vuelve a leer la carta publicada y calcula precio unitario, variante, cantidad, total
  por línea y total general.
- Un producto desactivado queda como `product_unavailable`; un producto o variante que
  salió de la publicación queda como `product_missing` o `variant_missing`. Cualquiera
  de esos estados, o una mesa `view_only`, devuelve `canConfirm: false`.

El endpoint no persiste el borrador y no reserva stock. T18 debe volver a validar todo
dentro de la operación atómica que convierta el borrador en una intención.

## Privacidad por dispositivo

El navegador guarda en `localStorage` sólo la selección canónica, bajo una clave opaca
derivada del host y del token. No guarda nombres ni importes. Dos dispositivos que
abren el mismo QR tienen almacenamientos distintos y no ven el borrador del otro. Las
pestañas del mismo perfil de navegador sí comparten el borrador, que es la unidad
práctica de «dispositivo» para T17.

La ruta web `/api/diner-draft` actúa como proxy same-origin y reenvía la cabecera `Host`
real con `tenantFetch`; no agrega autorización ni permite elegir tenant o ubicación.

## Refresco y degradación

La página conserva el refresco de T16 cada 15 segundos y al volver a estar visible. Una
disponibilidad modificada mientras el pedido está abierto hace que la publicación se
vuelva a cargar y el borrador se recalcule. Si el recálculo falla, la selección local no
se borra: la bandeja muestra un error y no permite continuar.

## Verificación

- Contrato: 7 pruebas de forma, límites, campos extra y líneas repetidas.
- API: 9 pruebas de controlador y servicio para precio, variante, cantidad, mesa
  `view_only`, QR inválido y disponibilidad.
- Web: parser de carta pública, almacenamiento, cotización, edición y proxy por host.
- Playwright: 20 recorridos en total (móvil 375 px y escritorio), incluidos dos
  dispositivos aislados y una desactivación concurrente que marca la línea y bloquea
  «Continuar».

## Pendiente para T18

- «Continuar» todavía no convierte el borrador en una intención.
- No se pide nombre ni silla y no se elige pago general/individual.
- No se crea llamado presencial ni pago online pendiente.
- No se envía nada a producción.
