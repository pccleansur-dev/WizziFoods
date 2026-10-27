# Accesibilidad, responsive e idiomas (T32)

Objetivo: los recorridos críticos cumplen **WCAG 2.2 AA** y se pueden usar con teclado, en un teléfono
pequeño, con zoom y en el idioma que elige el comensal. Lo que una máquina puede comprobar está en la suite
(`e2e/accessibility.spec.ts`); lo que no, está en la matriz manual de abajo con quién la firma.

## Lo que comprueba la suite

```bash
corepack pnpm e2e e2e/accessibility.spec.ts
```

Corre en móvil (Pixel 5) y en escritorio.

| Prueba                  | Qué verifica                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Páginas públicas        | `/acceso`, `/cuenta`, `/offline.html` y el ingreso del personal, con axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`): nombres accesibles, etiquetas, contraste, tamaño de objetivo, landmarks. |
| Recorrido del comensal  | Entrada por QR, carta, detalle del producto, Mi pedido, pago y dividir la cuenta.                                                                                                                           |
| Pantallas del personal  | Mozo (llamados, comanda, cuentas, pedidos), Cocina, Barra, Caja y Mensajería.                                                                                                                               |
| Panel del administrador | Ingreso con segundo factor real y cada sección (negocio, carta, equipo, pagos, plano, publicar).                                                                                                            |
| Reflujo y zoom          | Salón, cuentas, Cocina y comensal a 320, 375, 768, 1024 y 1440 px (320 px = pantalla de 1280 con zoom al 400 %): **sin scroll horizontal** y **sin texto operativo menor a 12 px**.                         |
| Teclado                 | El comensal abre un producto con Enter, el foco entra al diálogo y vuelve al producto con Escape; el foco visible tiene contorno; el ingreso del personal se completa sin mouse.                            |

Un fallo de axe imprime cada regla, el selector y la causa. Se corrige en el componente o en los tokens de
`apps/web/src/app/styles.css`, nunca silenciando la regla.

### Reglas de diseño que salieron de la auditoría

- **Contraste:** el gris de texto secundario es `#6b655b` (≥ 4,5:1 sobre todos los fondos de la interfaz). No usar
  `opacity` para «apagar» un elemento con texto: baja el contraste; usar borde o color.
- **Nombre accesible = texto visible:** un botón con `aria-label` debe empezar con (o contener) lo que se ve
  (WCAG 2.5.3). Para el producto de la carta se quitó el `aria-label` y el prefijo «Ver detalle de» es texto sólo
  para lectores (`.visually-hidden`), así el nombre incluye nombre, descripción y precio.
- **Texto sólo visual:** para esconder a la vista pero no a los lectores usar `.visually-hidden`, nunca
  `display: none` (el menú de pasos del alta lo usaba y dejaba enlaces sin nombre en el teléfono).
- **Color de marca del negocio:** el color de acento es decoración (la vista previa lo usa como subrayado). El texto
  siempre usa colores cuyo contraste se valida en el formulario del perfil (aviso de contraste menor a 4,5:1).

## Idiomas y traducción automática

Reglas (ver también `traduccion-carta.md`):

1. **Una traducción automática es un borrador.** El texto que escribe la máquina queda marcado
   (`review: "machine"`) en el borrador de la carta. El editor lo muestra («traducción automática, sin revisar»).
2. **No se publica sin aprobación.** La publicación falla con `PENDING_TRANSLATION_REVIEW` mientras quede algo sin
   revisar (comprobado en la base, `catalog_publication_issues`, y en el panel). El administrador aprueba con
   «Aprobar las traducciones revisadas» o editando el texto (editar es revisar). Por eso lo publicado nunca lleva la marca.
3. **Fallback.** El comensal ve la carta en su idioma si el negocio lo tiene aprobado; si falta el nombre o la
   descripción en ese idioma, **cada campo cae al idioma del negocio** (`es`), nunca queda en blanco. Una
   traducción sin aprobar nunca se muestra, aunque llegara hasta ahí.
4. **Sólo palabras.** La traducción sólo toca nombres y descripciones. Precios, variantes, disponibilidad y
   cantidades salen de campos que el traductor no ve ni puede devolver (el contrato rechaza cualquier campo
   extra). El pedido se arma con ids, no con textos.
5. El idioma elegido se recuerda en el dispositivo (`localStorage`, clave `diner-language`); por defecto se usa el
   del teléfono si el negocio lo tiene. Cada fragmento lleva `lang` para que el lector de pantalla use la voz correcta.

Pruebas: `diner-catalog-format.test.ts` (fallback, idioma regional, borrador oculto, sólo palabras),
`catalog.test.ts` (contrato y bloqueo de publicación), `catalog-editor-state.test.ts` (marca y aprobación),
`catalog-translate-button.test.tsx` y pgTap `translation_review.test.sql`.

## Matriz manual (firma: responsable de producto)

Lo que axe no puede juzgar. Hacerla antes de cada lanzamiento y guardar capturas o notas en el registro de la
publicación. Marcar ✅ / ❌ / n.a. y anotar el defecto.

**Dispositivos y tamaños**

| Dispositivo                                   | Comensal: carta → pedido → dividir | Mozo: salón y cuentas | Cocina/Barra | Panel |
| --------------------------------------------- | ---------------------------------- | --------------------- | ------------ | ----- |
| Teléfono chico (Android 5,5″, 360 px)         |                                    |                       |              | n.a.  |
| iPhone (Safari, 390 px)                       |                                    |                       |              | n.a.  |
| Tablet vertical (768 px)                      | n.a.                               |                       |              |       |
| Tablet horizontal / pantalla de cocina (1280) | n.a.                               |                       |              |       |
| Escritorio (1440 px)                          | n.a.                               |                       |              |       |
| Zoom del navegador al 200 % y 400 %           |                                    |                       |              |       |
| Texto grande del sistema (Android/iOS)        |                                    |                       |              | n.a.  |

**Lector de pantalla** (recorrido: entrar por QR, elegir un producto, agregarlo, enviar el pedido):
NVDA + Firefox, VoiceOver en iPhone, TalkBack en Android. Comprobar: el nombre del producto se lee con su precio,
el diálogo anuncia su título y devuelve el foco al cerrarse, los avisos («Agregaste…», «Sin conexión…») se anuncian,
el cambio de idioma cambia la voz.

**Idiomas** (carta con al menos un idioma aprobado y otro con texto faltante): español, el idioma aprobado, un
teléfono configurado en un idioma que el negocio no tiene (debe verse en español), y una descripción faltante
(debe caer al español, sin hueco).

**Otros:** movimiento reducido activado (sin animaciones que molesten), modo oscuro del sistema (la web usa su propia
paleta clara: comprobar que no queda texto ilegible), conexión lenta (ver `pwa-y-tiempo-real.md`).

## Fuera de alcance de esta etapa

- Traducir la interfaz (botones y mensajes) a otros idiomas: hoy la interfaz es en español; sólo el contenido de la
  carta es multilingüe.
- Validar con personas usuarias de lector de pantalla fuera del equipo: lo pide la matriz manual.
- Un modo oscuro propio.
