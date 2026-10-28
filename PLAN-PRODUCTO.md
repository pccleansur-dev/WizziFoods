# Plan de producto: carta y mozo digital para restaurantes

Estado: planificación activa, actualizado el 20 de octubre de 2026. Este documento reúne decisiones de producto y arquitectura; no describe software ya implementado. Google Stitch es solamente la herramienta usada para prototipar pantallas. El nombre comercial definido para el producto es `Wizzi Foods`.

## Objetivo comercial

Valentín ofrecerá el servicio puerta a puerta a restaurantes que no tengan un sistema de pedidos contratado. La oferta es una carta y mozo digital preparados para cada negocio, con identidad visual propia y configuración operativa adaptada. Valentín presenta una demo, crea el espacio inicial del negocio y entrega la cuenta administradora. A partir de ahí, cada negocio configura, publica y mantiene su propia operación sin requerir aprobación de Valentín.

La lógica de pedidos será común, con presentación visual personalizable por negocio. No alcanza con cambiar logo y dos colores: se propone disponer de variantes de composición, tipografía y uso de imágenes. El dueño puede proporcionar material; Valentín también puede sacar fotos y recopilar referencias. Las imágenes pueden ayudar a proponer colores; el logo original es preferible cuando exista. La extracción automática y el tratamiento de imágenes son propuestas, no funciones ya implementadas o cerradas.

## Modalidades comerciales confirmadas

La oferta principal será `Plan Nube`, una suscripción mensual accesible. Valentín aloja la plataforma en su infraestructura y la mensualidad incluye derecho de uso, operación del servicio, actualizaciones, copias de seguridad, monitoreo y el nivel de soporte contratado. La suspensión por falta de pago deberá contemplar un período de gracia y un plazo de conservación o exportación de datos que se definirá junto con las condiciones comerciales.

La suspensión comercial será gradual: se notifica durante el período de gracia y nunca interrumpe una mesa que ya está operando. Al vencer, se impiden nuevas sesiones o pedidos una vez cerradas las mesas activas y el administrador conserva acceso limitado para regularizar, exportar información o solicitar soporte. Una suspensión de seguridad puede ser inmediata ante compromiso de cuenta, fraude o riesgo grave; bloquea operaciones sensibles sin eliminar datos ni auditoría.

También se ofrecerá una `Edición Local` para clientes que requieran ejecutar la plataforma en infraestructura propia. No será otro producto ni otro código fuente: utilizará el mismo monorepo y las mismas imágenes de contenedores, configuradas como una instalación de un solo negocio. Un instalador para Windows y su Centro de Control asistirán con instalación, activación, inicio de servicios, acceso al panel, estado y versión, red, almacenamiento, copias, restauración, diagnóstico y actualizaciones.

La Edición Local se comercializará mediante una licencia inicial de mayor valor que habilita de forma perpetua la última versión adquirida e incluye doce meses de mantenimiento, actualizaciones y soporte. La renovación anual extiende esos derechos. Si el cliente no renueva, la versión ya autorizada continúa funcionando, pero no recibe nuevas funciones, versiones, soporte ni garantía de compatibilidad futura con integraciones externas. Por esa razón no se describirá como una licencia anual revocable, sino como `licencia perpetua de versión con mantenimiento anual`.

La entrega local comprende instalador, binarios e imágenes de contenedores firmadas; no incluye el código fuente ni autoriza su redistribución. Una venta o cesión del código fuente requeriría un contrato extraordinario independiente. La licencia se asigna a una organización e instalación y debe poder trasladarse de forma controlada cuando el cliente reemplace o pierda el equipo, sin quedar atada de manera irreversible a un único hardware.

En la Edición Local, el cliente controla y asume la operación de su servidor, sistema operativo, red, acceso físico, capacidad, seguridad y copias externas. La plataforma proveerá herramientas de diagnóstico y respaldo, pero el soporte remoto será opcional, temporal, auditable y expresamente autorizado. Mercado Pago, Google, WhatsApp, ARCA y cualquier acceso público desde fuera de la red local seguirán dependiendo de Internet y de la vigencia de sus servicios externos.

El primer lanzamiento incluirá únicamente el Plan Nube. La Edición Local y su instalador se construirán en una segunda etapa, después de estabilizar el núcleo operativo. Desde el inicio se preservarán los límites, la configuración y el empaquetado necesarios para que esa evolución no obligue a crear una segunda base de código.

## Dos flujos de trabajo

### Implementación de cada negocio

Desde el OK del dueño o encargado: Valentín crea el tenant y su primer administrador; el administrador del negocio completa un asistente de alta; revisa el contenido extraído de imágenes; elige y ajusta una propuesta visual; configura carta, operación, mesas, sectores, pagos y equipo; previsualiza; publica; coloca los QR y prueba el circuito con el personal.

Identidad, carta y configuración operativa pueden avanzar en paralelo. Una identidad visual elegida no equivale a estar listo para operar. El asistente permite guardar y continuar después, muestra los faltantes y bloquea solamente la publicación mientras no se cumplan los requisitos mínimos.

### Uso del servicio

Experiencias diferenciadas para cliente, mozo, encargado y cocina/barra. La experiencia cliente comienza directamente en una carta digital familiar, sin chat inicial obligatorio ni registro. La aplicación debe agilizar atención y pedidos sin desorientar al comensal.

## Decisiones funcionales confirmadas

- Carta completa con fotos, nombres, descripciones, precios, cantidades y carrito.
- Nombre de quien pide. Un celular puede pedir para una persona o toda la mesa; no imponer modalidad ni dispositivo por persona.
- Interfaz base curada en español e inglés. Las traducciones automáticas de la carta se generan mediante un proveedor intercambiable, siempre como borrador; requieren aprobación del administrador y tienen fallback al idioma original. Precios, fotografías y disponibilidad son compartidos entre idiomas.
- Cada mesa física conserva su QR fijo, esté separada o unida a otras.
- Administrador o encargado configura mesas y disposición de sillas antes de abrir y puede actualizar durante el servicio. Unir mesas desde el panel es esencial desde la primera versión.
- Los QR originales reconocen la agrupación vigente, conservando la identidad de las mesas físicas.
- El nombre identifica siempre a quien pide. La silla es opcional en el flujo general, pero se solicita junto con el nombre cuando el comensal quiere identificar y pagar exclusivamente su consumo. Un teléfono puede pedir para una persona o para toda la mesa.
- Pago online con Mercado Pago: solo el pago acreditado confirma el pedido y habilita el envío a producción. Pendiente o fallido no confirma.
- Sin pago acreditado ni validación del mozo, el carrito no reserva productos y no llega a cocina/barra.
- Al elegir pago presencial por efectivo, crédito, débito u otro medio habilitado, se genera un llamado en la vista de mesas del personal.
- El mozo consulta el motivo, productos y medio elegido, se acerca a la mesa y valida con los comensales. Luego confirma desde el panel, enviando los productos al sector correspondiente.
- El mozo también puede cargar y validar un pedido directamente, sin pago previo.
- Puede confirmar y cobrar después dejando cuenta abierta, o confirmar y cobrar en ese momento. Cada pedido adicional repite su circuito de validación.
- Confirmación y pago son estados separados. Un pedido confirmado por el mozo puede estar impago. Conservar consumos pagados y saldo pendiente sin cobrar dos veces.
- Los pedidos y pagos históricos conservan su asociación cuando las mesas se separan o reciben nuevos clientes. Al separar una agrupación con cuenta abierta se elige una mesa ancla que conserva la sesión; las mesas liberadas pueden iniciar otra sesión y la deuda nunca se redistribuye automáticamente.
- La sesión de mesa comienza con el primer pedido confirmado. El cierre de cuenta no libera la mesa: la mueve a `Pendiente de limpieza`. El mozo la habilita manualmente después de limpiarla. Los estados previstos son `Disponible`, `Ocupada`, `Pendiente de limpieza` y `Fuera de servicio`.
- Si se escanea el QR de una mesa no habilitada, se permite consultar la carta pero no enviar pedidos automáticamente. Se ofrece llamar a un mozo, quien puede habilitarla o cargar el pedido manualmente.
- Los pedidos confirmados son inmutables. Correcciones, faltantes, cancelaciones, descuentos, devoluciones y ajustes se registran como movimientos vinculados y auditables; no se borran ni se reescriben consumos históricos.
- Producción trabaja por ítem con los estados `En cola`, `En preparación`, `Listo`, `Entregado`, `Excepción` y `Cancelado`. Cocina o barra marcan `Listo`; el mozo marca `Entregado`. El estado general de la orden se deriva de sus ítems.
- La cuenta usa un libro mayor append-only de cargos, descuentos, pagos, propinas, devoluciones y ajustes. Admite pago total, monto personalizado, medios mixtos, varios pagadores, división en partes iguales y devoluciones parciales o totales. Antes de cobrar se revalida el saldo para evitar pagos simultáneos duplicados.
- Antes de confirmar, el cliente modifica libremente su selección. Después sólo puede solicitar cambios. El mozo puede cancelar un ítem en cola con motivo; si ya está en preparación se requiere aprobación de encargado o administrador. Cocina y barra registran excepciones, no eliminan consumos.
- Una cancelación impaga reduce el saldo mediante un ajuste. Si el producto ya estaba pagado, se crea una devolución parcial vinculada al ítem, cantidad, motivo, autorización y pago original; no se revierte toda la mesa. Mercado Pago intenta devolver al medio original y los medios presenciales se registran después de realizar la devolución fuera de la plataforma. La propina sólo se devuelve mediante acción explícita.
- Si un producto confirmado resulta no disponible, pasa a `Excepción`, alerta al mozo y se ofrece reemplazo o cancelación. Diferencias de precio generan un nuevo cargo, reducción de saldo o devolución, siempre con aceptación del cliente.
- Si un producto se desactiva mientras permanece en un borrador privado, se conserva marcado como `Ya no disponible` y bloquea la confirmación hasta quitarlo o reemplazarlo.
- La disponibilidad funciona con interruptor y puede complementarse con stock operativo opcional por producto y turno. Los borradores no reservan unidades; la confirmación descuenta de forma atómica y cero unidades desactiva el producto. No es inventario contable de ingredientes.

## Sesión de mesa y experiencia del comensal

Mientras la mesa permanezca abierta, el cliente puede alternar entre `Carta`, `Mi pedido` y `Mesa / Cuenta`. La sesión compartida muestra consumos confirmados, pedidos y estados, total consumido, total pagado, saldo pendiente y pagos realizados.

Cada dispositivo mantiene un borrador privado, presentado visualmente como una mesa o bandeja con contador e importe. Los demás comensales no ven ni pueden alterar productos todavía no confirmados. Al confirmar, el pedido pasa al historial compartido de la mesa. El comensal puede cargarlo a la cuenta general o pagar únicamente su selección, identificándola con nombre y, cuando corresponda, silla.

La división en partes iguales crea participaciones sobre el saldo vigente. Cada pagador reclama una participación de forma atómica; un dispositivo puede pagar varias. Los consumos agregados después de pagar participaciones generan saldo adicional y no modifican retroactivamente los pagos ya realizados.

## Personalización y separación por negocio

Para el Plan Nube se confirma una única plataforma multitenant, desplegada en infraestructura administrada por Valentín. Cada negocio accede mediante una URL de la plataforma o un dominio propio vinculado. Dentro de esta modalidad, los dominios son puertas de entrada a la misma plataforma y no instalaciones independientes. La Edición Local reutiliza el mismo producto, pero se despliega como una instalación de un solo negocio en infraestructura del cliente.

Cada negocio comienza con un subdominio provisional de la plataforma. El dominio propio se conecta posteriormente desde configuración y nunca bloquea la creación del tenant, el asistente ni la primera publicación.

En la primera versión, un tenant representa un único negocio o local completamente separado. A futuro podrá incorporarse una entidad empresa o grupo que reúna varias sucursales sin mezclar sus cartas, mesas, pedidos ni pagos. Esta agrupación futura no formará parte de la interfaz inicial.

Cada tenant tendrá nombre, logo, portada, colores, tipografías legibles, estilo de carta y previsualización antes de publicar. También tendrá catálogo, precios, mesas, usuarios, pedidos, pagos y configuración de Mercado Pago propios. Ningún usuario, QR, consulta o acción puede operar fuera del tenant al que pertenece.

La interfaz se divide visualmente en tres capas: la experiencia del comensal adopta la identidad completa del restaurante; el panel operativo mantiene una estructura estable de la plataforma con detalles de la marca del negocio; y la superadministración utiliza una identidad neutral de la plataforma. Cambiar la marca de un restaurante nunca altera controles críticos, estados o convenciones operativas.

Valentín es superadministrador de la plataforma. Puede crear, activar, suspender y dar soporte a negocios, además de asignar o recuperar su primer administrador, pero no participa en su operación cotidiana ni aprueba sus publicaciones. El administrador de cada negocio controla solamente su tenant y puede crear, editar y desactivar cuentas individuales para su equipo.

El soporte nunca habilita una entrada silenciosa al tenant. El administrador del negocio autoriza una sesión temporal y revocable, ve que está activa y todas las acciones quedan auditadas. El soporte no revela contraseñas, PIN, tokens ni información completa de pago.

Los roles de la primera versión serán fijos:

- Administrador del negocio: control total dentro del tenant, incluida identidad, carta, salón, pagos y equipo.
- Encargado: operación diaria, carta, disponibilidad y salón, sin control sobre la propiedad del tenant o su dominio.
- Mozo: mesas, llamados, pedidos, validaciones y cobros permitidos.
- Cocina: cola de producción y estados de los productos asignados a cocina.
- Barra: cola de producción y estados de los productos asignados a barra.

No habrá editor de roles ni permisos personalizados en la primera versión. Existe una sola base de producto: las mejoras llegan automáticamente al Plan Nube y quedan disponibles para instalaciones locales con mantenimiento vigente, sin mantener bifurcaciones personalizadas por cliente.

El acceso del personal operativo será interno y sin OAuth: cada Mozo, Cocina y Barra tiene usuario individual y PIN de seis dígitos. El Encargado utiliza usuario y PIN con revalidación para acciones sensibles. Los PIN nunca se muestran ni almacenan en claro, tienen intentos limitados, bloqueo temporal, sesiones con vencimiento y auditoría por persona. Administrador y Superadministrador usan credenciales reforzadas y segundo factor debido a sus permisos sobre usuarios, configuración y dinero.

## Clientes, identidad y fidelización

La carta, los pedidos y los pagos pueden utilizarse como invitado. El registro se incentiva, pero no es obligatorio para consumir. La cuenta registrada utiliza Google exclusivamente para autenticación con los alcances mínimos de identidad; el correo obtenido no se entrega a los restaurantes ni se utiliza para campañas sin un consentimiento adicional.

Las identidades de comensales y personal son ámbitos separados. Una cuenta de cliente autenticada con Google nunca recibe permisos laborales automáticamente, aunque comparta correo o nombre con un empleado. El ingreso se sugiere mediante una tarjeta discreta al entrar y nuevamente después de una compra; nunca se bloquea la carta con un modal y siempre permanece disponible `Continuar sin cuenta`.

Para acceder al programa de fidelización, el cliente debe iniciar sesión, confirmar su nombre y registrar y verificar un número de WhatsApp. La identidad de autenticación pertenece a la plataforma, pero cada restaurante mantiene un perfil comercial aislado. Un negocio sólo puede consultar nombre, WhatsApp, visitas, premios, última visita y consentimientos asociados a su propio tenant; nunca datos de otros locales.

El consentimiento para promociones es explícito, separado del registro y desmarcado inicialmente. Verificar el número no equivale a aceptar marketing. Rechazar o retirar el consentimiento no elimina la cuenta, el historial, las visitas ni los premios; solamente impide nuevos mensajes promocionales. Debe registrarse negocio, finalidad, versión del texto, fecha, origen y revocación, además de ofrecer corrección, exportación y eliminación de datos.

La primera versión del programa utiliza visitas verificadas y beneficios de cumpleaños; los puntos por importe gastado quedan para una etapa posterior. Una visita cuenta sólo con una compra confirmada y pagada, como máximo una vez por día calendario y usando la zona horaria del local. Una devolución total revoca la visita correspondiente.

El administrador define objetivos y premios, por ejemplo un beneficio en la séptima compra. Los premios pueden ser un producto, un importe fijo, un porcentaje o un beneficio personalizado, con estados `Disponible`, `Reservado`, `Utilizado`, `Vencido` y `Revocado`. El canje es atómico. Para cumpleaños se solicita opcionalmente sólo día y mes, con reglas contra abuso y una ventana configurable.

Los premios son personales y no transferibles. Sólo puede activarlos el titular autenticado, aunque el beneficio pueda aplicarse a un producto compartido o al total elegible de la sesión. Se permite un premio de fidelización por persona y cuenta; dos premios no se combinan. El restaurante decide si el premio puede coexistir con una promoción general. El vencimiento es configurable y tiene 30 días como valor predeterminado, con fecha visible y recordatorio opcional.

Cada programa puede exigir un importe mínimo por visita, calculado sobre lo efectivamente pagado después de descuentos y devoluciones y sin incluir propina. En una mesa grupal, cada usuario registrado suma una visita si está unido a la sesión, tiene consumos atribuidos que alcanzan ese mínimo y la cuenta correspondiente queda pagada; no importa quién efectúe el pago. Los pedidos sin asignación personal acreditan la visita sólo al usuario que los realizó. Nunca se acredita más de una visita diaria por persona y restaurante.

El premio que completa un objetivo puede utilizarse en esa misma compra. Al iniciar el pago se reserva provisionalmente y visita, canje y pago se confirman de forma atómica; un pago fallido libera la reserva. El beneficio de cumpleaños requiere una visita válida anterior, fecha registrada antes de su ventana y limita cambios de día y mes a uno por año, salvo corrección administrativa auditada.

La plataforma segmenta automáticamente perfiles por eventos como primera compra, cercanía al objetivo, premio disponible, cumpleaños, frecuencia o inactividad. El restaurante define o aprueba el contenido: las automatizaciones permanentes se aprueban una vez y luego se ejecutan solas; promociones, shows o eventos puntuales requieren carga y confirmación del administrador.

Cada restaurante puede enviar como máximo dos mensajes promocionales por semana y ocho por mes a una misma persona durante la primera versión. Las campañas se entregan entre las 10:00 y las 20:00 de la zona horaria local; los avisos solicitados sobre operaciones activas pueden enviarse inmediatamente. Los mensajes operativos no consumen el cupo promocional.

Cada restaurante conectará su propia cuenta y número de WhatsApp Business mediante la integración de la plataforma con Meta. Número, marca, plantillas, consentimientos y costos se aíslan por tenant. El módulo es activable por negocio y su falta de configuración no bloquea pedidos ni operación. En una primera etapa se priorizan avisos de fidelización; un constructor completo de campañas masivas queda para una evolución posterior.

El perfil de fidelización de un restaurante se conserva 24 meses desde su última visita o interacción. Tras 12 meses sin actividad se detienen mensajes promocionales hasta renovar el consentimiento. A los 23 meses se avisa el vencimiento; al cumplir 24 se anonimizan WhatsApp, cumpleaños e historial personal de ese tenant, sin afectar perfiles activos en otros negocios. El usuario puede, por separado, dejar de recibir comunicaciones de un restaurante, abandonar su programa de fidelización o eliminar su cuenta global. La eliminación anonimiza datos personales y cancela premios sin romper registros operativos o contables que deban conservarse.

## Caja, propinas y comprobantes

La primera versión incluye caja operativa, no contabilidad ni facturación fiscal. Cada negocio comienza con una `Caja principal`, pero el modelo admite varias cajas. Cada turno pertenece a una caja y registra apertura, fondo inicial, cobros por medio, ingresos, retiros, ajustes, empleado y horario. Una caja no puede cerrarse con operaciones pendientes sin resolver.

El cierre utiliza arqueo ciego: el responsable declara primero el efectivo contado y recién después ve efectivo esperado, diferencia y necesidad de justificación. El encargado o administrador confirma el cierre; las correcciones posteriores son nuevos movimientos auditables.

Los pagos con tarjeta física se procesan fuera de la plataforma. Sólo se registran importe, débito o crédito, terminal, referencia opcional, empleado, caja y estado. Nunca se solicitan o almacenan PAN completo, vencimiento, código de seguridad o datos de banda. Las devoluciones se ejecutan en la terminal y luego se registran como movimiento vinculado.

La propina se acredita en la cuenta del restaurante y se registra separadamente. Cada tenant elige asignarla al mozo responsable o a un fondo común por turno; la plataforma informa la liquidación, pero no promete transferencia directa al empleado.

Hasta integrar ARCA se emite un comprobante operativo no fiscal con restaurante, mesa, fecha, consumos, descuentos, propina, medios de pago, devoluciones y saldo. Puede verse en pantalla, descargarse como PDF o enviarse a pedido. Debe indicar `Comprobante de consumo — no válido como factura`.

La interfaz muestra `¿Necesitás factura? Por el momento, la facturación se realiza en caja`. El botón `Avisar a caja` crea una solicitud interna con mesa y comprobante, pero no emite factura ni recopila CUIT, razón social o domicilio fiscal. El cliente completa esos datos directamente en caja.

Los permisos financieros son fijos: el mozo cobra y solicita correcciones; el encargado aprueba cancelaciones en preparación, descuentos y devoluciones parciales; el administrador también realiza devoluciones totales y configura límites. Cocina y barra no modifican dinero. Toda acción sensible exige motivo y auditoría.

## Arquitectura técnica confirmada

- Monorepo con frontend y backend separados internamente y desplegados como contenedores independientes.
- Frontend en Next.js. Backend en NestJS con Fastify y API REST documentada por OpenAPI.
- Supabase autoalojado mediante Docker Compose y administrado desde Coolify en un VPS propio.
- PostgreSQL compartido con `tenant_id` y Row Level Security como defensa en profundidad. Se modela `location` desde el inicio aunque la primera versión limite cada tenant a un local.
- Drizzle se utiliza desde NestJS. Existe un único historial ordenado de migraciones SQL compatible con Supabase; `supabase-js` queda limitado a Auth, Storage y Realtime.
- Todas las escrituras pasan por el backend REST. Supabase Realtime utiliza canales privados con RLS para notificaciones; al reconectar, el cliente vuelve a consultar el estado autoritativo.
- Supabase Storage guarda archivos en un volumen persistente separado, con compresión, límites por negocio y copias externas. La aplicación conserva una abstracción que permita migrar a S3.
- Tareas asíncronas mediante `pgmq` y un worker separado. OCR mediante adaptador de proveedor, salida validada por esquema y borradores aprobables.
- Mercado Pago se vincula por OAuth a la cuenta de cada restaurante. Checkout Bricks, webhooks, consulta autoritativa e idempotencia forman parte del diseño.
- Subdominio de la plataforma por defecto y dominio propio opcional, sobre la misma aplicación multitenant, con DNS wildcard y automatización en Coolify.
- PWA instalable para personal; el cliente por QR no necesita instalar nada. El shell y las lecturas pueden cachearse, pero ninguna escritura crítica se presenta como enviada sin confirmación del servidor.
- Observabilidad autoalojada con Grafana, Prometheus, Loki, Tempo y Grafana Alloy, instrumentada mediante OpenTelemetry y complementada por monitor externo.
- Copias de PostgreSQL con recuperación continua/PITR y copias externas verificadas de base de datos y Storage.
- Estrategia de pruebas basada en riesgo: lint, tipos, build, Vitest, integración con Supabase real, migraciones, pruebas negativas de RLS con pgTAP, contratos OpenAPI, Playwright para recorridos críticos, accesibilidad y seguridad. CI bloquea despliegues en Coolify si fallan controles obligatorios.
- Facturación fiscal ARCA no se promete en la primera versión. Se prepara el modelo y un adaptador para incorporarla posteriormente sin reescribir el núcleo.
- La misma composición de contenedores debe admitir dos perfiles de despliegue: `cloud-multitenant` para el Plan Nube y `local-single-tenant` para la Edición Local. El modo local no constituye una bifurcación del código.
- La Edición Local tendrá un instalador firmado para Windows y un Centro de Control, pero la experiencia de uso seguirá siendo web/PWA para permitir acceso desde caja, cocina, barra, salón y dispositivos móviles de la red.
- Las actualizaciones locales serán paquetes o imágenes firmadas, con control de derecho a versión, migraciones verificadas, copia previa y posibilidad de reversión. El vencimiento del mantenimiento bloquea nuevas versiones, no detiene la última versión autorizada.
- La activación local debe tolerar períodos sin conexión, permitir traslado controlado de instalación y evitar una dependencia diaria del servidor de licencias. Acceso remoto, telemetría y soporte requerirán autorización explícita del cliente.

## Flujo de alta y personalización del negocio

### 1. Creación y entrega inicial

Valentín presenta una demo, acuerda el alta con el cliente, crea el tenant y genera su primer usuario administrador. El negocio todavía no queda publicado. Valentín entrega el acceso al administrador para que complete la configuración mediante el asistente.

### 2. Asistente de configuración

El asistente se divide en pasos guardables y editables:

1. Datos del negocio: nombre, descripción, contacto, dirección, horarios e idiomas.
2. Identidad y material: logo, portada, fotografías, colores conocidos y referencias visuales.
3. Propuesta estética: generación de una versión cercana a la identidad actual y de dos o tres alternativas, por ejemplo visual, compacta o moderna.
4. Carta: categorías, productos, títulos, descripciones, precios, imágenes, variantes y disponibilidad. Puede importarse desde fotos, PDF, carga manual o una plantilla CSV/XLSX.
5. Sectores: se crean Cocina y Barra inicialmente, pero el administrador puede agregar estaciones como Parrilla, Pizzería, Cafetería o Postres. Cada producto se asigna a un sector y el personal puede quedar asociado a uno o varios.
6. Salón: configuración exclusiva mediante plano visual. El administrador crea sectores físicos, agrega o duplica mesas, define forma y sillas, alinea, distribuye y numera; cada mesa obtiene un QR fijo al guardarse. No existe un flujo separado basado únicamente en cantidad de mesas.
7. Pagos: medios presenciales y configuración de Mercado Pago cuando corresponda.
8. Equipo: creación de cuentas individuales y asignación de roles fijos.
9. Vista previa: recorrido de la experiencia cliente antes de exponerla públicamente.
10. Publicación: validación de requisitos mínimos, modo de prueba opcional y activación del negocio. La prueba permite recorrer QR, carta, comanda, producción, pago simulado, cierre y limpieza sin afectar ventas, caja, stock, fidelización ni métricas reales.

Todo lo configurado durante el asistente podrá modificarse posteriormente desde el panel del negocio. El asistente completo será responsive: permite cargar datos y tomar fotografías desde el celular, aunque recomienda tablet o computadora para editar el plano visual y otras tareas de alta complejidad.

### 3. Asistencia mediante imágenes

El administrador puede subir fotografías de una carta existente. El sistema podrá intentar extraer categorías, platos, descripciones y precios, pero siempre los incorporará como borrador. Los datos dudosos o incompletos deben destacarse y todo el contenido extraído requiere revisión y aprobación explícita del administrador antes de incorporarse a la carta publicada.

La identidad visual será híbrida: el administrador puede definir manualmente logo y colores, y también solicitar propuestas basadas en sus imágenes y referencias. El sistema mostrará una opción cercana a la identidad actual y otras alternativas, cada una con vistas móvil y escritorio y validación de contraste. El administrador elige una base, la ajusta y puede cambiarla en el futuro.

### 4. Requisitos mínimos para publicar

El negocio puede guardar avances aunque la configuración esté incompleta. Para publicar deberá tener como mínimo:

- Identidad básica.
- Al menos una categoría con un producto válido.
- Mesas físicas con sus códigos QR definidos.
- Sectores operativos configurados.
- Al menos un medio de pago configurado.

El asistente muestra claramente qué requisitos faltan. Crear empleados no es requisito para publicar. `Efectivo` aparece habilitado inicialmente y sólo puede desactivarse después de configurar otro medio. La decisión de publicar pertenece al administrador del negocio y no requiere revisión de Valentín.

### 5. Cambios posteriores a la publicación

La disponibilidad de cada producto se controla con un interruptor y se refleja inmediatamente en la carta, para evitar ofrecer productos sin stock. Los cambios de identidad, estructura, contenido, descripciones y precios se guardan como borrador y llegan al público cuando el administrador pulsa `Publicar cambios`.

Debe existir una vista previa del borrador y una distinción clara entre la versión publicada y los cambios todavía no publicados.

## Pantallas identificadas

Cliente: entrada por QR y estado de mesa; carta; detalle de producto; borrador privado `Mi pedido`; confirmación y alcance; identificación por nombre y silla opcional; Mercado Pago o solicitud de cobro presencial; seguimiento por producto; `Mesa / Cuenta`; y cuenta registrada con historial, visitas, premios y preferencias. La navegación principal durante una sesión abierta conserva `Carta`, `Mi pedido` y `Mesa / Cuenta`.

Mozo: acceso, vista de salón y llamados, detalle de mesa, revisión y validación, carga directa de pedido y registro de cobro.

Administrador del negocio: asistente inicial, identidad, carta, sectores, salón, pagos, equipo, vista previa y publicación. Puede repetir o editar estas configuraciones después del alta.

Encargado: operación diaria, disponibilidad de productos, configuración de salón y sillas, agrupación/separación y gestión de QR, dentro de los permisos predefinidos.

Cocina/barra: colas por sector con pedidos confirmados y estados por ítem. Cocina o barra gestionan `En cola`, `En preparación`, `Listo` y excepciones; el mozo confirma `Entregado`.

Valentín: administración global de tenants, creación y entrega del administrador inicial, activación o suspensión, dominio y soporte técnico. No revisa ni aprueba la identidad, carta, operación o publicaciones de cada negocio.

## Prototipado

La conexión MCP con Google Stitch quedó verificada. El proyecto privado usado como prototipo contiene 26 pantallas funcionales, un mapa general y un sistema visual denominado `Bodegón Contemporáneo`. Los textos `Stitch QR` y `stitchresto.app` son placeholders del prototipo y no representan el nombre definitivo del producto.

### Pantallas existentes en Stitch

Superadministración y alta:

- S1. Panel del Superadministrador.
- S2. Alta de un Nuevo Tenant.
- O1-O10. Asistente completo desde bienvenida hasta revisión y publicación.

Cliente, móvil:

- C1. Carta Digital y Carrito (Mesa 2).
- C5. Selección de Silla y Método de Pago.
- C6. Pasarela y Estados de Mercado Pago.
- C8. Estado en Vivo y Cuenta Abierta.

Personal, móvil:

- M1. Acceso de Personal con PIN Rápido.
- M2. Salón y Alertas en Vivo.
- M4. Validación de Comanda (Mesa 2).
- M5. Toma Manual de Comanda en Mesa (Mozo).
- M6. Cobro y Cierre de Cuenta (Mesa 2).

Administración del negocio, escritorio:

- A1-A2. Editor Visual de Salón y Agrupación Dinámica.
- A3. Gestión y Centro de Descarga de Códigos QR.
- A4. Gestión Administrativa de Carta y Menú.

Producción, escritorio:

- K1. KDS Cocina Caliente y Despacho.
- K2. KDS Barra de Bebidas y Cafetería.

### Cobertura y faltantes del prototipo

El prototipo cubre alta inicial, operación de salón, carta, QR, pagos básicos, superadministración y KDS. Todavía faltan pantallas administrativas posteriores al alta para identidad y apariencia, gestión segura del equipo, dominios, publicación y configuración de pagos. También faltan la cuenta registrada del comensal, consentimiento y verificación de WhatsApp, historial, fidelización, progreso de visitas, premios, cumpleaños y configuración de automatizaciones.

### Ajustes que deben reflejar las pantallas existentes

- A4 debe diferenciar claramente borrador y versión publicada.
- A4 debe permitir cambiar la disponibilidad de un producto de forma inmediata, sin publicar el resto del borrador.
- A1-A2 y A3 deben conservar la identidad de cada mesa física y su QR aunque existan agrupaciones dinámicas.
- M1 y O9 deben trabajar con cuentas individuales y roles fijos. El personal operativo accede con usuario y PIN de seis dígitos; el PIN nunca se muestra en claro. El Encargado revalida acciones sensibles y Administrador y Superadministrador mantienen autenticación reforzada con segundo factor.
- M6 debe cerrar la sesión y mover la mesa a `Pendiente de limpieza`, no liberarla. M2 debe permitir marcarla como limpia y habilitarla.
- C1/C5/C8 deben representar el borrador privado del dispositivo y la sesión compartida con consumido, pagado y pendiente.
- Debe agregarse el flujo real de división en partes iguales, reclamo de participaciones y protección ante cobros simultáneos.
- K1/K2 deben operar por ítem y reemplazar `Reabrir/Revertir ticket` por excepciones y movimientos auditables. El mozo debe poder marcar cada ítem como entregado.
- Las traducciones automáticas no se publican directamente ni quedan acopladas a Google; generan borradores aprobables mediante un adaptador de proveedor.
- Los cambios de identidad, precio, descripción y estructura no impactan al instante: forman una versión borrador y se publican atómicamente. Sólo disponibilidad cambia en tiempo real.
- Deben diseñarse estados sin conexión, reconexión, carga, error y vacío. Las acciones críticas esperan confirmación del servidor.
- Debe corregirse accesibilidad: varias pantallas usan texto menor de 12 px y numerosos controles carecen de nombres accesibles.
- Toda pantalla administrativa u operativa debe mostrar solamente datos del tenant activo.

No se modificaron pantallas en Stitch durante esta revisión. Las nuevas pantallas y los ajustes deberán acordarse antes de generar o editar diseños.

## Pendientes de decisión

- Nombre comercial, dominio principal y reemplazo de placeholders visuales.
- Detalle visual y comportamiento exacto de las variantes de personalización.
- Plazo técnico de purga de datos personales dentro de copias de seguridad y procedimiento de restauración compatible con eliminaciones.
- Exclusiones específicas de premios por categorías o productos y tratamiento de casos excepcionales después de un canje ya consumado.
- Proceso de soporte para verificación y recuperación de cuentas Meta de cada negocio.
- Momento de incorporación del constructor de campañas masivas y métricas de conversión.
- Precio del Plan Nube, licencia inicial local, renovación de mantenimiento, niveles de soporte y condiciones comerciales.
- Duración del período de gracia del Plan Nube y plazos de conservación, exportación y eliminación después de una suspensión.
- Política de soporte y seguridad para instalaciones locales sin mantenimiento, incluida la compatibilidad no garantizada con integraciones externas.
- Requisitos mínimos de hardware y sistema operativo para la Edición Local, estrategia de instalación de contenedores en Windows y alcance del acceso público a los QR cuando el cliente está fuera de la red local.

## Estado del trabajo

Se actualizó la documentación de planificación y se verificó en modo lectura el prototipo de Google Stitch. No se construyó la aplicación, no se conectaron pagos o Meta, no se publicó un sitio, no se modificaron pantallas en Stitch y la carpeta todavía no es un repositorio Git. Continuar diferenciando requisitos confirmados de propuestas; no resolver decisiones pendientes de forma implícita.
