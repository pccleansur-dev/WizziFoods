# Observabilidad en producción

La base (logs JSON, trazas, métricas `/metrics` en cada proceso) está en `observabilidad.md`. Este documento es el
stack que las junta: **Prometheus + Alertmanager + Grafana + sondas desde afuera + exportador de Postgres**, en
`infra/observability/`.

## Qué cubre

| Se vigila       | Con qué                                                                                | Alertas                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| API y web       | métricas de cada proceso (`up`, tasa de 5xx, latencia p95)                             | `ApiDown`, `WebDown`, `ApiErrorRateHigh`, `ApiSlow`                                                        |
| Jobs            | latido del worker, edad de las colas, mensajes en cola                                 | `WorkerDown`, `WorkerHeartbeatMissing`, `JobQueueBacklog`, `MessagingOutboxStuck`, `MessagingFailuresHigh` |
| Pagos           | consultas de negocio: pagos viejos sin resolver, notificaciones sin procesar, rechazos | `PaymentNotificationsNotProcessed`, `PaymentsStuckPending`, `PaymentsRejectedSpike`                        |
| Base            | `pg_up`, conexiones, archivo de WAL                                                    | `PostgresDown`, `PostgresConnectionsNearLimit`, `WalArchiveFailing`                                        |
| Disco y memoria | `node-exporter` (Linux)                                                                | `DiskAlmostFull`, `DiskFillingFast`, `MemoryLow`                                                           |
| Desde afuera    | `blackbox-exporter`: disponibilidad HTTP y días de vida del certificado                | `PublicEndpointDown`, `CertificateExpiresSoon`, `CertificateExpiresVerySoon`                               |
| Copias          | métricas que dejan los scripts de `infra/backup/`                                      | `BackupTooOld`, `StorageBackupTooOld`, `RestoreDrillOverdue`, `BackupMetricMissing`                        |

Cada alerta trae `summary` y `runbook` (la sección de `incidentes.md`). Las consultas de negocio (`postgres-queries.yaml`)
leen **solo conteos y edades**: ni personas, ni importes, ni mensajes.

## Levantarlo

```bash
export MONITORING_DATABASE_URL='postgresql://monitoring:<clave>@<host>:5432/postgres?sslmode=require'
export GRAFANA_ADMIN_PASSWORD='<clave>'
export ALERT_SECRETS_DIR=/etc/plataforma/alert-secrets   # contiene el archivo webhook_url
docker compose -f infra/observability/docker-compose.observability.yml --profile host up -d
```

- **Rol de monitoreo**: un rol `monitoring` de solo lectura con `pg_monitor` y `SELECT` sobre las tablas de
  `postgres-queries.yaml` (nunca el dueño). Las consultas leen `private.*`, por eso necesita esos permisos explícitos.
- **Webhook de alertas**: es un secreto; vive en un archivo fuera del repositorio (`url_file`). Cambiar el receptor por
  correo/Telegram/Slack es editar `alertmanager.yml`.
- **Puertos de métricas**: `prometheus.yml` apunta a `9464` (API), `9465` (worker) y `9466` (web). En producción usar los nombres de
  servicio de la red de Docker en lugar de `host.docker.internal`.
- **Sondas externas**: editar `infra/observability/targets/public.json` con las URL reales.
  Un monitor que corre **en el mismo servidor** no ve una caída del servidor: además contratar un monitor externo
  (UptimeRobot, Better Stack…) apuntando a `/ready` de la API y a la web. Es parte del Checkpoint 10.
- **Grafana** escucha solo en `127.0.0.1:3030`; publicarlo detrás del proxy con su propio acceso.
- `node-exporter` necesita un host Linux (`--profile host`); en Docker Desktop no funciona, por eso es opcional.

## Verificarlo

```bash
# Las reglas son válidas y cada alerta suena cuando debe (y no cuando no):
docker run --rm -v "$PWD/infra/observability:/obs" --entrypoint promtool prom/prometheus:v3.5.0 check rules /obs/rules/platform.yml
docker run --rm -v "$PWD/infra/observability:/obs" --entrypoint promtool prom/prometheus:v3.5.0 test rules /obs/rules/platform.test.yaml

# Simulacro con el stack real: se cae la API y la alerta tiene que llegar al canal (y resolverse al volver).
corepack pnpm exec tsx e2e/incident-drill.ts
```

El simulacro levanta todo, apaga la API de verdad, espera que `ApiDown` llegue al receptor, la vuelve a levantar y espera la
resolución. Deja `docs/evidence/incident-drill-<fecha>.md`.

## Mantenimiento

- Revisar las alertas **cada trimestre**: ¿alguna nunca suena? ¿alguna suena siempre? (ruido = se ignora).
- Al agregar un módulo con trabajo en segundo plano o dinero, **agregarle su métrica y su alerta en el mismo cambio**.
- Retención de Prometheus: 30 días. Las copias de los paneles de Grafana están en `infra/observability/grafana/` (se aprovisionan desde el repositorio).
