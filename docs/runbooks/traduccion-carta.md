# Traducción automática de la carta

Botón **«Traducir lo que falta»** en el editor de la carta (aparece sólo si el
perfil tiene más de un idioma). Toma el primer idioma del perfil como origen y
completa, en los demás, los nombres y descripciones que todavía están vacíos.

## Reglas

- **Sólo llena campos vacíos.** Lo que una persona ya escribió nunca se pisa ni se
  vuelve a enviar. Las variantes sólo tienen nombre.
- **No publica nada.** El resultado queda en el borrador como cualquier cambio sin
  guardar: hay que revisarlo, guardar el borrador y publicar la carta como siempre.
  El requisito «nombres completos en todos los idiomas» se cumple con lo traducido,
  pero la revisión es del Administrador.
- **Qué sale hacia el proveedor:** sólo los textos a traducir con una clave opaca
  (`product:<id>:title`) y los dos idiomas. Nunca el tenant, la ubicación, la sesión,
  precios, imágenes ni credenciales. El contrato rechaza cualquier campo extra.
- **Límites:** hasta 400 textos por pedido, 1000 caracteres cada uno.
- **La respuesta se valida** contra lo pedido: exactamente las mismas claves, una vez
  cada una y con texto acotado; si no coincide se descarta y se responde 502.
- El mensaje de error no incluye la clave, los textos ni el detalle del proveedor.

## Configuración

Endpoint: `POST /v1/tenant/catalog/translations` (Administrador; cuerpo
`{ sourceLanguage, targetLanguage, texts: [{ key, text }] }`).

La API usa Claude (`claude-haiku-5-5`) con la variable opcional `ANTHROPIC_API_KEY`
(formato `sk-ant-…`). **Sin la variable, el endpoint responde
`503 TRANSLATION_UNAVAILABLE`** y el panel lo explica; el resto de la carta funciona
igual. La clave vive sólo en el servidor.

En el entorno de demo, agregala al `.env` de la raíz del repositorio y reiniciá la API:

```bash
corepack pnpm demo:api
```

## Privacidad

Los nombres y descripciones de la carta se envían al proveedor para traducirse. Es
una decisión del negocio activar la clave; sin ella nada sale de la plataforma.

## Borrador hasta aprobar (T32)

Lo que escribe la máquina queda marcado (`review: "machine"`) en el borrador y **no se puede publicar** hasta que el
administrador lo apruebe («Aprobar las traducciones revisadas») o lo edite. La base lo hace cumplir
(`PENDING_TRANSLATION_REVIEW`), de modo que lo publicado nunca lleva la marca. El comensal sólo ve idiomas aprobados y, si
falta un texto, vuelve al idioma del negocio. Detalle en `accesibilidad-y-responsive.md`.

## Pendiente

- No hay cuota por negocio ni registro de uso del proveedor.
- La integración con el proveedor se probó con una respuesta simulada; no se ejecutó
  contra la API real porque el entorno no tiene clave.
