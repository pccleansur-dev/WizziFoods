# Simulacro de incidente: la API se cae

Generado por `e2e/incident-drill.ts`. Qué se probó: el stack de monitoreo detecta una caída real, avisa al canal del equipo y avisa cuando se recupera.

```text
2026-10-27T05:03:41.953Z  up: starting the monitoring stack
2026-10-27T05:03:43.007Z  up: starting the API and the worker of this repository
2026-10-27T05:03:49.086Z  ok: Prometheus scrapes the API (up=1)
2026-10-27T05:04:01.119Z  ok: the worker heartbeat is a metric
2026-10-27T05:04:01.122Z  ok: the Postgres exporter answers the business queries
2026-10-27T05:04:01.168Z  ok: Grafana provisioned 1 dashboard(s)
2026-10-27T05:04:01.168Z  INCIDENT: killing the API
2026-10-27T05:05:49.470Z  ALERT RECEIVED (ApiDown firing) at 2026-10-27T05:05:49.148Z
2026-10-27T05:05:49.470Z  RECOVERY: starting the API again
2026-10-27T05:10:31.194Z  ALERT RESOLVED (ApiDown) at 2026-10-27T05:10:30.261Z
```

Alertas recibidas en el canal:

```json
[
  {
    "at": "2026-10-27T05:05:49.146Z",
    "alerts": [
      {
        "alertname": "WebDown",
        "severity": "critical",
        "status": "firing",
        "summary": "The web does not answer its metrics port",
        "runbook": "docs/runbooks/incidentes.md#api-caida"
      }
    ]
  },
  {
    "at": "2026-10-27T05:05:49.148Z",
    "alerts": [
      {
        "alertname": "ApiDown",
        "severity": "critical",
        "status": "firing",
        "summary": "The API does not answer its metrics port",
        "runbook": "docs/runbooks/incidentes.md#api-caida"
      }
    ]
  },
  {
    "at": "2026-10-27T05:06:26.066Z",
    "alerts": [
      {
        "alertname": "PublicEndpointDown",
        "severity": "critical",
        "status": "firing",
        "summary": "https://api.example.com/health does not answer from outside",
        "runbook": "docs/runbooks/incidentes.md#api-caida"
      },
      {
        "alertname": "PublicEndpointDown",
        "severity": "critical",
        "status": "firing",
        "summary": "https://app.example.com/acceso does not answer from outside",
        "runbook": "docs/runbooks/incidentes.md#api-caida"
      },
      {
        "alertname": "PublicEndpointDown",
        "severity": "critical",
        "status": "firing",
        "summary": "https://supabase.example.com/auth/v1/health does not answer from outside",
        "runbook": "docs/runbooks/incidentes.md#api-caida"
      }
    ]
  },
  {
    "at": "2026-10-27T05:09:36.421Z",
    "alerts": [
      {
        "alertname": "WalArchiveFailing",
        "severity": "critical",
        "status": "firing",
        "summary": "WAL segments are not reaching the archive (point-in-time recovery is at risk)",
        "runbook": "docs/runbooks/incidentes.md#copias-y-restauracion"
      }
    ]
  },
  {
    "at": "2026-10-27T05:09:37.438Z",
    "alerts": [
      {
        "alertname": "JobQueueBacklog",
        "severity": "warning",
        "status": "firing",
        "summary": "A background job has waited more than 15 minutes (catalog_import)",
        "runbook": "docs/runbooks/incidentes.md#jobs-detenidos"
      }
    ]
  },
  {
    "at": "2026-10-27T05:10:30.261Z",
    "alerts": [
      {
        "alertname": "ApiDown",
        "severity": "critical",
        "status": "resolved",
        "summary": "The API does not answer its metrics port",
        "runbook": "docs/runbooks/incidentes.md#api-caida"
      }
    ]
  }
]
```
