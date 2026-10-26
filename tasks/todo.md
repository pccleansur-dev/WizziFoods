# Tareas de implementación

Estado: aprobada y en ejecución. Cada tarea debe conservar un alcance de una
sesión enfocada y dividirse si supera aproximadamente cinco archivos
funcionales.

## Fase 0 — Base reproducible

### T01. Crear el workspace y los contratos de calidad — completada

**Descripción:** Inicializar el repositorio, el monorepo y las aplicaciones mínimas sin implementar funciones de negocio.

**Criterios de aceptación:**

- [x] `web`, `api` y `worker` arrancan mediante comandos documentados.
- [x] TypeScript estricto, lint, formato y pruebas comparten configuración sin ocultar errores.
- [x] Existe un README de desarrollo y ninguna credencial real está versionada.

**Verificación:**

- [x] Ejecutar tipos, lint, pruebas vacías de humo y build de las tres aplicaciones.
- [x] Arrancar las aplicaciones y comprobar sus páginas/endpoints de salud.

**Dependencias:** Ninguna.

**Archivos probables:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `README.md`, configuraciones base.

**Tamaño:** M.

### T02. Levantar Supabase y servicios locales — completada

**Descripción:** Incorporar una composición local reproducible con Supabase, volúmenes persistentes y perfiles preparados para nube/local.

**Criterios de aceptación:**

- [x] Un comando levanta PostgreSQL, Auth, Storage y Realtime con datos persistentes.
- [x] La configuración distingue secretos de desarrollo y producción.
- [x] Reiniciar contenedores no elimina base de datos ni archivos.

**Verificación:**

- [x] Ejecutar smoke test de base, Auth, Storage y Realtime.
- [x] Reiniciar la composición y comprobar persistencia.

**Dependencias:** T01.

**Archivos probables:** `compose.yml`, `infra/compose/*`, `.env.example`, `docs/runbooks/desarrollo-local.md`.

**Tamaño:** M.

### T03. Establecer CI, configuración y telemetría mínima — completada

**Descripción:** Crear la puerta automática de calidad y la base de logs, métricas y trazas con correlación.

**Criterios de aceptación:**

- [x] CI bloquea si fallan tipos, lint, pruebas, build o detección de secretos.
- [x] Web, API y worker producen identificadores de correlación y telemetría sin datos sensibles.
- [x] La configuración falla al inicio cuando falta una variable obligatoria.

**Verificación:**

- [x] Ejecutar el pipeline localmente y provocar un fallo controlado.
- [x] Seguir una solicitud de humo por logs y traza.

**Dependencias:** T01, T02.

**Archivos probables:** `.github/workflows/ci.yml`, `packages/config/*`, `packages/observability/*`, documentación.

**Tamaño:** M.

### Checkpoint 0

- [ ] Clon limpio → instalación → entorno local → build funciona según README.
- [x] CI pasa y el equipo aprueba comenzar dominio y seguridad.

## Fase 1 — Seguridad y aislamiento

### T04. Crear un tenant aislado con ubicación inicial

**Descripción:** Entregar el primer corte multitenant completo, incluyendo esquema mínimo, API y prueba negativa de aislamiento.

**Criterios de aceptación:**

- [x] Cada tenant tiene una ubicación inicial aunque la UI limite a una sola.
- [x] Toda fila de dominio del corte lleva contexto tenant y RLS aplicable.
- [x] Una identidad del tenant A no puede leer ni modificar datos del B.

**Verificación:**

- [x] Migración desde base vacía y rollback ensayado en entorno descartable.
- [x] Pruebas pgTAP positivas y negativas de RLS.

**Resultado:** esquema, RLS y repositorio entregados. La API resuelve el tenant desde la identidad autenticada y no recibe `tenant_id` del cliente. La exposición HTTP queda deliberadamente junto a T05, cuando exista un JWT verificado del cual obtener esa identidad.

**Dependencias:** T02, T03.

**Archivos probables:** `supabase/migrations/*`, `packages/database/*`, `supabase/tests/tenancy.sql`, módulo tenant API.

**Tamaño:** M.

### T05. Autenticar Superadmin y Administrador — completada

**Descripción:** Implementar identidades reforzadas y separación de alcance para quienes administran plataforma o negocio.

**Criterios de aceptación:**

- [x] Superadmin y Administrador ingresan con credenciales reforzadas y MFA.
- [x] Un Administrador sólo obtiene el tenant asignado; Superadmin no entra silenciosamente a su operación.
- [x] Recuperación y revocación de sesiones quedan auditadas.

**Verificación:**

- [x] Pruebas de login, MFA, expiración, revocación y acceso cruzado denegado.
- [x] Recorrido manual en navegador para ambos perfiles.

**Resultado:** acceso administrativo con Supabase Auth, MFA TOTP obligatorio y
alcances separados. La API valida firma, emisor, audiencia, expiración, nivel de
seguridad y vigencia de la sesión antes de resolver permisos. El entorno local
incluye correo aislado para probar recuperación sin enviar mensajes reales; se
verificaron los eventos de recuperación y revocación en la auditoría de Auth.

**Dependencias:** T04.

**Archivos probables:** módulos auth de API/web, contratos de sesión, pruebas de integración.

**Tamaño:** M.

### T06. Autenticar personal con usuario y PIN — completada

**Descripción:** Crear cuentas individuales de Encargado, Mozo, Cocina y Barra con controles específicos para PIN.

**Criterios de aceptación:**

- [x] El PIN de seis dígitos se almacena con hash y nunca se devuelve o registra.
- [x] Intentos limitados, bloqueo temporal, vencimiento y revalidación sensible funcionan.
- [x] Cada rol recibe solamente las capacidades fijas documentadas.

**Verificación:**

- [x] Pruebas unitarias de bloqueo y matriz de permisos.
- [x] Pruebas de integración de login, expiración y auditoría individual.

**Resultado:** acceso interno responsive por negocio con usuario y PIN, sesiones
opacas de ocho horas, bloqueo temporal, revalidación de Encargado, revocación y
auditoría. La API aplica capacidades fijas por rol y mantiene credenciales y
sesiones fuera del alcance directo de clientes. El recorrido real de login y
panel de Encargado se verificó en navegador contra Supabase local.

**Dependencias:** T04, T05.

**Archivos probables:** módulo staff-auth, políticas de permisos, pantalla de acceso, pruebas.

**Tamaño:** M.

### Checkpoint 1

- [x] RLS negativa, sesiones y roles pasan en CI.
- [x] Revisión de seguridad antes de almacenar información real.

## Fase 2 — Administración de la plataforma

### T07. Aprovisionar y entregar un negocio — completada

**Descripción:** Permitir que Valentín cree un tenant, su ubicación y el primer Administrador sin completar la operación del restaurante.

**Criterios de aceptación:**

- [x] Superadmin crea un negocio en estado borrador y genera una invitación de administrador de un solo uso.
- [x] La activación es idempotente y no duplica tenant ni ubicación.
- [x] El administrador completa su acceso sin recibir secretos por pantalla o logs.

**Verificación:**

- [x] Recorrido E2E creación → invitación → activación → acceso.
- [x] Reintentar cada paso y comprobar idempotencia.

**Resultado:** el Superadmin crea el tenant y su ubicación principal en estado
borrador mediante una operación idempotente. Supabase Auth entrega la invitación
sin exponer enlaces, tokens ni identificadores internos en la interfaz. El primer
Administrador define contraseña y segundo factor; su primer acceso AAL2 activa
el alta. Los reintentos conservan una sola solicitud, tenant, ubicación y
membresía.

**Dependencias:** T05.

**Archivos probables:** módulo provisioning, vista Superadmin, contratos y E2E.

**Tamaño:** M.

### T08. Resolver tenant por dominio y proteger el contexto — completada

**Descripción:** Resolver subdominio/dominio público y convertir el tenant en requisito estructural de API, jobs y canales.

**Criterios de aceptación:**

- [x] Un host conocido resuelve exactamente un tenant activo y uno desconocido falla de forma segura.
- [x] No se acepta `tenant_id` del cliente como autoridad para escrituras autenticadas.
- [x] Jobs, Storage y Realtime incluyen y validan el mismo contexto.

**Verificación:**

- [x] Pruebas de host, spoofing de cabeceras y canales cruzados.
- [x] Smoke test con dos subdominios locales.

**Dependencias:** T04, T07.

**Archivos probables:** middleware tenant, tabla domains, utilidades de jobs/realtime, pruebas.

**Resultado:** el aprovisionamiento reserva un subdominio principal idempotente;
la API pública resuelve únicamente tenants y dominios activos desde `Host`, sin
confiar en `X-Forwarded-Host`; y el acceso administrativo exige que sesión,
membresía, tenant y ubicación coincidan. Los límites asíncronos comparten un
`TenantScope` estricto para jobs, rutas de Storage y canales Realtime. Pruebas
unitarias, pgTAP y un smoke local con dos subdominios cubren hosts desconocidos,
cabeceras falsificadas e intentos de alcance cruzado.

**Tamaño:** M.

### T09. Implementar auditoría, soporte y suspensión

**Descripción:** Registrar acciones sensibles y controlar asistencia temporal o suspensión sin cortar mesas activas por motivos comerciales.

**Criterios de aceptación:**

- [x] Soporte requiere autorización temporal, visible y revocable del Administrador.
- [x] Acciones sensibles registran actor, tenant, motivo, tiempo y correlación.
- [x] Suspensión comercial bloquea nuevas sesiones después de cerrar las activas; seguridad puede bloquear inmediatamente.

**Verificación:**

- [x] Pruebas de autorización/revocación y políticas de suspensión.
- [x] Inspección manual del historial sin secretos ni datos de pago completos.

**Dependencias:** T06, T08.

**Archivos probables:** módulo audit, módulo support-access, políticas suspension, vistas Superadmin.

**Resultado:** historial append-only, autorización temporal de soporte y
suspensión entregados en base y API. El panel Superadmin muestra negocios,
estados e historial sensible, y distingue suspensión comercial gradual de
seguridad inmediata. La finalización comercial queda reservada al ciclo de
mesas de T16: la API no puede falsear que se cerró la última sesión.

**Tamaño:** M.

### Checkpoint 2

- [ ] Se pueden crear dos negocios y demostrar aislamiento de extremo a extremo.
- [ ] Valentín aprueba la entrega inicial y el modelo de soporte.

## Fase 3 — Alta: identidad y carta

### T10. Guardar perfil, imágenes y propuesta visual — completada

**Descripción:** Entregar el primer tramo guardable del asistente con identidad básica, medios y una configuración visual editable.

**Criterios de aceptación:**

- [x] El Administrador guarda datos, logo, portada, colores y referencias desde móvil o escritorio.
- [x] Storage aplica rutas y permisos por tenant, límites, compresión y metadatos.
- [x] La vista previa nunca modifica la versión publicada.

**Verificación:**

- [x] Pruebas de archivos inválidos, cuota y acceso cruzado.
- [x] Recorrido responsive guardar → salir → continuar.

**Resultado:** el Administrador edita identidad, datos, colores e imágenes en un
borrador responsive con vista previa separada de la versión publicada. Las
imágenes se reservan en rutas privadas por tenant y ubicación, se validan,
comprimen y procesan en una cola durable antes de poder asociarse al perfil. La
base rechaza archivos pendientes, ajenos o de un tipo visual incorrecto. Un
recorrido autenticado contra Supabase local verificó reserva, guardado y carga
posterior del borrador de un tenant todavía no publicado, sin habilitarlo en la
ruta pública.

**Dependencias:** T08.

**Archivos probables:** módulo business-profile, adaptador storage, paso UI identidad, pruebas.

**Tamaño:** M.

### T11. Administrar carta, sectores y publicación versionada — completada

**Descripción:** Construir categorías, productos y sectores con borrador publicable, manteniendo disponibilidad como cambio inmediato separado.

**Criterios de aceptación:**

- [x] Producto asigna sector, precio, variantes, imagen y contenido por idioma.
- [x] Precio, texto y estructura quedan en borrador hasta una publicación atómica.
- [x] Disponibilidad cambia inmediatamente sin publicar el resto del borrador.

**Verificación:**

- [x] Pruebas de versionado, publicación atómica y toggle concurrente.
- [x] Recorrido E2E que compare borrador, vista previa y carta publicada.

**Resultado:** el Administrador puede editar categorías, sectores, productos, variantes, imágenes y contenido para cada idioma configurado, con una vista previa responsive. Texto, precio y estructura permanecen en un borrador versionado hasta una publicación atómica; una validación autoritativa exige identidad del negocio, categoría, sector, producto y títulos revisados en todos los idiomas. La disponibilidad se persiste por separado, cambia de inmediato con control de concurrencia y no publica cambios pendientes. Las pruebas unitarias, de integración local y de base de datos, junto con el recorrido real de navegador, validan aislamiento multitenant, seguridad y el flujo borrador → vista previa → publicación → cambio de disponibilidad.

**Dependencias:** T10.

**Archivos probables:** módulos catalog/publication, migración del corte, editor de carta, pruebas.

**Tamaño:** M.

### T12. Importar carta a un borrador revisable

**Descripción:** Aceptar carga manual, CSV/XLSX, PDF o fotos mediante una cola y normalizar resultados sin publicar automáticamente.

**Criterios de aceptación:**

- [x] Todo resultado importado es borrador con confianza, errores y campos dudosos visibles.
- [x] El Administrador aprueba, corrige o descarta antes de incorporar a la carta.
- [x] Fallo o ausencia de OCR no bloquea la carga manual.

**Verificación:**

- [x] Fixtures de archivos válidos, maliciosos, incompletos y duplicados.
- [x] Prueba del worker con reintento e idempotencia.

**Resultado:** el Administrador puede encolar una carga manual o un archivo CSV,
XLSX, PDF o imagen de hasta 8 MB. El límite, la extensión, el MIME y las firmas
binarias se validan antes de persistir; el worker normaliza CSV/XLSX y deja PDF o
imagen como borrador revisable cuando no hay OCR configurado. Cada campo expone
confianza y dudas, los errores quedan asociados a su fila y ninguna importación
modifica la carta publicada. La aprobación vuelve a validar el borrador y sólo lo
fusiona con el borrador versionado de T11. La cola aplica reintentos acotados,
acknowledgement terminal e idempotencia por tenant, ubicación y clave. Las
funciones privadas de base de datos, la autorización de Administrador y las
respuestas sin fuente original mantienen el aislamiento multitenant. Contratos,
repositorio, SQL, worker, API y UI tienen pruebas; la revisión visual cubrió
escritorio y 375 px sin desborde horizontal.

**Dependencias:** T11.

**Archivos probables:** adaptador import/OCR, worker job, revisión UI, pruebas.

**Tamaño:** M.

### Checkpoint 3

- [x] Un Administrador puede crear y publicar una carta mínima aislada.
- [ ] Se aprueba la diferencia visual entre borrador, publicado y disponibilidad inmediata.

## Fase 4 — Alta: operación y publicación

### T13. Diseñar plano, mesas, agrupaciones y QR

**Descripción:** Entregar el editor visual con mesas físicas persistentes y QR estables.

**Criterios de aceptación:**

- [x] Se crean sectores, mesas, formas, sillas, posición y numeración sin perder identidad al moverlas.
- [x] Agrupar no reemplaza los IDs ni QR de las mesas físicas.
- [x] Guardar genera QR descargables y verificables por tenant.

**Verificación:**

- [x] Pruebas de geometría serializada, unicidad QR y agrupación/separación.
- [x] Recorrido manual responsive, con recomendación no bloqueante de pantalla amplia.

**Dependencias:** T08, T11.

**Archivos probables:** módulo floor-plan, editor UI, generador QR, pruebas.

**Tamaño:** M.

**Resultado:** el Administrador diseña el salón en `/panel/plano`: crea sectores y
mesas redondas, cuadradas o rectangulares con posición, rotación, medidas, número
o nombre y sillas (cantidad y disposición), las arrastra o mueve con el teclado,
las agrupa y separa, y guarda con control de versión. La identidad física
(`floor_tables`), la geometría (`floor_table_geometry`) y la pertenencia a una
agrupación (`floor_groups`/`floor_group_members`) viven en tablas separadas; mover,
redimensionar, renombrar, agrupar o separar nunca cambia el ID ni el QR. Cada mesa
recibe un token de 256 bits aleatorio, único e inmutable (sin IDs, tenant ni datos
sensibles en la URL `/m/<token>`); sólo se resuelve dentro del tenant y la
ubicación ya probados por el dominio, la rotación revoca el anterior y quitar una
mesa revoca su QR. Guardar es un comando idempotente por `commandId` con
`expectedVersion` (409 ante conflicto, sin last-write-wins); el contrato, la API y
las restricciones de base de datos validan rangos, límites y claves desconocidas,
y rechazan `tenantId`/`locationId` inyectados. El editor informa errores por
mesa, conserva los cambios ante fallos, reintenta con el mismo `commandId` y
ofrece cargar la versión más reciente. `floor_plan_readiness` expone mesas activas
con QR válido para T15. Verificado con 14 pruebas de contrato, 10 de repositorio,
pruebas de servicio/controlador, 30 aserciones pgTap (aislamiento entre dos
tenants, QR, idempotencia, conflicto, intercambio de nombres, retiro y rotación),
integración HTTP con dos tenants contra Supabase local y un recorrido real en
navegador (escritorio y 375 px, sin desborde horizontal): crear sector → crear
mesas → mover (arrastre y teclado) → agrupar → guardar → recargar → separar →
descargar QR → verificar; los QR quedaron idénticos tras agrupar y separar.
El navegador usó un arnés temporal local (no versionado) que firma un JWT de
prueba contra la API real en lugar de pasar por el inicio de sesión/MFA de T05.

### T14. Configurar equipo y medios de pago

**Descripción:** Completar los pasos de cuentas individuales y medios de pago sin exponer credenciales.

**Criterios de aceptación:**

- [x] Administrador crea, desactiva y asigna roles/sectores a empleados.
- [x] Efectivo inicia habilitado y sólo puede desactivarse si existe otro medio.
- [x] Credenciales externas se almacenan cifradas/referenciadas y nunca vuelven al navegador.

**Verificación:**

- [x] Pruebas de reglas de medios, permisos y desactivación de usuario activo.
- [x] Revisión manual de red y logs para comprobar ausencia de secretos.

**Dependencias:** T06, T11.

**Archivos probables:** módulo team, módulo payment-settings, pasos UI, pruebas.

**Tamaño:** M.

**Resultado:** el Administrador gestiona `/panel/equipo` y `/panel/pagos`. Equipo:
crea empleados (usuario, nombre, rol de T06, PIN de seis dígitos que sólo viaja
hasheado a SQL, sectores), los edita, los desactiva o reactiva y restablece su PIN.
Los sectores asignables son los del **salón** (`private.floor_sectors`, T13) y sólo
para el rol Mozo; Cocina y Barra ya quedan ligados a su sector de producción de T11
por rol. No se puede desactivar ni degradar al último Encargado activo (bloqueo de
filas, `PT001`), y desactivar, cambiar de rol o restablecer el PIN revoca las
sesiones abiertas. Pagos: efectivo inicia habilitado y sólo se deshabilita si queda
otro medio disponible (función con bloqueo de la ubicación más un _constraint
trigger_ diferido, `PT004`); la clave pública vive en `public_config` y la
credencial privada se cifra en la API (AES-256-GCM, tenant/ubicación/medio como
datos autenticados) y sólo el _ciphertext_ llega a SQL; ninguna lectura la devuelve.
Todas las altas, bajas, cambios de rol/sector y de medios se auditan sin PIN, hash,
usuario ni credencial. Verificado con 24 aserciones pgTap de equipo y 24 de pagos
(dos tenants), 24 pruebas de contrato, 8 de repositorio, 25 de API/controladores,
integración HTTP con dos tenants contra Supabase local (7 pruebas: aislamiento,
alta y login real de T06, desactivación que cierra la sesión, último Encargado,
reglas de medios, credencial cifrada y ausencia de PIN/hash/credencial en toda
respuesta) y un recorrido real en navegador (inicio de sesión con contraseña y
TOTP; escritorio y 375 px sin desborde): se inspeccionaron red, DOM, almacenamiento,
logs de API/web/proxy y la base. Esa inspección detectó que el servidor de
desarrollo de Next imprimía los argumentos de las Server Actions (PIN y
credencial); se corrigió con `logging.serverFunctions: false` y una prueba.

### T15. Validar, probar y publicar el negocio

**Descripción:** Crear la lista autoritativa de requisitos, una simulación aislada y la publicación autónoma por Administrador.

**Criterios de aceptación:**

- [x] El sistema explica cada requisito faltante sin impedir guardar avances.
- [x] Modo prueba recorre QR, pedido, producción, pago, cierre y limpieza sin contaminar métricas reales.
- [x] Sólo Administrador publica y la operación no requiere aprobación de Valentín.

**Verificación:**

- [x] Matriz automática de requisitos mínimos.
- [x] E2E de prueba y publicación, verificando aislamiento de datos simulados.

**Dependencias:** T10–T14.

**Archivos probables:** módulo readiness, módulo sandbox-mode, revisión/publicación UI, E2E.

**Tamaño:** M.

**Resultado:** la base evalúa una matriz de diez códigos (siete bloqueos y tres
recomendaciones; crear empleados no es requisito) sobre perfil, carta publicada,
plano/QR y medios de pago, y el contrato les da explicación y enlace al paso; ninguna
función de T10–T14 la consulta, así que guardar avances nunca se bloquea. El modo
prueba vive en tablas y funciones propias (`sandbox_*`, namespace y referencias
`SBX-`), recorre QR → pedido → producción → pago simulado → cierre → limpieza en una
transacción, sólo lee plano y carta, no toca `payment_methods`, credenciales, equipo
ni la publicación, y audita con el prefijo `sandbox.`. Publicar exige Administrador y
una transacción que serializa la ubicación, toma `FOR SHARE` sobre lo que valida y
revalida todo (sin TOCTOU); no requiere aprobación de la plataforma. Verificado con
pruebas de contrato (12), repositorio (6), controlador/servicio (7) y acción/panel
(10), 58 aserciones pgTap con dos tenants (matriz, autorización, aislamiento,
inercia del estado real, limpieza), integración HTTP local con dos tenants del alta
ficticia completa (borrador sin publicar e importación pendiente fuera de la carta
pública, simulación inerte, carrera publicar vs. guardar con prueba de mutación) y un
recorrido en navegador real (escritorio y 375 px, sin desborde): ver requisitos →
simulación rechazada con explicación → guardar plano → simulación completa →
publicar. El navegador usó un arnés temporal local (no versionado) con usuario,
contraseña y TOTP creados por la API admin de Supabase local. Runbook:
`docs/runbooks/publicacion-y-modo-prueba.md`.

### Checkpoint 4

- [ ] Alta completa de un negocio ficticio desde cero.
- [ ] Valentín aprueba el asistente antes de iniciar operación real.

## Fase 5 — Experiencia del comensal

### T16. Entrar por QR respetando el estado de mesa

**Descripción:** Resolver QR, tenant, mesa física y sesión vigente sin permitir pedidos automáticos en mesas no habilitadas.

**Criterios de aceptación:**

- [x] Disponible permite iniciar flujo; ocupada se une a la sesión correcta.
- [x] Pendiente de limpieza o fuera de servicio permite ver carta y llamar al mozo, no confirmar automáticamente.
- [x] QR inválido, tenant suspendido o agrupación cambiada tienen salida segura y comprensible.

**Verificación:**

- [x] Pruebas de todos los estados y QR de mesas agrupadas.
- [x] E2E móvil desde escaneo simulado.

**Dependencias:** T13, T15.

**Archivos probables:** resolver QR API, entrada pública UI, estado de mesa, pruebas.

**Resultado:** `private.resolve_table_entry` (SQL, rollback y 11 aserciones pgTap con dos
tenants) combina el QR con la planta, el estado de servicio de la mesa
(`floor_table_service_states`; sin fila = disponible), el grupo, la publicación y la
suspensión comercial. `POST /v1/public/table-entry` lo expone sólo por host, con el
token en el cuerpo y respuesta idéntica para tokens inválidos; la página `/m/[token]`
muestra empezar, unirse («Estás en <grupo> (mesas X y Y)»), sólo carta y mozo, o una
salida segura para QR inválido, negocio sin publicar o no disponible. Verificado en
navegador (escritorio y 375 px). Pendientes asignados a otras tareas: unir a una sesión
real (T22), llamado al mozo y carta (T17, T19), regla de no agrupar con cuentas
distintas (T22/T27). Runbook: `docs/runbooks/entrada-por-qr.md`.

**Tamaño:** M.

### T17. Navegar carta y mantener un borrador privado — completada

**Descripción:** Implementar Carta, detalle y “Mi pedido” privado por dispositivo sin reservar stock.

**Criterios de aceptación:**

- [x] El borrador no es visible para otros dispositivos de la mesa.
- [x] Variantes, cantidades e importe se recalculan con reglas del servidor.
- [x] Un producto desactivado queda marcado y bloquea confirmación hasta corregirlo.

**Verificación:**

- [x] Pruebas con dos dispositivos en una sesión.
- [x] E2E de edición y desactivación concurrente.

**Dependencias:** T11, T16.

**Archivos probables:** módulo drafts, carta UI, bandeja UI, pruebas.

**Tamaño:** M.

**Resultado:** `/m/[token]` carga la carta publicada, ofrece navegación por categoría,
detalle y variantes, y mantiene «Mi pedido» en `localStorage` con una clave opaca por
host y QR. El dispositivo guarda sólo ids y cantidades; `POST
/v1/public/drafts/recalculate` vuelve a resolver la mesa y recalcula nombres, precios,
variantes, disponibilidad y totales desde el servidor sin reservar stock. Una mesa en
modo sólo lectura o una línea desactivada/eliminada devuelve `canConfirm: false` y la UI
marca el problema sin borrar la selección. Playwright lo verificó con dos contextos de
navegador aislados y con una desactivación concurrente, en móvil y escritorio. Runbook:
`docs/runbooks/carta-y-borrador-comensal.md`.

### T18. Confirmar pedido o solicitar atención presencial — completada

**Descripción:** Convertir el borrador en intención validada, con identificación opcional y caminos online/presencial.

**Criterios de aceptación:**

- [x] Nombre y silla se solicitan cuando se atribuye/paga consumo individual; silla sigue opcional en el caso general.
- [x] Pago online pendiente no confirma ni envía a producción.
- [x] Medio presencial crea un llamado con productos y motivo para validación del mozo.

**Verificación:**

- [x] Pruebas de transición y confirmación atómica de disponibilidad/stock.
- [x] E2E para cuenta general, consumo propio y llamado presencial.

**Dependencias:** T17.

**Archivos probables:** módulo order-intent, confirmación UI, módulo calls, pruebas.

**Tamaño:** M.

**Resultado:** el contrato canónico exige nombre, `commandId` y líneas sin precios;
cuenta general admite silla opcional y consumo propio la exige. `POST
/v1/public/order-intents`, protegido por el contexto derivado de `Host`, llama a una
función SQL acotada que reclama el comando de forma persistente y revalida en una sola
transacción QR, mesa, publicación, productos, variantes, disponibilidad, cantidades,
medio de pago, precios y stock operativo opcional. El camino presencial crea una
intención `awaiting_waiter` y un único llamado `order_validation`; Mercado Pago crea
solamente `payment_pending`. Ninguno confirma, abre cuenta, reserva stock ni envía a
producción. La UI pide nombre, atribución, silla y medio habilitado; su proxy limita el
payload y el borrador sólo se limpia tras una aceptación. Verificado con 18 aserciones
pgTap, pruebas unitarias/de repositorio/API/web y Playwright móvil/escritorio para
cuenta general, consumo propio, online pendiente, concurrencia idempotente y fallo con
borrador conservado. Runbook: `docs/runbooks/intenciones-de-pedido.md`.

### Checkpoint 5

- [x] Cliente invitado completa el recorrido hasta pedido pendiente de validación.
- [ ] Se revisa el prototipo ejecutable en teléfono real.

## Fase 6 — Operación y producción

### T19. Operar salón, llamados y pedidos manuales — completada

**Descripción:** Dar al Mozo una vista viva del salón y capacidad de validar o cargar una comanda.

**Criterios de aceptación:**

- [x] Salón muestra mesa, sesión, llamado, saldo y estado sin cruzar tenant.
- [x] Mozo valida una intención o carga un pedido manual atribuido a persona/mesa.
- [x] Confirmar y cobrar ahora o dejar cuenta abierta son decisiones separadas.

**Verificación:**

- [x] Pruebas de permisos y transiciones de llamado.
- [x] E2E cliente → llamado → mozo → pedido confirmado.

**Resultado:** el Mozo (y el Encargado) usan `/interno/<negocio>/operacion/salon`: vista
viva por polling (5 s) con plantas, mesas y grupos como una unidad, llamados e
intenciones por validar; reclamar un llamado, confirmar o rechazar una intención de T18
(motivo obligatorio al rechazar) y cargar una comanda manual a la mesa o a una persona.
La API (`/v1/staff/*`) resuelve empleado, tenant, ubicación, rol y capacidades sólo del
Bearer de la sesión en cada solicitud y rechaza cualquier tenant, ubicación, staff, rol,
precio, total o pago enviado por el cliente; SQL vuelve a verificar empleado activo,
rol y sector (el Mozo sólo opera en sus sectores; el Encargado no amplía su alcance).
Reclamar y decidir bloquean filas: de dos Mozos simultáneos gana uno, los reintentos
idénticos devuelven el mismo resultado (`waiter_commands`) y todo queda auditado. Los
pedidos confirmados, sus ítems y las decisiones son append-only. Confirmar revalida mesa,
carta, disponibilidad y precio, y descuenta el stock operativo opcional; un pago online
pendiente nunca es confirmable. El resultado lleva `payment: not_recorded` y las
decisiones «Cobrar ahora» / «Dejar cuenta abierta» aparecen separadas y deshabilitadas:
no se crea pago, saldo, ledger, sesión de mesa ni envío a producción. Verificado con 8
pruebas de contrato nuevas, 7 de repositorio, 9 de API y 17 de web, 71 aserciones pgTap (dos
tenants), 14 de integración HTTP con dos tenants y Mozos concurrentes y 14 recorridos
Playwright (móvil 375 px y escritorio, 3100/3101). Runbook:
`docs/runbooks/operacion-del-salon.md`. Pendientes: llamado genérico «Llamar al mozo»
del comensal y apagar la disponibilidad al llegar a stock cero.

**Dependencias:** T18.

**Archivos probables:** módulo waiter, salón UI, comanda UI, pruebas.

**Tamaño:** M.

### T20. Producir por sector y estado de ítem — completada

**Descripción:** Distribuir cada ítem confirmado al KDS correspondiente y derivar el estado general.

**Criterios de aceptación:**

- [x] Cocina/Barra sólo ven sectores asignados y nunca pedidos sin confirmar.
- [x] Ítems avanzan En cola → En preparación → Listo; orden deriva su estado.
- [x] Reintentos o reconexiones no duplican comandas.

**Verificación:**

- [x] Pruebas de enrutamiento, permisos e idempotencia.
- [x] E2E pedido con ítems de dos sectores.

**Resultado:** Cocina y Barra usan `/interno/<negocio>/operacion/produccion`: ven sólo las
comandas de su sector (el sector sale de la sesión), nunca un pedido sin confirmar, y
avanzan cada ítem En cola → En preparación → Listo; el estado del pedido completo se
deriva de sus ítems. Los pedidos confirmados siguen siendo append-only: los estados
viven en `production_items` (una fila por ítem, creada por trigger y con la clave del
ítem, por lo que ningún reintento duplica comandas) y su historial en
`production_item_events`. Avanzar es idempotente (mismo comando, otro comando con el
mismo destino y bloqueo de fila), sólo hacia adelante y auditado. Verificado con 47
aserciones pgTap (dos negocios), 13 pruebas de contrato nuevas, 4 de repositorio, 16 de
API, 8 de web, 6 de integración HTTP y 6 recorridos Playwright (móvil 375 px y
escritorio, 3100/3101; 50 en total). Runbook: `docs/runbooks/produccion-por-sector.md`.
Pendientes: entregar, faltantes y cancelaciones (T21); pantalla para sectores
`other`; Realtime en lugar de polling (T31).

**Dependencias:** T19.

**Archivos probables:** módulo production, KDS UI, eventos/worker, pruebas.

**Tamaño:** M.

### T21. Resolver entrega, faltantes y cancelaciones — completada

**Descripción:** Completar excepciones auditadas sin reescribir pedidos confirmados.

**Criterios de aceptación:**

- [x] Mozo marca Entregado; producción registra Excepción sin borrar consumos.
- [x] Cancelar en preparación exige Encargado/Administrador y motivo.
- [x] Reemplazo genera aceptación y diferencia económica vinculada.

**Verificación:**

- [x] Matriz de permisos/estados y pruebas del historial inmutable.
- [x] E2E de faltante → reemplazo y faltante → cancelación.

**Resultado:** el Mozo marca «Entregado» sólo lo que está Listo; Cocina y Barra informan un
faltante con motivo sin borrar el ítem ni su consumo; el reemplazo se propone con el precio
de la carta y la diferencia económica, y se registra la aceptación del comensal (o su
rechazo, con motivo); sólo el Encargado cancela, con motivo, antes de que el ítem esté
listo. Los estados viven en `production_items` (con `Entregado`, `Faltante`,
`Cancelado` y `Reemplazado`) e historial append-only, y los ajustes en
`order_adjustments` (se deciden una sola vez y no se reescriben). El Mozo y el Encargado
ven «Pedidos en curso» con el estado por ítem. Verificado con 76 aserciones pgTap (dos
negocios), 31 pruebas de contrato y 11 de repositorio nuevas (junto con T22), 21 de
controlador, 6 de integración HTTP (incluye concurrencia) y 6 recorridos Playwright (móvil
375 px y escritorio, 3100/3101). Runbook: `docs/runbooks/entrega-faltantes-y-cancelaciones.md`.
Pendientes: aceptación directa del comensal desde su teléfono; pantalla para sectores
`other`.

**Dependencias:** T20.

**Archivos probables:** módulo order-adjustments, vistas waiter/KDS, auditoría, pruebas.

**Tamaño:** M.

### Checkpoint 6

- [x] Pedido atraviesa cliente, mozo, cocina/barra y entrega por ítem.
- [ ] Excepciones conservan historia y pasan revisión operativa.

## Fase 7 — Cuenta y pagos

### T22. Mantener una cuenta append-only — completada

**Descripción:** Implementar cargos, descuentos, pagos, propinas, ajustes y devoluciones como movimientos inmutables.

**Criterios de aceptación:**

- [x] Consumido, pagado y pendiente se derivan del libro mayor, no de campos reescribibles.
- [x] Cada movimiento referencia actor, origen, moneda, tenant y causa.
- [x] Recalcular desde cero produce el mismo saldo.

**Verificación:**

- [x] Pruebas property-based de invariantes y redondeo monetario.
- [x] Integración concurrente contra PostgreSQL.

**Resultado:** confirmar el primer pedido de una mesa (o grupo) abre una sesión de mesa y la deja
Ocupada; cada ítem, cancelación, reemplazo, descuento, propina y cobro presencial es un
movimiento inmutable de `account_entries` con tenant, ubicación, actor, origen, moneda,
causa y fuente. Consumido, descuentos, propinas, cobrado y pendiente se derivan del libro, y
`verify_account` recalcula el consumo desde los ítems y ajustes con el mismo resultado.
«Cobrar ahora» (medio presencial, monto o todo el saldo, propina) y «Dejar cuenta abierta»
son decisiones separadas de confirmar; sólo el Encargado da descuentos (monto o porcentaje con
redondeo al centavo, siempre con motivo). El salón muestra la mesa Ocupada con su saldo y la
pestaña «Cuentas» lista movimientos y acciones. Verificado con 88 aserciones pgTap (dos
negocios, con propiedades de redondeo), 20 pruebas de controlador, 7 de integración HTTP
contra PostgreSQL (cobros y confirmaciones concurrentes, 12 secuencias aleatorias con
semilla contra un modelo independiente) y 6 recorridos Playwright (móvil 375 px y escritorio;
56 + 6 en toda la suite). Runbook: `docs/runbooks/cuenta-de-mesa.md`. Pendientes: caja,
arqueo y devoluciones (T23), Mercado Pago (T24), dividir por persona (T25), cerrar la
sesión y liberar la mesa (T26).

**Dependencias:** T19, T21.

**Archivos probables:** módulo ledger, migración del corte, contratos, pruebas.

**Tamaño:** M.

### T23. Operar caja y pagos presenciales

**Descripción:** Registrar turnos, arqueo ciego, medios físicos y devoluciones realizadas fuera de la plataforma.

**Criterios de aceptación:**

- [x] Caja registra apertura, movimientos, responsable y cierre con diferencia justificada.
- [x] Tarjeta física nunca solicita PAN, vencimiento ni CVV.
- [x] Devolución presencial queda vinculada al pago/ítem y autorizada según rol.

**Verificación:**

- [x] Pruebas del arqueo, permisos y caja con pendientes.
- [x] E2E apertura → cobros mixtos → devolución → cierre.

**Dependencias:** T22.

**Archivos probables:** módulo cash-register, cobro UI, cierre UI, pruebas.

**Tamaño:** M.

### T24. Cobrar con Mercado Pago

**Descripción:** Integrar OAuth por tenant, Checkout Bricks y conciliación autoritativa por webhook/API.

**Criterios de aceptación:**

- [x] Credenciales y pagos están aislados por tenant.
- [x] Webhooks se autentican, deduplican y consultan el estado autoritativo.
- [x] Sólo acreditado confirma el pedido y movimiento; pendiente/fallido no lo hace.

**Verificación:**

- [x] Pruebas de firma, reordenamiento, duplicado y replay de webhooks.
- [x] E2E en sandbox de éxito, pendiente, rechazo y devolución parcial.

**Dependencias:** T18, T22.

**Archivos probables:** adaptador Mercado Pago, módulo payments, webhook, pruebas.

**Tamaño:** M.

### Checkpoint 7

- [ ] Cuenta y caja cuadran en escenarios presencial y online.
- [ ] Revisión específica de seguridad e idempotencia financiera.

## Fase 8 — Mesa y cobros avanzados

### T25. Cobrar parcialmente y dividir saldo

**Descripción:** Permitir monto personalizado, varios pagadores, medios mixtos y participaciones iguales sin doble reclamo.

**Criterios de aceptación:**

- [x] Participaciones se calculan sobre saldo vigente y se reclaman atómicamente.
- [x] Un dispositivo puede pagar varias; consumos posteriores crean saldo nuevo.
- [x] Dos pagos simultáneos nunca exceden el pendiente.

**Verificación:**

- [x] Pruebas concurrentes con barreras reales de base de datos.
- [x] E2E de tres personas, una pagando dos partes y consumo posterior.

**Dependencias:** T22–T24.

**Archivos probables:** módulo allocations, flujo split UI, conciliación, pruebas.

**Estado:** hecho. Ver `docs/runbooks/dividir-cuenta.md`: partes iguales o por consumo sobre el saldo vigente, reserva de partes desde el teléfono, cobro atómico (presencial o con Mercado Pago) de una o varias partes, pruebas con carreras reales y E2E de tres personas.

**Tamaño:** M.

### T26. Cerrar, limpiar, habilitar y emitir comprobante — completada

**Descripción:** Completar el ciclo de la sesión sin liberar automáticamente la mesa al pagar.

**Criterios de aceptación:**

- [x] Saldo cero permite cerrar y mueve a Pendiente de limpieza.
- [x] Sólo personal autorizado marca limpia y Disponible.
- [x] Comprobante indica que no es factura y `Avisar a caja` crea una solicitud interna.

**Verificación:**

- [x] Máquina de estados de mesa con transiciones inválidas rechazadas.
- [x] E2E pago → cierre → QR bloqueado → limpieza → nueva sesión.

**Resultado:** una cuenta con saldo exactamente cero (y sin pagos online por devolver) se cierra: la división abierta se anula, todas las mesas de la sesión pasan a Pendiente de limpieza y se emite un comprobante numerado, inmutable y no fiscal («Comprobante de consumo — no válido como factura»). Sólo el Mozo de la mesa o el Encargado la marca limpia y Disponible; una mesa en limpieza no puede volver a Ocupada (máquina de estados con `PT275`) y su QR queda en sólo lectura. «Avisar a caja» crea una única solicitud interna sin datos fiscales. Verificado con 59 aserciones pgTap, 6 pruebas de integración con carreras reales (cierres, cobro y pedido simultáneos, limpiezas), contratos, repositorio, controlador, acciones web y 4 recorridos Playwright (móvil 375 px y escritorio, 3100/3101). Runbook: `docs/runbooks/cierre-limpieza-y-comprobante.md`. Pendientes: envío del comprobante, PDF en servidor.

**Dependencias:** T23, T25.

**Archivos probables:** módulo table-state, comprobante/PDF, UI cierre/limpieza, pruebas.

**Tamaño:** M.

### T27. Unir y separar mesas conservando historia — completada

**Descripción:** Aplicar agrupaciones durante el servicio sin redistribuir deuda ni invalidar QR físicos.

**Criterios de aceptación:**

- [x] Todos los QR reconocen la agrupación vigente.
- [x] Separar exige mesa ancla para la sesión abierta y libera las restantes según estado.
- [x] Pedidos, pagos y deuda nunca se mueven automáticamente.

**Verificación:**

- [x] Pruebas de agrupación concurrente y restricciones.
- [x] E2E unir → consumir → pagar parcial → separar → nueva sesión.

**Resultado:** el personal une mesas (`POST /v1/staff/table-groups`) y las separa (`…/:groupId/separate`) con el servicio en marcha. Una sola cuenta abierta sigue al grupo; dos cuentas distintas no se mezclan (`PT278`); al separar con una cuenta abierta hay que elegir la mesa ancla (`PT279`) y las demás se liberan según su estado (Ocupada → Disponible; limpieza pendiente y fuera de servicio se conservan). El libro, los pedidos y el saldo no se tocan y cada QR lee el grupo vigente. El editor del plano no puede romper los grupos de una cuenta abierta (`PT280`) y unir/separar suben la versión del plano. Un candado por ubicación (compartido al abrir sesiones, exclusivo al unir/separar) evita sesiones con alcance viejo: la prueba de carrera falla si se quita. Verificado con 85 aserciones pgTap, 9 pruebas de integración con carreras reales, contratos, repositorio, controlador, acciones web y un Playwright (móvil 375 px y escritorio, 3100/3101). Runbook: `docs/runbooks/unir-y-separar-mesas.md`.

**Dependencias:** T13, T22, T26.

**Archivos probables:** módulo table-groups, salón UI, sesión/ledger integration, pruebas.

**Tamaño:** M.

### Checkpoint 8 — Piloto operativo

- [ ] Todos los recorridos del Hito A pasan en dispositivos reales.
- [ ] Restauración de copia y rollback se ensayan en staging.
- [ ] Valentín autoriza o rechaza el piloto antes de activar un cliente.

## Fase 9 — Retención

### T28. Registrar clientes con Google y consentimientos — completada

**Descripción:** Agregar cuenta global de comensal separada del personal y perfiles/consentimientos por restaurante.

**Criterios de aceptación:**

- [x] Login siempre es opcional y conserva `Continuar sin cuenta`.
- [x] El restaurante no recibe email de Google ni datos de otro tenant.
- [x] WhatsApp verificado y marketing son consentimientos distintos, revocables y versionados.

**Verificación:**

- [x] Pruebas de vinculación, revocación, exportación y anonimización lógica.
- [x] E2E invitado y registrado sin bloqueo de carta.

**Resultado:** el comensal puede ingresar con Google (`DINER_AUTH_MODE` off | fake | live) sin que la carta lo espere ni lo exija; la cuenta global (`private.diner_accounts`, con el correo y un hash con pepper del `sub`) está separada de `staff_members` y de `tenant_memberships` y tiene sesión propia. Cada restaurante sólo conoce el perfil que el comensal creó con él (`profile_id` aleatorio por tenant; el puente cuenta–perfil no lo lee ninguna función de tenant). Los consentimientos `whatsapp_verified` y `marketing` son tablas append-only con versión del texto, origen y fecha: revocar agrega una fila. Vincular al comensal enlaza con la sesión de mesa (no con la mesa) mediante `diner_session_links`, bajo el candado compartido por ubicación, sin tocar `table_sessions` ni el libro. Incluye exportación de los datos propios y anonimización lógica que conserva las referencias del historial. Verificado con 58 aserciones pgTap (dos tenants), 4 pruebas de integración con carreras reales (vincular ×8, revocar mientras se acepta, anonimizar mientras se vincula, canje simultáneo de un código), contratos, repositorio, servicio, controladores, pasarela de Google, proxy web y 6 recorridos Playwright (móvil 375 px y escritorio, 3100/3101). Runbook: `docs/runbooks/cuenta-de-comensal.md`. Pendientes: verificación real del número de WhatsApp, pantalla del restaurante para sus clientes y texto legal propio por restaurante desde el panel.

**Dependencias:** T16, T22.

**Archivos probables:** módulo customer-identity, consentimiento, pantallas login/perfil, pruebas.

**Tamaño:** M.

### T29. Acreditar visitas y administrar premios — completada

**Descripción:** Implementar visitas diarias verificadas, cumpleaños y premios personales con canje atómico.

**Criterios de aceptación:**

- [x] Máximo una visita diaria por persona/tenant con mínimo configurable y atribución válida.
- [x] Devolución total revoca visita; cumpleaños cumple antigüedad y límite de cambios.
- [x] Reserva, pago y canje son atómicos; un pago fallido libera el premio.

**Verificación:**

- [x] Pruebas de zona horaria, mesa grupal, fraude básico y concurrencia.
- [x] E2E completar objetivo y usar premio en la misma compra.

**Resultado:** las visitas se acreditan solas al cerrar una cuenta (sin demorar ni hacer fallar el cierre): una por persona y día local de la ubicación, con consumo neto mínimo configurable, permanencia mínima, sin descuento total ni devolución y con reparto en partes iguales entre los perfiles vinculados a la sesión (mesa grupal). Una devolución total revoca la visita y el premio sin usar que había desbloqueado. El cumpleaños (sólo mes y día) exige antigüedad del perfil y un límite de cambios. Reservar un premio no toca el libro; canjear con cobro escribe el descuento, cobra el resto y marca el premio usado en **una** transacción, y si el cobro falla el premio vuelve al comensal. Verificado con 61 aserciones pgTap (dos tenants, Buenos Aires y Tokio), rollback aplicar → revertir → reaplicar, 3 pruebas de integración con carreras reales (dos cierres del mismo día, seis canjes simultáneos, cobro fallido contra liberación), contratos, controladores y un Playwright (móvil y escritorio, 3100/3101) que completa la meta y usa el premio en la misma compra. Runbook: `docs/runbooks/fidelizacion.md`. Pendientes: canje con Mercado Pago, premio de cumpleaños, atribución real por asiento y lista de visitas por cliente para el restaurante.

**Dependencias:** T25, T28.

**Archivos probables:** módulo loyalty, reglas/reloj, UI perfil/premios, pruebas.

**Tamaño:** M.

### T30. Conectar WhatsApp y automatizaciones básicas — completada

**Descripción:** Vincular la cuenta de Meta de cada restaurante y enviar avisos aprobados respetando consentimiento y frecuencia.

**Criterios de aceptación:**

- [x] Número, plantillas, costos y tokens están aislados por tenant.
- [x] Automatizaciones permanentes requieren aprobación inicial; eventos puntuales requieren confirmación.
- [x] Horarios, topes, opt-out e inactividad bloquean mensajes cuando corresponde.

**Verificación:**

- [x] Pruebas con proveedor simulado para límites, reintentos y baja.
- [ ] Integración sandbox con webhook y plantilla aprobada — diferida: el webhook firmado y la plantilla aprobada se probaron con el simulador; el sandbox real de Meta queda pendiente.

**Resultado:** cada restaurante conecta su número (ID, cuenta y token cargados a mano en el panel «Mensajería»; el token queda sellado con `PaymentSecretSealer` y nunca vuelve al navegador). Una sola función de base decide si un mensaje sale y, ante cualquier duda, lo bloquea: consentimiento vigente leído del historial (promocional exige `marketing` y número verificado; operativo, `whatsapp_verified`), horario de 10 a 20 h en la zona del local (fuera de horario se pospone), tope de 2 por semana y 8 por mes por persona, 12 meses sin actividad y perfil anonimizado; los operativos salen enseguida y no gastan cupo. La respuesta BAJA revoca `marketing` con origen propio y bloquea al instante lo que esperaba. Las automatizaciones permanentes (premio ganado, por vencer, cumpleaños, inactividad) se aprueban una vez; los eventos puntuales se preparan y se confirman cada vez. La cola reintenta con espera creciente (5 intentos), nunca reenvía un mensaje cuyo resultado se perdió y deduplica el webhook firmado. Verificado con 114 aserciones pgTap (dos tenants), rollback aplicar → revertir → reaplicar, carreras reales (confirmar 8 veces, el mismo evento 8 veces, dos y tres workers, seis promocionales contra el tope), worker con proveedor simulado (límites, reintentos, baja, horario), API con webhook firmado y un Playwright (móvil y escritorio, 3100/3101). Los envíos reales siguen apagados por defecto. Runbook: `docs/runbooks/whatsapp.md`. Pendientes: verificación del número del comensal (tarea aparte), sandbox real de Meta, costos facturables, OAuth/Embedded Signup.

**Dependencias:** T28, T29.

**Archivos probables:** adaptador WhatsApp, worker campaigns, módulo consent-policy, pruebas.

**Tamaño:** M.

### Checkpoint 9

- [ ] Fidelización funciona sin afectar uso como invitado.
- [ ] Revisión legal/comercial de consentimientos y mensajes antes de activar envíos reales.

## Fase 10 — Preparación para lanzamiento

### T31. Completar PWA, reconexión y Realtime

**Descripción:** Hacer visible y recuperable la conectividad deficiente sin afirmar escrituras no confirmadas.

**Criterios de aceptación:**

- [ ] Shell/lecturas permitidas funcionan según política de caché; escrituras críticas esperan ACK.
- [ ] Reconexión invalida caché y consulta estado autoritativo.
- [ ] Duplicar/reintentar una acción crítica mantiene idempotencia.

**Verificación:**

- [ ] Playwright con red offline/lenta y reconexiones repetidas.
- [ ] Pruebas de carga de canales privados Realtime.

**Dependencias:** T20, T24, T30.

**Archivos probables:** service worker/PWA, cliente Realtime, estados conexión, pruebas.

**Tamaño:** M.

### T32. Completar accesibilidad, responsive e idiomas

**Descripción:** Cerrar la experiencia en teléfonos, tablets y escritorio con contenido traducido sólo después de aprobación.

**Criterios de aceptación:**

- [ ] Flujos críticos cumplen WCAG 2.2 AA verificable y navegación por teclado.
- [ ] No hay texto operativo ilegible ni controles sin nombre accesible.
- [ ] Traducciones automáticas son borrador, tienen fallback y no alteran precios/disponibilidad.

**Verificación:**

- [ ] axe, contraste, zoom, teclado y lector de pantalla en recorridos clave.
- [ ] Matriz manual de tamaños/dispositivos e idiomas.

**Dependencias:** T15–T31.

**Archivos probables:** paquete UI, estilos/tokens, i18n/adaptador traducción, E2E accesibilidad.

**Tamaño:** M.

### T33. Verificar seguridad, copias y lanzamiento

**Descripción:** Ejecutar las puertas de producción, restaurar copias y realizar un piloto controlado con rollback.

**Criterios de aceptación:**

- [ ] Paneles, alertas y runbooks cubren API, jobs, pagos, base, disco, certificados y copias.
- [ ] PITR y Storage se restauran en un entorno aislado con evidencia.
- [ ] Pruebas E2E, seguridad, RLS, carga mínima y rollback pasan antes de producción.

**Verificación:**

- [ ] Simulacro de incidente, recuperación y despliegue fallido.
- [ ] Checklist de lanzamiento firmado por Valentín.

**Dependencias:** T01–T32.

**Archivos probables:** stack observability, scripts/runbooks backup, pruebas security/load, checklist release.

**Tamaño:** M.

### Checkpoint 10 — Lanzamiento comercial

- [ ] La Definición de Terminado completa está satisfecha.
- [ ] No hay vulnerabilidades críticas/altas aceptadas sin mitigación explícita.
- [ ] Monitoreo externo, copias y responsables de incidentes están activos.
- [ ] Valentín autoriza el despliegue comercial.
