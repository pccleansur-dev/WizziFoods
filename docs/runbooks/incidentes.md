# Incidentes: qué hacer cuando suena una alerta

Cada alerta de `infra/observability/rules/platform.yml` apunta a una sección de este documento (el ancla está en su
anotación `runbook`). Los simulacros que prueban que las alertas suenan están en `docs/evidence/`.

## Antes de nada

| Gravedad   | Qué significa                                                   | Quién responde        | En cuánto tiempo               |
| ---------- | --------------------------------------------------------------- | --------------------- | ------------------------------ |
| `critical` | Los locales no pueden operar, cobrar o se pueden perder datos.  | Quien está de guardia | Empezar en 15 min, a toda hora |
| `warning`  | Se degrada algo o se acerca un límite; todavía se puede operar. | Quien está de guardia | El mismo día hábil             |

Roles durante un incidente crítico (una persona puede tener dos): **Comandante** (decide y comunica), **Operador**
(toca los sistemas) y **Escribano** (anota hora y acción en el registro del incidente). Valentín es el comandante por
defecto hasta que se designe guardia.

1. **Reconocé** la alerta en Alertmanager y anotá la hora.
2. **Mirá el panel** «Plataforma — visión general» (Grafana, puerto 3030): ¿qué otra cosa cambió a la vez?
3. **Seguí la sección** de abajo. Si en 30 minutos no está contenido, avisá a los negocios afectados (mensaje corto:
   qué pasa, qué pueden hacer — por ejemplo «cobren en caja, anoten a mano»).
4. **Cerrá** con un registro: causa, qué se hizo, cuánto duró, qué cambia para que no se repita.

Regla de oro: **un cambio a la vez, anotado**. Para volver atrás un despliegue o una migración, ver `lanzamiento.md`.

## API caída

Alertas: `ApiDown`, `WebDown`, `ApiErrorRateHigh`, `PublicEndpointDown`.

1. ¿Responde desde afuera? `curl -i https://api.<dominio>/ready`. `/health` 200 y `/ready` 503 = el proceso vive pero
   **no llega a la base** → ir a [Base de datos](#base-de-datos).
2. Proceso caído: ver el estado del contenedor en Coolify y su registro. Un reinicio fallido con
   `service_start_failed` indica una variable de entorno ausente o inválida (el mensaje dice cuál, nunca su valor).
3. Subió el error 5xx después de un despliegue: **volver a la versión anterior** (Coolify → Deployments → Rollback). Si
   el despliegue incluía una migración, ver «Migración» en `lanzamiento.md` antes de volver.
4. Verificá con `/ready` y con un recorrido real: entrar por un QR, ver la carta.

## API lenta

Alerta: `ApiSlow`.

1. En el panel, ¿qué ruta? (la métrica trae `route`). ¿Coincide con un pico de pedidos?
2. Conexiones a Postgres cerca del límite → [Base de datos](#base-de-datos).
3. Consultas lentas: `select query, calls, mean_exec_time from pg_stat_statements order by mean_exec_time desc limit 10`.
4. Si es carga legítima, reiniciar no ayuda: subir recursos o limitar lo que se pueda (ver «carga mínima» en `lanzamiento.md`).

## Jobs detenidos

Alertas: `WorkerDown`, `WorkerHeartbeatMissing`, `JobQueueBacklog`.

Qué se frena: procesar imágenes del negocio, importar cartas y enviar mensajes (WhatsApp / avisos). **La operación del
salón no depende del worker**: se puede seguir pidiendo, cocinando y cobrando.

1. Reiniciar el contenedor del worker. Si reinicia en bucle, mirar su registro (`service_start_failed` = configuración).
2. Cola vieja con worker vivo: ¿un trabajo falla siempre? Los reintentos son seguros (cada trabajo vuelve a ser visible
   al vencer `WORKER_VISIBILITY_TIMEOUT_SECONDS`). Un trabajo que falla siempre se descarta tras sus intentos; revisar
   el evento `*_job_rejected` en el registro.
3. Después de recuperar, confirmar que la cola baja (panel «Cola de trabajos»).

## Mensajes que no salen

Alertas: `MessagingOutboxStuck`, `MessagingFailuresHigh`.

1. ¿Está el worker vivo? (sección anterior). Los mensajes no se pierden: quedan `queued` y salen al volver.
2. `stuck_sending > 0`: el worker murió a mitad de un envío; el candado vence solo y el mensaje se reintenta.
3. Fallos de WhatsApp/Meta: mirar `last_error` de los mensajes `failed` (`select last_error, count(*) from
private.messaging_outbox where status='failed' group by 1`). Token vencido o plantilla no aprobada: el administrador del
   negocio lo ve en «Mensajería». **Nunca** reenviar a mano fuera de la política de envío: la política (consentimiento, horario,
   topes) vive en la base y es la única autoridad.
4. Avisos push: el servicio de push del navegador rechaza suscripciones vencidas (410); se dan de baja solas.

## Pagos

Alertas: `PaymentNotificationsNotProcessed`, `PaymentsStuckPending`, `PaymentsRejectedSpike`.

El dinero manda: **nunca se cobra dos veces** (el libro es append-only y los comandos son idempotentes), así que reintentar
es seguro.

1. `PaymentNotificationsNotProcessed`: Mercado Pago avisó y no se procesó. Ver el registro de la API (`mp_webhook_*`) y
   `select * from private.mp_webhook_events where processed_at is null order by received_at`. Si la API estuvo caída,
   Mercado Pago reintenta solo; al volver la API se procesan. Si no, reprocesar consultando el pago por su id desde
   el panel del negocio (la consulta autoritativa decide el estado).
2. `PaymentsStuckPending`: pagos creados que nunca se aprobaron ni rechazaron. Suele ser el comensal que abandonó el
   checkout; el sistema los deja `pending` sin afectar la cuenta. Si son muchos a la vez, sospechar de la conexión con
   Mercado Pago (credenciales vencidas: «Pagos» en el panel muestra el estado de la conexión).
3. `PaymentsRejectedSpike`: más rechazos que aprobaciones. Mirar `provider_status_detail` de los rechazos. Si es un
   problema de credenciales/cuenta, avisar al negocio: puede cobrar en caja mientras tanto.
4. Un pago online que figura aprobado en Mercado Pago y no en la cuenta: no se corrige tocando la base. Se concilia desde la
   consulta autoritativa y, si hace falta devolver, con el flujo de devolución (queda en el libro).

## Base de datos

Alertas: `PostgresDown`, `PostgresConnectionsNearLimit`.

1. `PostgresDown`: ¿el contenedor `supabase-db` corre? Su registro dice por qué (disco lleno es lo más común →
   [Disco lleno](#disco-lleno)). **No borrar archivos de `pg_wal`** a mano.
2. Si no arranca y los datos parecen dañados: **no improvisar**. Parar, copiar el directorio de datos tal como está
   (para peritaje) y restaurar con [Copias y restauración](#copias-y-restauracion).
3. Conexiones cerca del límite: ver quién las usa (`select usename, state, count(*) from pg_stat_activity group by 1,2`).
   Cada servicio usa un pool acotado; un salto indica una consulta colgada. Terminar la sesión culpable
   (`pg_terminate_backend`), no reiniciar la base.
4. Tras recuperarse, correr los controles: `/ready` de la API y `pnpm security:gate` (pruebas de la base).

## Disco lleno

Alertas: `DiskAlmostFull`, `DiskFillingFast`, `MemoryLow`.

1. ¿Qué crece? `docker system df`, `du -sh` de los volúmenes (base, Storage, archivo de WAL, registros).
2. El archivo de WAL (`/wal-archive`) crece si **no se está subiendo a su destino externo**: arreglar la subida, no borrar.
   Los WAL anteriores al último respaldo base ya no sirven: se pueden podar con el script de retención.
3. Storage creciendo: ver cuotas por negocio; las imágenes se recomprimen al subir.
4. Registros de Docker sin rotación: configurar `max-size`/`max-file`.
5. Solo si no hay otra salida: ampliar el volumen. Después, revisar la causa.

## Certificados

Alertas: `CertificateExpiresSoon` (21 días), `CertificateExpiresVerySoon` (5 días).

1. Los certificados los emite y renueva el proxy (Coolify/Caddy con Let's Encrypt). Una alerta significa que la
   renovación **falla**: mirar el registro del proxy. Causas comunes: el DNS no apunta al servidor, el puerto 80/443
   bloqueado, límite de emisión.
2. Forzar la renovación desde Coolify y verificar con `openssl s_client -connect <host>:443 -servername <host> | openssl x509 -noout -dates`.
3. Si vence sin remedio, el Realtime y la PWA dejan de funcionar primero (navegadores exigen HTTPS): avisar a los negocios.

## Copias y restauración

Alertas: `BackupTooOld`, `StorageBackupTooOld`, `BackupMetricMissing`, `RestoreDrillOverdue`, `WalArchiveFailing`.

- `BackupTooOld` / `StorageBackupTooOld`: el trabajo programado no corrió o falló. Correrlo a mano
  (`infra/backup/backup-database.sh`, `infra/backup/backup-storage.sh`) y leer por qué falló (¿disco? ¿destino externo?).
- `WalArchiveFailing`: **riesgo para la recuperación a un punto en el tiempo**. Mirar `select * from pg_stat_archiver`
  y el destino del `archive_command`. Un segmento sin archivar es un agujero en la recuperación.
- `RestoreDrillOverdue`: correr `infra/backup/restore-drill.sh` y `infra/backup/pitr-drill.sh`; guardan su evidencia en `docs/evidence/`.
- Restaurar de verdad: `copias-y-restauracion.md`, sección «Restaurar producción».
