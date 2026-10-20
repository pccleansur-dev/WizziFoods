# Plan de implementación: la plataforma

Estado: propuesto para revisión humana antes de iniciar código.

## Objetivo

Construir el Plan Nube de la plataforma como un SaaS multitenant para gastronomía. La primera meta no es completar todos los módulos comerciales posibles, sino obtener un piloto operativo seguro: un negocio puede configurarse, publicar su carta, operar mesas y pedidos, producir por sectores, cobrar, cerrar la cuenta y volver a habilitar la mesa sin mezclar datos con otro tenant.

El trabajo se realizará en cortes verticales. Cada corte incorporará solamente el esquema, API, interfaz, pruebas y observabilidad necesarios para entregar una conducta comprobable. No se construirá primero “toda la base de datos” ni “todo el frontend” por separado.

## Alcance por hito

### Hito A: piloto operativo

- Monorepo, entornos reproducibles y despliegue por contenedores.
- Multitenencia, RLS, roles fijos, autenticación administrativa y acceso del personal con usuario y PIN.
- Superadministración para crear y entregar un tenant.
- Asistente de alta: identidad, carta, sectores, plano, QR, pagos, equipo, prueba y publicación.
- Carta pública, borrador privado por dispositivo, sesión compartida de mesa y pedidos.
- Salón, llamados, carga manual, validación, cocina/barra y estados por ítem.
- Cuenta abierta append-only, caja, pagos presenciales, Mercado Pago, pagos parciales y división.
- Cierre, pendiente de limpieza, habilitación manual y comprobante no fiscal.

### Hito B: lanzamiento comercial

- Cuenta de cliente con Google, consentimientos y perfil aislado por restaurante.
- Fidelización inicial por visitas verificadas, cumpleaños y premios.
- WhatsApp Business por tenant para avisos y automatizaciones básicas aprobadas.
- PWA, reconexión, accesibilidad, idiomas, observabilidad, copias y pruebas de lanzamiento.

### Evoluciones posteriores

- Constructor avanzado de campañas y métricas de conversión.
- Puntos por importe consumido.
- Integración fiscal ARCA.
- Empresas con múltiples sucursales.
- Edición Local, instalador y Centro de Control.

Estos módulos no se implementan en el piloto, pero los límites de dominio, adaptadores y perfiles de despliegue deben evitar que su incorporación exija bifurcar el producto.

## Decisiones de arquitectura

- Monorepo con aplicaciones `web`, `api` y `worker`, más paquetes compartidos para contratos, configuración, UI y observabilidad.
- Next.js para la experiencia web/PWA y NestJS con Fastify para una API REST documentada con OpenAPI.
- Supabase autoalojado para PostgreSQL, Auth, Storage y Realtime; Drizzle administra consultas y un único historial de migraciones SQL.
- Toda escritura de negocio atraviesa la API. Realtime notifica cambios y el cliente vuelve a consultar el estado autoritativo.
- El tenant se resuelve desde la identidad autenticada o el host/QR público y se vuelve contexto obligatorio. La base aplica RLS como segunda barrera.
- Los pedidos confirmados y el libro mayor son append-only. Correcciones y devoluciones agregan movimientos vinculados.
- Integraciones externas detrás de adaptadores: almacenamiento, OCR, traducción, Mercado Pago, WhatsApp, correo y futura facturación fiscal.
- Dos perfiles previstos desde la configuración: `cloud-multitenant` y `local-single-tenant`; solamente el primero se libera en esta etapa.
- Observabilidad con OpenTelemetry y stack Grafana; nunca se registran PIN, secretos, datos completos de pago ni contenido personal innecesario.

## Estructura inicial propuesta

```text
apps/
  web/
  api/
  worker/
packages/
  contracts/
  database/
  ui/
  config/
  observability/
supabase/
  migrations/
  tests/
infra/
  compose/
  coolify/
docs/
  adr/
  runbooks/
tests/
  e2e/
```

La estructura es una decisión de partida, no una obligación de generar carpetas vacías. Cada directorio se crea cuando su primer corte vertical lo necesita.

## Dependencias principales

```text
Toolchain y entorno local
    └── contexto tenant + RLS
          ├── identidades administrativas
          ├── sesiones de personal y permisos
          └── aprovisionamiento de negocios
                 └── asistente y publicación
                        └── QR + sesión de mesa
                               └── pedidos y producción
                                      └── libro mayor y pagos
                                             └── cierre y limpieza
                                                    ├── fidelización
                                                    └── WhatsApp

Contratos de eventos + telemetría
    └── acompañan cada corte desde el comienzo
```

## Secuencia de trabajo

La lista operativa y sus criterios verificables están en `tasks/todo.md`.

### Fase 0 — Base reproducible

- [x] T01. Crear el workspace y los contratos de calidad.
- [x] T02. Levantar Supabase y servicios locales con Docker Compose.
- [ ] T03. Establecer CI, configuración segura y telemetría mínima.

### Fase 1 — Seguridad y aislamiento

- [ ] T04. Crear un tenant aislado con `location` inicial y RLS negativa.
- [ ] T05. Autenticar Superadmin y Administrador con segundo factor.
- [ ] T06. Autenticar personal mediante usuario y PIN con roles fijos.

### Fase 2 — Administración de la plataforma

- [ ] T07. Aprovisionar y entregar un negocio desde Superadmin.
- [ ] T08. Resolver tenant por dominio y proteger el contexto en toda solicitud.
- [ ] T09. Implementar auditoría, soporte temporal y suspensión gradual.

### Fase 3 — Alta: identidad y carta

- [ ] T10. Guardar perfil, imágenes y propuesta visual del negocio.
- [ ] T11. Administrar carta, sectores y publicación versionada.
- [ ] T12. Importar carta a un borrador revisable.

### Fase 4 — Alta: operación y publicación

- [ ] T13. Diseñar el plano, mesas, sillas, agrupaciones y QR estables.
- [ ] T14. Configurar equipo y medios de pago.
- [ ] T15. Validar mínimos, probar el circuito y publicar el negocio.

### Fase 5 — Experiencia del comensal

- [ ] T16. Entrar por QR respetando el estado de la mesa.
- [ ] T17. Navegar la carta y mantener un borrador privado.
- [ ] T18. Confirmar un pedido o solicitar validación/cobro presencial.

### Fase 6 — Operación y producción

- [ ] T19. Operar salón, llamados y pedidos manuales.
- [ ] T20. Producir por sector y actualizar estados por ítem.
- [ ] T21. Resolver entrega, faltantes, cambios y cancelaciones auditadas.

### Fase 7 — Cuenta y pagos

- [ ] T22. Mantener cuenta abierta con libro mayor append-only.
- [ ] T23. Abrir/cerrar caja y registrar pagos o devoluciones presenciales.
- [ ] T24. Cobrar online con Mercado Pago de forma idempotente.

### Fase 8 — Mesa y cobros avanzados

- [ ] T25. Cobrar importes parciales y dividir saldo con concurrencia segura.
- [ ] T26. Cerrar cuenta, limpiar, habilitar y emitir comprobante no fiscal.
- [ ] T27. Unir/separar mesas sin mover deuda ni perder historia.

### Fase 9 — Retención

- [ ] T28. Registrar clientes con Google y consentimientos separados.
- [ ] T29. Acreditar visitas y administrar premios de fidelización.
- [ ] T30. Conectar WhatsApp por tenant y ejecutar automatizaciones básicas.

### Fase 10 — Preparación para lanzamiento

- [ ] T31. Completar PWA, reconexión y consistencia Realtime.
- [ ] T32. Completar accesibilidad, responsive e idiomas aprobables.
- [ ] T33. Verificar seguridad, copias, observabilidad y piloto de lanzamiento.

## Estrategia de verificación

- Unitarias con Vitest para reglas puras y máquinas de estado.
- Integración contra Supabase/PostgreSQL real para transacciones, restricciones, colas y Storage.
- pgTAP para demostrar que identidades de un tenant no pueden leer ni escribir otro.
- Contratos OpenAPI para impedir divergencias entre API y cliente.
- Playwright para los recorridos críticos de administrador, comensal, mozo y producción.
- Pruebas de accesibilidad automatizadas y revisión manual con teclado y lector de pantalla en los flujos principales.
- Pruebas de concurrencia para stock, reclamo de participaciones, pagos, canjes y webhooks.
- Ensayos de restauración: una copia no se considera válida hasta restaurarla y verificarla.

## Definición de terminado

Cada tarea sólo se cierra si cumple sus criterios particulares y, además:

- El comportamiento se verificó en ejecución y no sólo mediante compilación.
- La conducta nueva tiene pruebas que fallarían sin la implementación.
- Tipos, lint, formato, pruebas y build están en verde.
- No quedan secretos, logs sensibles, código muerto o atajos que debiliten RLS.
- Los cambios de API, datos o arquitectura quedan documentados.
- Los caminos críticos tienen logs, métricas y trazas útiles.
- Existe estrategia de reversión para migraciones y despliegues riesgosos.
- Valentín revisó el corte antes de fusionarlo o desplegarlo.

## Riesgos y mitigaciones

| Riesgo                                         | Impacto | Mitigación                                                                            |
| ---------------------------------------------- | ------: | ------------------------------------------------------------------------------------- |
| Fuga de datos entre tenants                    | Crítico | Contexto obligatorio, RLS, pruebas negativas y revisión de consultas en cada corte.   |
| Doble cobro o saldo inconsistente              | Crítico | Libro mayor append-only, bloqueo transaccional, idempotencia y consulta autoritativa. |
| Realtime interpretado como fuente de verdad    |    Alto | Eventos como invalidación; refetch al reconectar y confirmación REST para escrituras. |
| Alcance demasiado amplio para el primer piloto |    Alto | Hitos A/B, flags por módulo y revisión humana en cada checkpoint.                     |
| Dependencia de proveedores                     |    Alto | Adaptadores, webhooks verificables, reintentos y degradación explícita.               |
| Crecimiento de Storage en el VPS               |   Medio | Compresión, cuotas, volumen separado, alertas y copia externa.                        |
| Fallo del VPS único                            |    Alto | Copia externa, PITR, runbook de recuperación y monitor externo.                       |
| Operación móvil con mala conectividad          |    Alto | PWA, estados de reconexión y ninguna confirmación optimista de escrituras críticas.   |
| Personal comparte credenciales                 |   Medio | Cuentas individuales, PIN con bloqueo y auditoría visible.                            |

## Decisiones todavía no bloqueantes

- Nombre comercial y dominio principal: se usan placeholders configurables, nunca literales estructurales.
- Proveedor inicial de OCR y traducción: se implementan adaptadores y un modo manual funcional.
- Precios, períodos de gracia y políticas comerciales: se representan como configuración hasta su definición.
- Proveedor de correo/transaccional y destino de copias externas: se eligen antes del piloto público.

## Puertas de aprobación

1. Aprobar este plan y la separación entre Hito A, Hito B y evoluciones.
2. Revisar el primer recorrido ejecutable al terminar T03.
3. Autorizar el avance al piloto operativo después de T27.
4. Autorizar lanzamiento comercial únicamente después de T33.
