# QA E2E: alta de un negocio como Superadmin (29 de octubre de 2026)

Recorrido manual completo en un entorno local (Supabase local + API + web + worker), actuando como
Superadmin, luego como Administrador del negocio, personal del salón y comensal. Cada falla se
investigó hasta su causa raíz antes de corregirla; las correcciones traen prueba automatizada
cuando el código lo permite.

## Alcance recorrido

| Etapa                                                                                  | Resultado                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Ingreso del Superadmin (clave + TOTP) y alta del negocio                               | OK tras corregir H1, H3, H15                      |
| Invitación al Administrador → clave → segundo factor                                   | Roto en origen (H5); corregido                    |
| Negocio: datos, horarios, colores, logo, portada, fotos de referencia                  | OK tras corregir H11                              |
| Carta: importación CSV con filas inválidas, edición, 15 fotos de producto, publicación | OK tras corregir H7 y H8                          |
| Salón: planta, sectores, 10 mesas de 3 formas, QR                                      | OK                                                |
| Pagos: efectivo, crédito y débito presencial                                           | OK                                                |
| Equipo: 4 empleados con PIN                                                            | OK                                                |
| Modo prueba y publicación                                                              | Publicaba sin activar el negocio (H9); corregido  |
| Comensal: QR → carta → pedido → "Avisar al mozo"                                       | OK                                                |
| Mozo: tomar llamado, confirmar pedido                                                  | OK                                                |
| Cocina y Barra: estados, faltante con motivo                                           | OK                                                |
| Mozo: entregar, proponer reemplazo (diferencia −$400), aceptar                         | OK                                                |
| Encargado: abrir caja; cobro parcial con propina; cobro con débito; cierre; comprobante | OK (totales verificados a mano)                   |
| Limpieza de mesa y vuelta a "Disponible"                                               | OK                                                |

## Hallazgos corregidos

| #   | Sev. | Hallazgo                                                                                                                                                                      | Causa raíz                                                                                                                                         | Corrección                                                                                                                              |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Alta | `GET /v1/platform/operations` respondía 500: el panel del Superadmin mostraba "No pudimos cargar el estado operativo".                                                        | `drizzle(client)` reemplaza los parsers de fecha del cliente `postgres`; las consultas crudas devuelven `string`, y el código llamaba `.toISOString()`. | `tenant-suspension-repository` y `support-access-repository` normalizan `Date \| string`. Pruebas nuevas con filas de texto.            |
| H2  | Media | Los errores 500 no dejaban rastro en los registros.                                                                                                                           | Sin filtro global de excepciones y `logger: false`.                                                                                                | `UnhandledErrorFilter` registra `unhandled_request_error` (requestId, ruta, mensaje, pila acotada). Prueba nueva.                       |
| H3  | Media | Tras crear un negocio, la lista "Estado de los negocios" no lo incluía hasta recargar.                                                                                        | `createTenantAction` no revalidaba.                                                                                                                | Revalida el layout `/panel`.                                                                                                            |
| H5  | **Crítica** | El enlace de invitación terminaba en la portada técnica y el Administrador no podía entrar.                                                                                   | `/auth/callback` solo entendía `?code=` (PKCE); la invitación de Admin entrega la sesión en el fragmento `#access_token`, invisible al servidor.   | Página cliente `/auth/invitacion` (borra el fragmento, evita doble efecto en dev) + `POST /auth/invitacion/sesion` (origen propio, tokens validados, cookies httpOnly). Pruebas nuevas. |
| H6  | Media | `/acceso?error=...` y `?clave-actualizada=1` no mostraban ningún mensaje.                                                                                                      | La página ignoraba los parámetros que todos los flujos le mandan.                                                                                  | Aviso accesible (`alert`/`status`), solo códigos conocidos. Pruebas nuevas.                                                             |
| H7  | Media | Tras aprobar una importación el editor de carta seguía en 0 productos hasta recargar. Igual en plano, pagos, equipo y publicar: pasos y avisos de "falta" quedaban obsoletos. | Las acciones revalidaban `/panel` solo (o nada) y el editor conserva estado local.                                                                  | `revalidatePath("/panel", "layout")` en todas las acciones que cambian datos; `CatalogEditor` se remonta por revisión del borrador.    |
| H8  | Baja | "Fotos de referencia" (hasta 12) solo admitía una por vez.                                                                                                                    | El input no era `multiple` y solo leía `files[0]`.                                                                                                 | Selección múltiple con tope de 12 y progreso "n de m".                                                                                  |
| H9  | **Crítica** | "Publicar el negocio" decía "publicado", pero el QR respondía "Local no disponible".                                                                                          | `private.publish_location` nunca pasaba `tenants.status` de `draft` a `active`, y la resolución por host exige `active`.                            | Migración `20261102020000` (trigger + backfill), rollback y prueba pgTAP. Un negocio suspendido no se reactiva.                         |
| H10 | Media | Pagos, Equipo y Publicar se veían como una tarjeta gigante con el texto pegado al borde, título de 72 px y una barra negra suelta.                                            | El `section` global (tarjeta) se filtraba a `section.panel-content`; `.panel-content` deja `padding-inline: 0`; un `.form-message` vacío dibujaba su borde. | Reglas acotadas a `.onboarding` y `.form-message:empty { display: none }`. También quita el hueco bajo la barra de pasos.               |
| H11 | Baja | Mensajes de validación genéricos ("Haz coincidir el formato solicitado") en PIN, TOTP, identificador URL, claves y precios.                                                  | Inputs con `pattern` sin `title`.                                                                                                                  | `title` explicativo en los 8 campos.                                                                                                    |
| H12 | Media | La página del comensal ignoraba la identidad del negocio: título "Tu mesa", sin logo ni colores; botones "Continuar" y "Agregar" grises.                                      | No consumía `/v1/public/brand`.                                                                                                                    | Encabezado con logo y nombre, colores del negocio con texto de contraste automático, título "Negocio · Tu mesa".                        |
| H13 | Baja | Líneas de "Mi pedido" desalineadas (cantidad y precio a distinta altura según el nombre).                                                                                     | La etiqueta repetía "Cantidad de {producto}" y fijaba el ancho de la columna.                                                                      | Etiqueta corta "Cant." (el `aria-label` se mantiene), columnas fijas, precio a la derecha.                                              |
| H14 | Baja | La cabecera del personal quedaba como una pastilla centrada y encogida.                                                                                                       | `place-items: center` de `main` se heredaba.                                                                                                       | `.staff-operation-shell { place-items: stretch }`.                                                                                      |
| H15 | Baja | El identificador de URL no se proponía a partir del nombre.                                                                                                                   | —                                                                                                                                                  | `suggestBusinessSlug` (sin tildes, con guiones) que se detiene si se edita a mano. Pruebas nuevas.                                      |
| H16 | Baja | "Programa de premios" (Salón → Caja) sin estilos: inputs crudos y apretados.                                                                                                  | Marcado sin clases de formulario.                                                                                                                  | Clase `loyalty-settings`, mismo estilo de campos que el resto.                                                                          |
| H17 | Baja | 404 negra en inglés; la raíz `/` mostraba "Base técnica lista".                                                                                                               | Sin `not-found`/`error` propios; portada provisoria.                                                                                               | `not-found.tsx`, `error.tsx` y redirección de `/` a `/acceso`.                                                                          |
| H18 | Baja | El acceso interno del personal mostraba "LP" y no la marca del negocio.                                                                                                       | Marca fija.                                                                                                                                        | Logo (o inicial) y nombre del negocio.                                                                                                  |
| H19 | Baja | En local, el enlace de invitación caía en `SITE_URL` aunque la API pedía `/auth/callback`.                                                                                    | `ADDITIONAL_REDIRECT_URLS` vacío en el ejemplo.                                                                                                    | Ejemplo con `localhost:3000` y `*.localhost:3000`. En producción ya lo fija `production-env.ts` (`${appUrl}/**`).                        |

## Hallazgos abiertos (no corregidos)

| #   | Sev.  | Hallazgo                                                                                                                                                                                                                  | Sugerencia                                                                                                             |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A1  | **Alta** | **Las fotos de producto no llegan al comensal**: la carta pública y el detalle muestran la inicial del producto. El código lo declara pendiente («hasta que haya una fuente pública de imágenes»). Tampoco se ven la portada ni las fotos de referencia. | Endpoint público de imágenes por host (como el ícono de marca): valida que el asset pertenezca a la carta publicada y sirve desde Storage. |
| A2  | Media | El correo de invitación llega en inglés, con remitente genérico ("You've been invited").                                                                                                                                  | Plantilla `GOTRUE_MAILER_TEMPLATES_INVITE` y `GOTRUE_MAILER_SUBJECTS_INVITE` en español y con la marca.               |
| A3  | Media | El panel del Administrador carga en un host que no es el del negocio (p. ej. `localhost`), pero las acciones (subir imágenes) fallan con "No pudimos cargar la imagen" porque la API resuelve el negocio por `Host`.     | Tras el ingreso, redirigir al dominio principal del negocio, o avisar "ingresá por <dominio>".                         |
| A4  | Media | El nombre del negocio aparece de dos formas: el del alta (`tenants.name`, "QA Invitacion Tres") en cabecera del personal y comprobante, y el del perfil ("Parrilla Don Mateo") en la marca.                              | Decidir cuál es el nombre visible y usar uno solo (o sincronizar al guardar el perfil).                                 |
| A5  | Baja  | La vista previa de "Negocio" no muestra el logo ni la portada que se acaban de subir.                                                                                                                                     | Incluirlos en la vista previa.                                                                                         |
| A6  | Baja  | Tras "Publicar el negocio" el botón sigue igual; "Publicar el negocio" y "Continuar" (panel) tienen poco peso visual.                                                                                                    | Deshabilitar/etiquetar "Publicado" y usar el botón primario.                                                           |
| A7  | Baja  | Al fallar el segundo factor del alta, el mensaje queda bajo el pliegue. El formulario de clave vacía ambos campos tras un error.                                                                                         | Enfocar el mensaje; conservar el primer campo.                                                                         |
| A8  | Baja  | El selector de reemplazo lista todo el menú sin orden y con el propio producto faltante.                                                                                                                                 | Ordenar por categoría y excluir el faltante.                                                                           |
| A9  | Baja  | El alta de negocio no aparece en "Actividad sensible reciente" (solo hay eventos de operación). A confirmar si el alta debería auditarse.                                                                                | Verificar el requisito de auditoría del alta.                                                                          |

## Fuera del alcance de esta pasada

No se ejercitaron: OAuth de Mercado Pago, dividir cuenta, pagos online, fidelización (solo su formulario),
mensajería/WhatsApp, acceso de soporte, suspensión de negocios, unión de mesas, traducción a otros idiomas,
notificaciones push/PWA instalada ni viewport móvil real (el emulador no se aplicó a la pestaña). La suite
Playwright (`pnpm e2e`) tampoco se corrió: las pruebas de arriba son manuales con evidencia en esta página.

## Verificación

- `@platform/api`: 483 pruebas pasan (21 de integración omitidas por falta de entorno), tipos y lint limpios.
- `@platform/database`: 132 pasan, tipos y lint limpios.
- `@platform/web`: 405 pasan, tipos y lint limpios.
- pgTAP: `tenant_activation_on_publication` (4/4) y `security_posture` (9/9) sobre la base local.
- `pnpm format:check` marca 387 archivos de toda la copia de trabajo por fin de línea de Windows, también
  los que no se tocaron; los archivos modificados pasan Prettier de forma individual.

## Segunda parte: el mismo recorrido en producción (29 y 30 de octubre de 2026)

Después de corregir lo anterior en local se repitió el alta como un cliente nuevo en el despliegue real (Coolify, detrás de
Cloudflare Tunnel), con datos inventados y **sin borrar nada**: negocio «Pc Clean Resto», en la cuenta de prueba del dueño del
producto. En producción hubo dos reglas: el acceso (contraseña, 2FA, PIN) lo iniciaba la persona dueña de la cuenta y el resto
se operaba dentro de su sesión, y no se escribieron credenciales en ningún formulario.

### Lo que se encontró (y se corrigió)

| #   | Sev.        | Hallazgo                                                                                                                                                                              | Causa raíz                                                                                                                                                                                                                                                                                                                  | Corrección                                                                                                                                                   |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | **Crítica** | Plano, Pagos, Equipo, Publicar, las subidas de imágenes y la carta del comensal no cargaban («No pudimos cargar…», 502 al subir el logo). La API no recibía ninguna de esas llamadas. | `tenantFetch` llamaba a la API por su URL pública reescribiendo `Host` con el del negocio. El proxy público enruta por `Host`, así que la solicitud terminaba en la web. Prueba directa: `Host: app-carta…` contra la URL pública de la API devolvía el 404 HTML de la web. En local no pasa (no hay proxy en el medio). | PR #20: con `API_URL` (red interna, ya definido en el compose y sin lector) el destino público se reescribe a la red interna. Pruebas con HTTP real.           |
| P2  | Alta        | Dos despliegues seguidos fallaron al construir (`ERR_PNPM_BROKEN_METADATA_JSON`, `error (23)`), y la prueba local tardó 31 minutos en fallar.                                         | `pnpm deploy --legacy` de `api` y `worker` volvía a resolver dependencias contra el registro, con los metadatos completos que exige `minimumReleaseAge` (solo `next` pesa decenas de MB), y arrastraba `next` y `eslint-config-next` sin necesitarlos. No era la red: un `fetch` normal bajaba lo mismo en menos de 2 s. | PR #21: `deploy` desde el `pnpm-lock.yaml` (sin `--legacy`, `inject-workspace-packages` solo para ese comando), más reintentos y caché de metadatos. 34 s y 19 s. |
| P3  | Media       | El comprobante decía «Abierta 30/10/26, 2:04 a. m. · Cerrada 2:35 a. m.» y la lista de cuentas cerradas «cerrada 11:35 p. m.».                                                       | El comprobante se renderiza en el servidor (UTC) y formatea sin zona; la lista se renderiza en el navegador.                                                                                                                                                                                                                | PR #22: `formatBusinessDateTime` en `America/Argentina/Buenos_Aires`. Verificado en producción: 11:04 p. m. y 11:35 p. m. del 29/10.                         |
| P4  | Media       | El QR (`<slug>-carta.wizzi.com.ar`) no abría desde internet: sin DNS, Cloudflare `530 / 1016`, y Coolify con 404.                                                                     | Solo existían los hostnames de `app`, `api` y `supabase`. Nada creaba el del negocio.                                                                                                                                                                                                                                       | Cloudflare: registro `*` con proxy y regla `*.wizzi.com.ar` en el túnel (después de las específicas). Coolify: dominio del negocio en `web`. Ver «Pendiente». |

Las migraciones, la función `resolve_sole_tenant_admin`, sus permisos, el host de plataforma y la cuenta (un solo negocio con
dominio activo) se verificaron y **no** eran la causa de P1. Esa búsqueda llevó varias vueltas porque la API devolvía un 404
controlado que no deja huella en el log, y la API de Coolify solo expone los logs del contenedor `web`.

### Recorrido en producción (resultado)

- **Negocio:** datos, horarios, colores, logo, portada y 3 fotos de referencia (subida múltiple). Guardado.
- **Carta:** CSV de 15 filas (precio `24.900,50` bien interpretado), aprobación sin recargar la página, 15 fotos, publicación v1;
  luego variantes (bife: 3, sorrentinos: 2, cerveza: 2), cambio de precio del bife y publicación v2.
- **Plano y QR:** planta, 2 sectores, 10 mesas de 3 formas, 10 QR.
- **Pagos:** crédito y débito habilitados; crédito deshabilitado después (deja de ofrecerse al comensal).
- **Equipo:** 4 empleados; edición, desactivación y reactivación.
- **Modo prueba y publicación:** los 6 pasos correctos; avance 100 %.
- **Comensal (desde internet):** logo, colores y fotos de los 15 platos (todas responden `image/jpeg`, con cabeceras de
  seguridad); pedido con variantes y total de $118.000 verificado a mano.
- **Operación:** el mozo confirma, Cocina y Barra preparan (cada una ve solo sus ítems), la encargada abre la caja (fondo
  $30.000), cobro parcial con propina, entrega, cobro del saldo con débito, cierre, comprobante (consumo 118.000, propina
  2.000, efectivo 20.000, débito 100.000, saldo 0) y limpieza de la mesa.
- **Permisos:** la encargada no puede abrir Cocina ni Barra (la redirige al inicio), como corresponde.

### Despliegues

| Fecha (UTC) | Commit    | Resultado                                           |
| ----------- | --------- | --------------------------------------------------- |
| 29/10 22:36 | `80fd455` | OK (todavía sin los arreglos de esta pasada)        |
| 29/10 23:08 | `4a223fc` | OK (PR #19)                                         |
| 30/10 00:08 | `1597cc9` | Falló dos veces al construir (P2)                   |
| 30/10 01:18 | `408721a` | OK (PR #21; deja funcionando P1)                    |
| 30/10 02:40 | `84af769` | OK (PR #22; arregla P3)                             |

### Pendiente tras la pasada de producción

- **Dominio por negocio en Coolify.** Coolify rechaza dominios con comodín (`Invalid URL: http://*.wizzi.com.ar`), por lo que cada
  negocio nuevo necesita su dominio registrado en el servicio `web` (con la API de Coolify en el alta, o una regla `HostRegexp`
  en las etiquetas de Traefik del compose). Cloudflare ya no necesita nada por negocio.
- **Vista previa del panel:** no dibuja las fotos ya guardadas (solo miniaturas de la sesión de subida); el menú del comensal sí.
- **Variantes con imagen:** el modelo no las admite; la imagen es del producto.
- **Nombre mostrado:** la cabecera del personal y el comprobante usan el nombre del alta («PC CLEAN»), no el del perfil
  («Pc Clean Resto»).
- **Sin probar en producción:** faltante con reemplazo (solo en local), Mercado Pago, WhatsApp, dividir cuenta, fidelización,
  traducción y móvil real.
- **Operativo:** revocar el token de Cloudflare creado para esta pasada y cambiar los PIN de los empleados de prueba.
