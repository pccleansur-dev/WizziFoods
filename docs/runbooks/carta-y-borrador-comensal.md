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

El endpoint no persiste el borrador y no reserva stock. T18 vuelve a validar todo
dentro de la operación atómica que lo convierte en una intención; ver
`docs/runbooks/intenciones-de-pedido.md`.

## Privacidad por dispositivo

El navegador guarda en `localStorage` sólo la selección canónica, bajo una clave opaca
derivada del host y del token. No guarda nombres ni importes. Dos dispositivos que
abren el mismo QR tienen almacenamientos distintos y no ven el borrador del otro. Las
pestañas del mismo perfil de navegador sí comparten el borrador, que es la unidad
práctica de «dispositivo» para T17.

La ruta web `/api/diner-draft` actúa como proxy same-origin y reenvía la cabecera `Host`
real con `tenantFetch`; no agrega autorización ni permite elegir tenant o ubicación.

## Fotos de producto

La carta publicada ya lleva `imageAssetId` en cada producto. El comensal no recibe la
ruta de almacenamiento (el bucket `business-media` es privado) sino la dirección de la
foto en su propio host:

`GET /api/catalog/image/{assetId}` (web, same-origin) → `GET /v1/public/catalog/images/{assetId}` (API, `TenantHostGuard`).

- La API toma tenant y ubicación sólo del host. El identificador de la dirección nombra
  la foto, nunca un restaurante.
- `private.get_public_catalog_image` sólo responde si la foto es un activo `product` en
  estado `ready` de ese tenant y ubicación **y** la última publicación de esa ubicación la
  referencia. Una foto de otro restaurante, una sólo del borrador, una de un producto
  retirado o un id inexistente dan el mismo `404`.
- La API lee el objeto con la clave de servicio y lo devuelve con `content-type` del
  activo, `x-content-type-options: nosniff`, `etag` (versión del contenido) y
  `cache-control: public, max-age=86400`. Cada foto nueva tiene id nuevo, por eso la
  caché larga no deja fotos viejas; una foto retirada puede seguir en cachés hasta un día.
- `DinerProductImage` la usa en la tarjeta (`card`) y en el detalle (`hero`). Sin foto, o
  si la imagen falla al cargar, muestra la inicial del producto con el mismo tamaño: una
  foto nunca rompe la carta.
- El proxy web devuelve `404` ante cualquier falla o respuesta que no sea JPEG, PNG o WebP.

Pruebas: contrato (`parseCatalogImageAssetId`), servicio y controlador de API, proxy web,
`DinerProductImage` y la integración `local-catalog-image.integration.test.ts` (requiere
Supabase local; se omite sin él).

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

## Continuación en T18

«Continuar» ya pide nombre, atribución, silla cuando corresponde y un medio habilitado.
T18 persiste una intención con llamado presencial o pago online pendiente, pero todavía
no confirma ni envía nada a producción.
