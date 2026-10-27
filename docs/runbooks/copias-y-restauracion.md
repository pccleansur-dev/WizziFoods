# Copias y restauración (PITR y Storage)

> Una copia no es válida hasta que se restauró y se verificó. Todo lo de abajo tiene un simulacro que lo prueba y deja
> evidencia en `docs/evidence/`.

## Qué se protege y con qué

| Qué                                      | Cómo                                                                                              | Frecuencia                     | Objetivo (RPO / RTO)                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| Base de datos (negocios, cuentas, libro) | Copia física `pg_basebackup` + **archivo continuo de WAL** (recuperación a un punto en el tiempo) | Copia diaria; WAL cada ≤ 5 min | **RPO ≤ 5 min · RTO ≤ 1 h** (a confirmar con datos reales) |
| Roles de la base                         | `pg_dumpall --globals-only` junto a cada copia                                                    | Con cada copia                 | —                                                          |
| Archivos subidos (Storage)               | Archivo comprimido + `sha256` de cada archivo                                                     | Diaria                         | RPO ≤ 24 h                                                 |
| Secretos y configuración                 | **Fuera de este repositorio** (gestor de secretos / Coolify): ver «Qué no está en las copias»     | Al cambiar                     | —                                                          |

RPO = cuánto trabajo se puede perder; RTO = cuánto se tarda en volver. Los números del simulacro con la base de
desarrollo (segundos) **no son** el RTO de producción: se miden de nuevo con el tamaño real antes del lanzamiento.

## Scripts (en `infra/backup/`)

| Script                    | Qué hace                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable-wal-archiving.sh` | Recrea el servicio de base con `archive_mode=on` y una regla de replicación **local** (`docker-compose.backup.yml`, `pg_hba.conf`). Verifica que un segmento llegue al archivo.                |
| `backup-database.sh`      | Copia base consistente + roles + `manifest.json` (conteo de filas de las tablas clave, checksum) + métrica para Prometheus. Retención configurable.                                            |
| `backup-storage.sh`       | Archivo de los archivos subidos + `files.sha256` + métrica.                                                                                                                                    |
| `restore-drill.sh`        | **Restaura la última copia en un entorno aislado** (sin red, volumen propio) y verifica: checksum, arranque, conteos contra el manifest, pruebas pgTap, y los archivos de Storage uno por uno. |
| `pitr-drill.sh`           | Simula el error de verdad (alguien borra una tabla), restaura la copia base y reproduce el WAL **hasta un segundo antes del error**.                                                           |

Las copias y el archivo de WAL tienen datos de todos los negocios y los hashes de los roles: permisos solo del dueño
(`umask 077`), **cifrar antes de sacarlas del servidor** y nunca subirlas al repositorio (`/backups/` está ignorado).

### Programación (cron del servidor)

```cron
# diaria 03:10 — base + Storage
10 3 * * *  cd /opt/plataforma && infra/backup/backup-database.sh && infra/backup/backup-storage.sh
# mensual, día 1 a las 04:00 — simulacros (la evidencia queda en docs/evidence/)
0 4 1 * *   cd /opt/plataforma && infra/backup/restore-drill.sh && infra/backup/pitr-drill.sh
```

Las métricas que dejan (`platform_backup_*`) las lee el `node-exporter` (carpeta `infra/observability/textfile`) y alimentan
`BackupTooOld`, `StorageBackupTooOld`, `RestoreDrillOverdue`. Si el trabajo deja de correr, `BackupMetricMissing` avisa.

## Destino externo (decisión pendiente)

Una copia **en el mismo disco** no protege contra perder el servidor (riesgo «Fallo del VPS único»). El plan deja la elección
del destino externo para antes del piloto público. Lo que hay que decidir y configurar, en este orden:

1. **Destino**: almacenamiento de objetos de otro proveedor/región (S3 compatible), con credencial de **solo escritura** para el servidor
   y retención/bloqueo de objetos para que una intrusión no pueda borrar las copias.
2. **Subida de copias**: añadir al final de `backup-*.sh` la subida cifrada (`age`/`gpg` + `rclone`/`aws s3 cp`).
3. **Subida de WAL**: reemplazar el `cp` del `archive_command` (en `docker-compose.backup.yml`) por la subida al mismo destino
   (por ejemplo `wal-g wal-push`; la imagen de Supabase trae su configuración pero **no el programa**: hay que instalarlo, o usar `rclone`/`aws s3 cp` en el comando). El archivo local pasa a ser solo un búfer.
4. Repetir `restore-drill.sh` y `pitr-drill.sh` **bajando las copias desde el destino externo**, no del disco local.

Hasta completar esos cuatro pasos, la evidencia de este documento prueba el procedimiento y los scripts, **no** la protección
contra la pérdida del servidor.

## Restaurar producción (pasos)

Decidir primero: ¿restauro **a un punto en el tiempo** (borrado/error de datos, sé la hora) o **a lo último** (se perdió el
servidor)? Mientras se decide, **no escribir más** en la base dañada: poner la API en mantenimiento (sacarla del proxy).

1. **Restaurar en un entorno nuevo, no sobre el dañado**: levantar un servidor/contenedor limpio con la misma imagen
   (`supabase/postgres:17.x`, ver `infra/supabase/docker-compose.yml`).
2. Extraer la copia base en el directorio de datos y dar el dueño correcto (`postgres`).
3. A un punto en el tiempo: crear `recovery.signal` y agregar a `postgresql.auto.conf`
   `restore_command = 'cp /archivo-wal/%f %p'`, `recovery_target_time = '<hora UTC justo antes del error>'`,
   `recovery_target_action = 'promote'`. A lo último: omitir `recovery_target_time`.
4. Arrancar, esperar `pg_is_in_recovery() = false` y **verificar** (conteos de las tablas de `infra/backup/verify-tables.txt`,
   `pnpm security:gate` en sus pruebas de base).
5. Restaurar Storage del mismo día (`tar -xzf storage.tar.gz`) y comprobar `sha256sum -c files.sha256`.
6. Apuntar la API y el worker al nuevo servidor (variable `DATABASE_URL`), `/ready` en 200, recorrido de humo
   (entrar por QR, ver la carta, abrir el salón).
7. Reabrir el tráfico. Anotar en el registro del incidente: hora del error, hora objetivo, duración (RTO real) y qué se perdió (RPO real).

`pitr-drill.sh` ejecuta esos pasos 1–4 con un error simulado; `restore-drill.sh` los pasos 1, 2, 4 y 5 con la copia real.

## Qué no está en las copias

- **Secretos**: `SUPABASE_JWT_SECRET`, claves de Mercado Pago, `PAYMENT_SECRET_KEY` (con la que se sellan los tokens guardados),
  `WEB_PUSH_PRIVATE_KEY`, el pepper de los PIN y los secretos de Auth. Sin `PAYMENT_SECRET_KEY` los tokens de Mercado Pago y de
  WhatsApp guardados en la base **no se pueden descifrar**: guardala en el gestor de secretos con copia aparte.
  Perder el pepper de PIN obliga a que todo el personal restablezca su PIN.
- **Claves de cifrado de las propias copias**: guardarlas aparte de las copias.
- **Configuración del proxy y DNS**: documentada en Coolify; exportarla cuando cambie.

## Evidencia

Los simulacros dejan su registro en `docs/evidence/` (`restore-drill-*.md`, `pitr-drill-*.md`). Cada lanzamiento adjunta el más reciente
(`lanzamiento.md`).
