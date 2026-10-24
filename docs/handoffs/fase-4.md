# Handoff de Fase 4 — Alta: operación y publicación

## Punto de partida

La Fase 3 queda implementada en `chore/workspace-bootstrap` desde `a8c7999`, con
T12 distribuida en estos commits incrementales:

- `6f6f318`: contratos del borrador revisable y validación de fuentes.
- `9c6cdfd`: persistencia, cola, idempotencia y aislamiento SQL.
- `fc99ee1`: procesamiento CSV/XLSX, fallback PDF/imagen y reintentos.
- `e4262e0`: API administrativa y aprobación hacia el borrador de T11.
- `79f9a2d`: carga, revisión, corrección y descarte en el panel.

La migración nueva es
`supabase/migrations/20261023214000_create_catalog_imports.sql`. La única
dependencia de producción agregada es `read-excel-file@9.3.12`, fijada en el
lockfile. El audit de producción no presenta hallazgos altos o críticos; conserva
cuatro bajos y cuatro moderados preexistentes en la cadena Fastify/Nest.

## Invariantes que Fase 4 debe preservar

- El tenant y la ubicación se resuelven desde sesión y dominio; ningún body,
  query param ni identificador importado puede elegirlos.
- Los endpoints de alta requieren Administrador. Una identidad de plataforma no
  entra en un tenant sin el flujo de soporte temporal existente.
- Carta, plano, equipo y pagos se guardan como avance. Sólo T15 puede declarar el
  negocio listo para operar.
- Una importación aprobada modifica únicamente el borrador de carta. Publicar la
  carta sigue siendo una operación explícita, versionada y atómica.
- Los QR pertenecen a mesas físicas estables: mover o agrupar una mesa nunca
  reemplaza su ID ni su token público.
- Credenciales de proveedores no vuelven al navegador, respuestas, trazas ni
  eventos. Las operaciones SQL permanecen parametrizadas y tenant-scoped.
- El modo de prueba de T15 debe usar un namespace o marca explícita y no alimentar
  métricas, saldos ni operación reales.

## Secuencia recomendada

### T13 — Plano, mesas, agrupaciones y QR

1. Definir primero el modelo persistente: plano versionado, sectores, mesas,
   sillas, geometría y membresías de agrupación separadas de la identidad física.
2. Generar tokens QR opacos, únicos e inmutables por tenant/mesa; almacenar sólo
   el material necesario para resolverlos y prever rotación auditada.
3. Implementar comandos idempotentes y con control de versión para guardar,
   mover, agrupar y separar sin last-write-wins silencioso.
4. Entregar el editor responsive con recomendación no bloqueante de pantalla
   amplia y verificar serialización, teclado y geometría en navegador real.

### T14 — Equipo y medios de pago

Puede avanzar en paralelo con T13 después de fijar contratos compartidos.

1. Reutilizar identidades y roles fijos de T06; las asignaciones de sector deben
   referenciar los sectores estables de T11/T13.
2. Separar configuración pública del proveedor y secreto cifrado/referenciado.
   Las lecturas sólo devuelven estado, nunca credenciales.
3. Mantener efectivo habilitado por defecto y validar transaccionalmente que no
   se desactive el último medio disponible.
4. Auditar altas, desactivaciones, cambios de rol/sector y cambios de medios sin
   registrar PIN, token ni secreto.

### T15 — Readiness, simulación y publicación

Debe comenzar cuando T13 y T14 tengan sus contratos estables y cerrarse después
de ambas tareas.

1. Construir una matriz autoritativa de requisitos sobre T10–T14 que devuelva
   códigos, explicación y enlace al paso faltante sin impedir guardar avances.
2. Aislar la simulación de QR → pedido → producción → pago → cierre → limpieza
   desde base de datos hasta observabilidad; una bandera sólo en UI no alcanza.
3. Exigir Administrador y transacción para publicar el negocio. Revalidar todos
   los mínimos dentro de la misma operación para evitar TOCTOU.
4. Cubrir con E2E el alta ficticia completa y demostrar que datos simulados,
   importaciones pendientes y borradores sin publicar no entran en producción.

## Puertas de verificación

Antes de cerrar cada slice:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm security:secrets
pnpm audit --prod --audit-level high
```

Para migraciones, ejecutar además los pgTap del módulo y los recorridos de
integración local con dos tenants. T13 y T15 requieren verificación responsive en
navegador real. T14 requiere inspeccionar red y logs para demostrar que los
secretos no salen del servidor.

## Riesgos y pendientes conscientes

- El adaptador OCR externo no forma parte de T12: PDF e imagen quedan revisables
  con `OCR_UNAVAILABLE`, sin bloquear CSV/XLSX ni carga manual.
- El límite de Server Actions es 9 MB para admitir un archivo máximo de 8 MB más
  el overhead multipart; API y contrato vuelven a imponer el límite de 8 MB.
- El Checkpoint 3 conserva pendiente la aprobación humana de la diferencia visual
  entre borrador, publicado y disponibilidad inmediata.
- El warning de webpack de OpenTelemetry sobre `require-in-the-middle` es
  preexistente y no impide el build; no debe confundirse con un fallo de T12.
