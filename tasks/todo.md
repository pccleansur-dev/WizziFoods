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
- [ ] CI pasa y el equipo aprueba comenzar dominio y seguridad.

## Fase 1 — Seguridad y aislamiento

### T04. Crear un tenant aislado con ubicación inicial

**Descripción:** Entregar el primer corte multitenant completo, incluyendo esquema mínimo, API y prueba negativa de aislamiento.

**Criterios de aceptación:**

- [ ] Cada tenant tiene una ubicación inicial aunque la UI limite a una sola.
- [ ] Toda fila de dominio del corte lleva contexto tenant y RLS aplicable.
- [ ] Una identidad del tenant A no puede leer ni modificar datos del B.

**Verificación:**

- [ ] Migración desde base vacía y rollback ensayado en entorno descartable.
- [ ] Pruebas pgTAP positivas y negativas de RLS.

**Dependencias:** T02, T03.

**Archivos probables:** `supabase/migrations/*`, `packages/database/*`, `supabase/tests/tenancy.sql`, módulo tenant API.

**Tamaño:** M.

### T05. Autenticar Superadmin y Administrador

**Descripción:** Implementar identidades reforzadas y separación de alcance para quienes administran plataforma o negocio.

**Criterios de aceptación:**

- [ ] Superadmin y Administrador ingresan con credenciales reforzadas y MFA.
- [ ] Un Administrador sólo obtiene el tenant asignado; Superadmin no entra silenciosamente a su operación.
- [ ] Recuperación y revocación de sesiones quedan auditadas.

**Verificación:**

- [ ] Pruebas de login, MFA, expiración, revocación y acceso cruzado denegado.
- [ ] Recorrido manual en navegador para ambos perfiles.

**Dependencias:** T04.

**Archivos probables:** módulos auth de API/web, contratos de sesión, pruebas de integración.

**Tamaño:** M.

### T06. Autenticar personal con usuario y PIN

**Descripción:** Crear cuentas individuales de Encargado, Mozo, Cocina y Barra con controles específicos para PIN.

**Criterios de aceptación:**

- [ ] El PIN de seis dígitos se almacena con hash y nunca se devuelve o registra.
- [ ] Intentos limitados, bloqueo temporal, vencimiento y revalidación sensible funcionan.
- [ ] Cada rol recibe solamente las capacidades fijas documentadas.

**Verificación:**

- [ ] Pruebas unitarias de bloqueo y matriz de permisos.
- [ ] Pruebas de integración de login, expiración y auditoría individual.

**Dependencias:** T04, T05.

**Archivos probables:** módulo staff-auth, políticas de permisos, pantalla de acceso, pruebas.

**Tamaño:** M.

### Checkpoint 1

- [ ] RLS negativa, sesiones y roles pasan en CI.
- [ ] Revisión de seguridad antes de almacenar información real.

## Fase 2 — Administración de la plataforma

### T07. Aprovisionar y entregar un negocio

**Descripción:** Permitir que Valentín cree un tenant, su ubicación y el primer Administrador sin completar la operación del restaurante.

**Criterios de aceptación:**

- [ ] Superadmin crea un negocio en estado borrador y genera una invitación de administrador de un solo uso.
- [ ] La activación es idempotente y no duplica tenant ni ubicación.
- [ ] El administrador completa su acceso sin recibir secretos por pantalla o logs.

**Verificación:**

- [ ] Recorrido E2E creación → invitación → activación → acceso.
- [ ] Reintentar cada paso y comprobar idempotencia.

**Dependencias:** T05.

**Archivos probables:** módulo provisioning, vista Superadmin, contratos y E2E.

**Tamaño:** M.

### T08. Resolver tenant por dominio y proteger el contexto

**Descripción:** Resolver subdominio/dominio público y convertir el tenant en requisito estructural de API, jobs y canales.

**Criterios de aceptación:**

- [ ] Un host conocido resuelve exactamente un tenant activo y uno desconocido falla de forma segura.
- [ ] No se acepta `tenant_id` del cliente como autoridad para escrituras autenticadas.
- [ ] Jobs, Storage y Realtime incluyen y validan el mismo contexto.

**Verificación:**

- [ ] Pruebas de host, spoofing de cabeceras y canales cruzados.
- [ ] Smoke test con dos subdominios locales.

**Dependencias:** T04, T07.

**Archivos probables:** middleware tenant, tabla domains, utilidades de jobs/realtime, pruebas.

**Tamaño:** M.

### T09. Implementar auditoría, soporte y suspensión

**Descripción:** Registrar acciones sensibles y controlar asistencia temporal o suspensión sin cortar mesas activas por motivos comerciales.

**Criterios de aceptación:**

- [ ] Soporte requiere autorización temporal, visible y revocable del Administrador.
- [ ] Acciones sensibles registran actor, tenant, motivo, tiempo y correlación.
- [ ] Suspensión comercial bloquea nuevas sesiones después de cerrar las activas; seguridad puede bloquear inmediatamente.

**Verificación:**

- [ ] Pruebas de autorización/revocación y políticas de suspensión.
- [ ] Inspección manual del historial sin secretos ni datos de pago completos.

**Dependencias:** T06, T08.

**Archivos probables:** módulo audit, módulo support-access, políticas suspension, vistas Superadmin.

**Tamaño:** M.

### Checkpoint 2

- [ ] Se pueden crear dos negocios y demostrar aislamiento de extremo a extremo.
- [ ] Valentín aprueba la entrega inicial y el modelo de soporte.

## Fase 3 — Alta: identidad y carta

### T10. Guardar perfil, imágenes y propuesta visual

**Descripción:** Entregar el primer tramo guardable del asistente con identidad básica, medios y una configuración visual editable.

**Criterios de aceptación:**

- [ ] El Administrador guarda datos, logo, portada, colores y referencias desde móvil o escritorio.
- [ ] Storage aplica rutas y permisos por tenant, límites, compresión y metadatos.
- [ ] La vista previa nunca modifica la versión publicada.

**Verificación:**

- [ ] Pruebas de archivos inválidos, cuota y acceso cruzado.
- [ ] Recorrido responsive guardar → salir → continuar.

**Dependencias:** T08.

**Archivos probables:** módulo business-profile, adaptador storage, paso UI identidad, pruebas.

**Tamaño:** M.

### T11. Administrar carta, sectores y publicación versionada

**Descripción:** Construir categorías, productos y sectores con borrador publicable, manteniendo disponibilidad como cambio inmediato separado.

**Criterios de aceptación:**

- [ ] Producto asigna sector, precio, variantes, imagen y contenido por idioma.
- [ ] Precio, texto y estructura quedan en borrador hasta una publicación atómica.
- [ ] Disponibilidad cambia inmediatamente sin publicar el resto del borrador.

**Verificación:**

- [ ] Pruebas de versionado, publicación atómica y toggle concurrente.
- [ ] Recorrido E2E que compare borrador, vista previa y carta publicada.

**Dependencias:** T10.

**Archivos probables:** módulos catalog/publication, migración del corte, editor de carta, pruebas.

**Tamaño:** M.

### T12. Importar carta a un borrador revisable

**Descripción:** Aceptar carga manual, CSV/XLSX, PDF o fotos mediante una cola y normalizar resultados sin publicar automáticamente.

**Criterios de aceptación:**

- [ ] Todo resultado importado es borrador con confianza, errores y campos dudosos visibles.
- [ ] El Administrador aprueba, corrige o descarta antes de incorporar a la carta.
- [ ] Fallo o ausencia de OCR no bloquea la carga manual.

**Verificación:**

- [ ] Fixtures de archivos válidos, maliciosos, incompletos y duplicados.
- [ ] Prueba del worker con reintento e idempotencia.

**Dependencias:** T11.

**Archivos probables:** adaptador import/OCR, worker job, revisión UI, pruebas.

**Tamaño:** M.

### Checkpoint 3

- [ ] Un Administrador puede crear y publicar una carta mínima aislada.
- [ ] Se aprueba la diferencia visual entre borrador, publicado y disponibilidad inmediata.

## Fase 4 — Alta: operación y publicación

### T13. Diseñar plano, mesas, agrupaciones y QR

**Descripción:** Entregar el editor visual con mesas físicas persistentes y QR estables.

**Criterios de aceptación:**

- [ ] Se crean sectores, mesas, formas, sillas, posición y numeración sin perder identidad al moverlas.
- [ ] Agrupar no reemplaza los IDs ni QR de las mesas físicas.
- [ ] Guardar genera QR descargables y verificables por tenant.

**Verificación:**

- [ ] Pruebas de geometría serializada, unicidad QR y agrupación/separación.
- [ ] Recorrido manual responsive, con recomendación no bloqueante de pantalla amplia.

**Dependencias:** T08, T11.

**Archivos probables:** módulo floor-plan, editor UI, generador QR, pruebas.

**Tamaño:** M.

### T14. Configurar equipo y medios de pago

**Descripción:** Completar los pasos de cuentas individuales y medios de pago sin exponer credenciales.

**Criterios de aceptación:**

- [ ] Administrador crea, desactiva y asigna roles/sectores a empleados.
- [ ] Efectivo inicia habilitado y sólo puede desactivarse si existe otro medio.
- [ ] Credenciales externas se almacenan cifradas/referenciadas y nunca vuelven al navegador.

**Verificación:**

- [ ] Pruebas de reglas de medios, permisos y desactivación de usuario activo.
- [ ] Revisión manual de red y logs para comprobar ausencia de secretos.

**Dependencias:** T06, T11.

**Archivos probables:** módulo team, módulo payment-settings, pasos UI, pruebas.

**Tamaño:** M.

### T15. Validar, probar y publicar el negocio

**Descripción:** Crear la lista autoritativa de requisitos, una simulación aislada y la publicación autónoma por Administrador.

**Criterios de aceptación:**

- [ ] El sistema explica cada requisito faltante sin impedir guardar avances.
- [ ] Modo prueba recorre QR, pedido, producción, pago, cierre y limpieza sin contaminar métricas reales.
- [ ] Sólo Administrador publica y la operación no requiere aprobación de Valentín.

**Verificación:**

- [ ] Matriz automática de requisitos mínimos.
- [ ] E2E de prueba y publicación, verificando aislamiento de datos simulados.

**Dependencias:** T10–T14.

**Archivos probables:** módulo readiness, módulo sandbox-mode, revisión/publicación UI, E2E.

**Tamaño:** M.

### Checkpoint 4

- [ ] Alta completa de un negocio ficticio desde cero.
- [ ] Valentín aprueba el asistente antes de iniciar operación real.

## Fase 5 — Experiencia del comensal

### T16. Entrar por QR respetando el estado de mesa

**Descripción:** Resolver QR, tenant, mesa física y sesión vigente sin permitir pedidos automáticos en mesas no habilitadas.

**Criterios de aceptación:**

- [ ] Disponible permite iniciar flujo; ocupada se une a la sesión correcta.
- [ ] Pendiente de limpieza o fuera de servicio permite ver carta y llamar al mozo, no confirmar automáticamente.
- [ ] QR inválido, tenant suspendido o agrupación cambiada tienen salida segura y comprensible.

**Verificación:**

- [ ] Pruebas de todos los estados y QR de mesas agrupadas.
- [ ] E2E móvil desde escaneo simulado.

**Dependencias:** T13, T15.

**Archivos probables:** resolver QR API, entrada pública UI, estado de mesa, pruebas.

**Tamaño:** M.

### T17. Navegar carta y mantener un borrador privado

**Descripción:** Implementar Carta, detalle y “Mi pedido” privado por dispositivo sin reservar stock.

**Criterios de aceptación:**

- [ ] El borrador no es visible para otros dispositivos de la mesa.
- [ ] Variantes, cantidades e importe se recalculan con reglas del servidor.
- [ ] Un producto desactivado queda marcado y bloquea confirmación hasta corregirlo.

**Verificación:**

- [ ] Pruebas con dos dispositivos en una sesión.
- [ ] E2E de edición y desactivación concurrente.

**Dependencias:** T11, T16.

**Archivos probables:** módulo drafts, carta UI, bandeja UI, pruebas.

**Tamaño:** M.

### T18. Confirmar pedido o solicitar atención presencial

**Descripción:** Convertir el borrador en intención validada, con identificación opcional y caminos online/presencial.

**Criterios de aceptación:**

- [ ] Nombre y silla se solicitan cuando se atribuye/paga consumo individual; silla sigue opcional en el caso general.
- [ ] Pago online pendiente no confirma ni envía a producción.
- [ ] Medio presencial crea un llamado con productos y motivo para validación del mozo.

**Verificación:**

- [ ] Pruebas de transición y confirmación atómica de disponibilidad/stock.
- [ ] E2E para cuenta general, consumo propio y llamado presencial.

**Dependencias:** T17.

**Archivos probables:** módulo order-intent, confirmación UI, módulo calls, pruebas.

**Tamaño:** M.

### Checkpoint 5

- [ ] Cliente invitado completa el recorrido hasta pedido pendiente de validación.
- [ ] Se revisa el prototipo ejecutable en teléfono real.

## Fase 6 — Operación y producción

### T19. Operar salón, llamados y pedidos manuales

**Descripción:** Dar al Mozo una vista viva del salón y capacidad de validar o cargar una comanda.

**Criterios de aceptación:**

- [ ] Salón muestra mesa, sesión, llamado, saldo y estado sin cruzar tenant.
- [ ] Mozo valida una intención o carga un pedido manual atribuido a persona/mesa.
- [ ] Confirmar y cobrar ahora o dejar cuenta abierta son decisiones separadas.

**Verificación:**

- [ ] Pruebas de permisos y transiciones de llamado.
- [ ] E2E cliente → llamado → mozo → pedido confirmado.

**Dependencias:** T18.

**Archivos probables:** módulo waiter, salón UI, comanda UI, pruebas.

**Tamaño:** M.

### T20. Producir por sector y estado de ítem

**Descripción:** Distribuir cada ítem confirmado al KDS correspondiente y derivar el estado general.

**Criterios de aceptación:**

- [ ] Cocina/Barra sólo ven sectores asignados y nunca pedidos sin confirmar.
- [ ] Ítems avanzan En cola → En preparación → Listo; orden deriva su estado.
- [ ] Reintentos o reconexiones no duplican comandas.

**Verificación:**

- [ ] Pruebas de enrutamiento, permisos e idempotencia.
- [ ] E2E pedido con ítems de dos sectores.

**Dependencias:** T19.

**Archivos probables:** módulo production, KDS UI, eventos/worker, pruebas.

**Tamaño:** M.

### T21. Resolver entrega, faltantes y cancelaciones

**Descripción:** Completar excepciones auditadas sin reescribir pedidos confirmados.

**Criterios de aceptación:**

- [ ] Mozo marca Entregado; producción registra Excepción sin borrar consumos.
- [ ] Cancelar en preparación exige Encargado/Administrador y motivo.
- [ ] Reemplazo genera aceptación y diferencia económica vinculada.

**Verificación:**

- [ ] Matriz de permisos/estados y pruebas del historial inmutable.
- [ ] E2E de faltante → reemplazo y faltante → cancelación.

**Dependencias:** T20.

**Archivos probables:** módulo order-adjustments, vistas waiter/KDS, auditoría, pruebas.

**Tamaño:** M.

### Checkpoint 6

- [ ] Pedido atraviesa cliente, mozo, cocina/barra y entrega por ítem.
- [ ] Excepciones conservan historia y pasan revisión operativa.

## Fase 7 — Cuenta y pagos

### T22. Mantener una cuenta append-only

**Descripción:** Implementar cargos, descuentos, pagos, propinas, ajustes y devoluciones como movimientos inmutables.

**Criterios de aceptación:**

- [ ] Consumido, pagado y pendiente se derivan del libro mayor, no de campos reescribibles.
- [ ] Cada movimiento referencia actor, origen, moneda, tenant y causa.
- [ ] Recalcular desde cero produce el mismo saldo.

**Verificación:**

- [ ] Pruebas property-based de invariantes y redondeo monetario.
- [ ] Integración concurrente contra PostgreSQL.

**Dependencias:** T19, T21.

**Archivos probables:** módulo ledger, migración del corte, contratos, pruebas.

**Tamaño:** M.

### T23. Operar caja y pagos presenciales

**Descripción:** Registrar turnos, arqueo ciego, medios físicos y devoluciones realizadas fuera de la plataforma.

**Criterios de aceptación:**

- [ ] Caja registra apertura, movimientos, responsable y cierre con diferencia justificada.
- [ ] Tarjeta física nunca solicita PAN, vencimiento ni CVV.
- [ ] Devolución presencial queda vinculada al pago/ítem y autorizada según rol.

**Verificación:**

- [ ] Pruebas del arqueo, permisos y caja con pendientes.
- [ ] E2E apertura → cobros mixtos → devolución → cierre.

**Dependencias:** T22.

**Archivos probables:** módulo cash-register, cobro UI, cierre UI, pruebas.

**Tamaño:** M.

### T24. Cobrar con Mercado Pago

**Descripción:** Integrar OAuth por tenant, Checkout Bricks y conciliación autoritativa por webhook/API.

**Criterios de aceptación:**

- [ ] Credenciales y pagos están aislados por tenant.
- [ ] Webhooks se autentican, deduplican y consultan el estado autoritativo.
- [ ] Sólo acreditado confirma el pedido y movimiento; pendiente/fallido no lo hace.

**Verificación:**

- [ ] Pruebas de firma, reordenamiento, duplicado y replay de webhooks.
- [ ] E2E en sandbox de éxito, pendiente, rechazo y devolución parcial.

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

- [ ] Participaciones se calculan sobre saldo vigente y se reclaman atómicamente.
- [ ] Un dispositivo puede pagar varias; consumos posteriores crean saldo nuevo.
- [ ] Dos pagos simultáneos nunca exceden el pendiente.

**Verificación:**

- [ ] Pruebas concurrentes con barreras reales de base de datos.
- [ ] E2E de tres personas, una pagando dos partes y consumo posterior.

**Dependencias:** T22–T24.

**Archivos probables:** módulo allocations, flujo split UI, conciliación, pruebas.

**Tamaño:** M.

### T26. Cerrar, limpiar, habilitar y emitir comprobante

**Descripción:** Completar el ciclo de la sesión sin liberar automáticamente la mesa al pagar.

**Criterios de aceptación:**

- [ ] Saldo cero permite cerrar y mueve a Pendiente de limpieza.
- [ ] Sólo personal autorizado marca limpia y Disponible.
- [ ] Comprobante indica que no es factura y `Avisar a caja` crea una solicitud interna.

**Verificación:**

- [ ] Máquina de estados de mesa con transiciones inválidas rechazadas.
- [ ] E2E pago → cierre → QR bloqueado → limpieza → nueva sesión.

**Dependencias:** T23, T25.

**Archivos probables:** módulo table-state, comprobante/PDF, UI cierre/limpieza, pruebas.

**Tamaño:** M.

### T27. Unir y separar mesas conservando historia

**Descripción:** Aplicar agrupaciones durante el servicio sin redistribuir deuda ni invalidar QR físicos.

**Criterios de aceptación:**

- [ ] Todos los QR reconocen la agrupación vigente.
- [ ] Separar exige mesa ancla para la sesión abierta y libera las restantes según estado.
- [ ] Pedidos, pagos y deuda nunca se mueven automáticamente.

**Verificación:**

- [ ] Pruebas de agrupación concurrente y restricciones.
- [ ] E2E unir → consumir → pagar parcial → separar → nueva sesión.

**Dependencias:** T13, T22, T26.

**Archivos probables:** módulo table-groups, salón UI, sesión/ledger integration, pruebas.

**Tamaño:** M.

### Checkpoint 8 — Piloto operativo

- [ ] Todos los recorridos del Hito A pasan en dispositivos reales.
- [ ] Restauración de copia y rollback se ensayan en staging.
- [ ] Valentín autoriza o rechaza el piloto antes de activar un cliente.

## Fase 9 — Retención

### T28. Registrar clientes con Google y consentimientos

**Descripción:** Agregar cuenta global de comensal separada del personal y perfiles/consentimientos por restaurante.

**Criterios de aceptación:**

- [ ] Login siempre es opcional y conserva `Continuar sin cuenta`.
- [ ] El restaurante no recibe email de Google ni datos de otro tenant.
- [ ] WhatsApp verificado y marketing son consentimientos distintos, revocables y versionados.

**Verificación:**

- [ ] Pruebas de vinculación, revocación, exportación y anonimización lógica.
- [ ] E2E invitado y registrado sin bloqueo de carta.

**Dependencias:** T16, T22.

**Archivos probables:** módulo customer-identity, consentimiento, pantallas login/perfil, pruebas.

**Tamaño:** M.

### T29. Acreditar visitas y administrar premios

**Descripción:** Implementar visitas diarias verificadas, cumpleaños y premios personales con canje atómico.

**Criterios de aceptación:**

- [ ] Máximo una visita diaria por persona/tenant con mínimo configurable y atribución válida.
- [ ] Devolución total revoca visita; cumpleaños cumple antigüedad y límite de cambios.
- [ ] Reserva, pago y canje son atómicos; un pago fallido libera el premio.

**Verificación:**

- [ ] Pruebas de zona horaria, mesa grupal, fraude básico y concurrencia.
- [ ] E2E completar objetivo y usar premio en la misma compra.

**Dependencias:** T25, T28.

**Archivos probables:** módulo loyalty, reglas/reloj, UI perfil/premios, pruebas.

**Tamaño:** M.

### T30. Conectar WhatsApp y automatizaciones básicas

**Descripción:** Vincular la cuenta de Meta de cada restaurante y enviar avisos aprobados respetando consentimiento y frecuencia.

**Criterios de aceptación:**

- [ ] Número, plantillas, costos y tokens están aislados por tenant.
- [ ] Automatizaciones permanentes requieren aprobación inicial; eventos puntuales requieren confirmación.
- [ ] Horarios, topes, opt-out e inactividad bloquean mensajes cuando corresponde.

**Verificación:**

- [ ] Pruebas con proveedor simulado para límites, reintentos y baja.
- [ ] Integración sandbox con webhook y plantilla aprobada.

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
