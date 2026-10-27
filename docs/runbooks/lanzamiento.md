# Lanzamiento: puertas, piloto controlado y vuelta atrás

Este documento es la lista que se completa **antes de abrir a un negocio real** (Checkpoint 10). Tiene tres partes: lo que
la máquina verifica (con su evidencia), lo que solo una persona o el mundo real puede cerrar, y la firma de Valentín.

## 1. Puertas técnicas (se repiten en cada lanzamiento)

| Puerta                                                                | Comando                                                                                              | Evidencia / resultado esperado                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formato, lint, tipos, pruebas, build                                  | `corepack pnpm ci:check`                                                                             | Verde (también corre en CI en cada PR)                                                                                                                                                                                      |
| Pruebas de la base: RLS, aislamiento entre negocios, libro, políticas | `corepack pnpm security:gate` (con web y API corriendo)                                              | `database tests … PASS` (todas las `supabase/tests/database/*.test.sql`)                                                                                                                                                    |
| Postura de seguridad de la base                                       | incluida arriba: `security_posture.test.sql`                                                         | RLS en `public`, `private` cerrado por permisos, ninguna función de `private` ejecutable por visitantes salvo las dos de RLS, `SECURITY DEFINER` con `search_path` fijo, Storage privado, nadie escribe en canales Realtime |
| Encabezados de seguridad                                              | `security:gate --web <url> --api <url>`                                                              | CSP, `nosniff`, `frame-ancestors 'none'`, `no-store` en la API                                                                                                                                                              |
| Dependencias                                                          | incluida en `security:gate` (`pnpm audit --prod --audit-level high`)                                 | Sin vulnerabilidades altas ni críticas sin mitigación explícita                                                                                                                                                             |
| Secretos                                                              | `corepack pnpm security:secrets`                                                                     | Sin hallazgos                                                                                                                                                                                                               |
| Recorridos de punta a punta                                           | `corepack pnpm e2e` y `corepack pnpm e2e:production`                                                 | Verde (la caché real solo se prueba con `e2e:production`)                                                                                                                                                                   |
| Accesibilidad y responsive                                            | incluida en `e2e` (`accessibility.spec.ts`)                                                          | WCAG 2.2 AA sin hallazgos; sin scroll lateral de 320 a 1440 px                                                                                                                                                              |
| Carga mínima                                                          | `corepack pnpm load:smoke` (contra la API que se va a desplegar)                                     | p95 ≤ 800 ms, 0 % de errores. Registrar rps y p95 de cada ruta                                                                                                                                                              |
| Vuelta atrás de migraciones                                           | `corepack pnpm exec tsx packages/infra/src/rollback-drill.ts --last <n>`                             | `docs/evidence/rollback-drill-<fecha>.md`: PASSED, mismas aserciones antes y después                                                                                                                                        |
| Despliegue fallido                                                    | `corepack pnpm exec tsx e2e/failed-deploy-drill.ts`                                                  | `docs/evidence/failed-deploy-drill-<fecha>.md`: la versión mala no recibe tráfico                                                                                                                                           |
| Alertas y avisos                                                      | `corepack pnpm exec tsx e2e/incident-drill.ts`                                                       | `docs/evidence/incident-drill-<fecha>.md`: la alerta llega y se resuelve                                                                                                                                                    |
| Restauración de la base y de Storage                                  | `infra/backup/backup-database.sh && infra/backup/backup-storage.sh && infra/backup/restore-drill.sh` | `docs/evidence/restore-drill-<fecha>.md`: PASSED                                                                                                                                                                            |
| Recuperación a un punto en el tiempo                                  | `infra/backup/pitr-drill.sh`                                                                         | `docs/evidence/pitr-drill-<fecha>.md`: PASSED                                                                                                                                                                               |

### Última corrida registrada

Corridas de la rama `feat/t32-t33-accesibilidad-lanzamiento` sobre la pila local (ver `docs/evidence/`):

| Simulacro                   | Resultado                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Incidente (API caída)       | La alerta `ApiDown` llegó al canal ~1 min 50 s después de apagar la API y se resolvió al volver                                    |
| Restauración aislada        | Base restaurada en 5 s (base chica), conteos de 12 tablas iguales, pgTap en la copia, 30 archivos de Storage con el mismo checksum |
| PITR                        | La tabla borrada volvió, con lo escrito antes del error y sin nada posterior al objetivo                                           |
| Vuelta atrás de migraciones | 4 migraciones deshechas y reaplicadas; 1480 aserciones de base antes y después                                                     |
| Despliegue fallido          | Versión sin base: viva pero `/ready` 503; versión sin variable obligatoria: no arranca; la actual sigue sirviendo                  |
| Carga mínima                | 40 comensales simultáneos, 20 s, ~2 000 rps en total, p95 ≤ 35 ms, 0 errores (API de desarrollo, base local)                       |

Estos números prueban que **los mecanismos funcionan**. Los de capacidad (RTO, rps, p95) se vuelven a medir en el entorno de
producción con datos reales antes de firmar.

## 2. Lo que solo cierra una persona (pendiente hasta confirmarlo)

Marcar con fecha y quién. Nada de esto se puede dar por hecho desde el código.

- [ ] **Destino externo de las copias** elegido y configurado (base, WAL y Storage), con credencial de solo escritura y retención
      inmutable (`copias-y-restauracion.md`, «Destino externo»). Restauración repetida **desde ese destino**.
- [ ] **RTO y RPO medidos en producción** con el volumen real y anotados aquí.
- [ ] **Monitor externo** de disponibilidad (fuera del servidor) apuntando a `/ready` de la API y a la web; destino real de las alertas
      (correo/chat) probado con una alerta de prueba; **responsables de guardia** nombrados.
- [ ] **Dominio, DNS y certificados** del entorno real; `CertificateExpiresSoon` sin alertar.
- [ ] **Secretos de producción** cargados en el gestor (nunca los de desarrollo) y con copia aparte: `SUPABASE_JWT_SECRET`,
      `PAYMENT_SECRET_KEY`, pepper de PIN, secretos de Auth, claves VAPID.
- [ ] **Mercado Pago de producción**: credenciales y webhook firmado verificados con un pago real de monto mínimo y su devolución.
- [ ] **WhatsApp (Meta)**: número, plantillas aprobadas y revisión legal por país (Argentina y Chile) — ver `whatsapp.md`. Si no está
      listo, el módulo queda apagado (`WHATSAPP_MODE=off`) y el salón funciona igual.
- [ ] **Notificaciones push reales** probadas en dispositivos (Android y iPhone con la PWA instalada).
- [ ] **Límites de Realtime** fijados en el proyecto real y medidos con el tráfico del piloto (`pwa-y-tiempo-real.md`).
- [ ] **Matriz manual de accesibilidad y dispositivos** completada (`accesibilidad-y-responsive.md`).
- [ ] **Revisión de seguridad humana** de este corte y aceptación explícita de cualquier riesgo residual (lista en la sección 4).

## 3. Piloto controlado

**Alcance:** un (1) negocio, un (1) local, personal capacitado, con el sistema anterior (papel/caja) a mano durante todo el piloto.

1. **Preparación (día -3):** alta del negocio, carta y plano reales, QR impresos, cuentas del personal, pago por Mercado Pago de monto mínimo
   probado, capacitación de 1 h (mozo, cocina/barra, encargado) y ensayo con un servicio simulado.
2. **Día 1–3, horario acotado** (por ejemplo solo cenas): una persona del equipo presente en el local; alertas encendidas; ritual de
   cierre cada noche (ver `cierre-limpieza-y-comprobante.md`) comparando contra la caja física.
3. **Día 4–14, horario completo** si las condiciones de continuidad se cumplen dos días seguidos.
4. **Revisión diaria (15 min):** errores (`ApiErrorRateHigh`), diferencias de caja, pedidos que el mozo tuvo que cargar a mano,
   quejas del personal, alertas del día.

**Criterios para seguir:** ninguna pérdida ni duplicación de dinero; diferencias de caja explicadas; ninguna alerta crítica sin resolver;
el personal puede operar sin ayuda al tercer día.

**Criterios de vuelta atrás (cualquiera):** un cobro duplicado o perdido que no se pueda explicar con el libro; una fuga de datos entre
negocios; una caída de más de 15 minutos en servicio; el personal pide volver al papel.

### Cómo se vuelve atrás

| Qué falló                                | Cómo se vuelve                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un despliegue nuevo (sin migración)      | Coolify → Deployments → **Rollback** a la versión anterior. El `/ready` impide además que una versión que no llega a la base reciba tráfico.                                                                                                                                                                                                    |
| Un despliegue con migración              | Las migraciones son **aditivas** (primero se agrega, la versión nueva y la anterior conviven, recién después se quita). Si la anterior convive: Rollback de la aplicación y **dejar la migración**. Si no convive: Rollback de la aplicación y luego el archivo de `supabase/rollbacks/<migración>.down.sql` (probado con `rollback-drill.ts`). |
| Datos dañados por un error               | Restauración a un punto en el tiempo (`copias-y-restauracion.md`), después de congelar escrituras.                                                                                                                                                                                                                                              |
| Un módulo (mensajes, push, pagos online) | Apagarlo por configuración (`WHATSAPP_MODE=off`, `WEB_PUSH_MODE=off`, sin credenciales de Mercado Pago): el salón, la cocina y la caja siguen.                                                                                                                                                                                                  |
| Todo el piloto                           | Volver al papel/caja anterior, congelar el sistema (solo lectura), conservar la base para revisión.                                                                                                                                                                                                                                             |

Regla de las migraciones: **nunca** una migración que borre o renombre algo que la versión anterior todavía usa. Quitar es una migración
posterior, cuando la versión anterior ya no existe.

## 4. Riesgos conocidos y aceptación

Anotar acá lo que sigue abierto al lanzar, con quién lo acepta:

| Riesgo / pendiente                                                                | Mitigación actual                                                                    | Acepta | Fecha |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ | ----- |
| `script-src 'unsafe-inline'` en la CSP de la web (Next.js)                        | Resto de la CSP cerrado, sin `eval`, sin terceros; pasar a nonces es el próximo paso |        |       |
| Copias sin destino externo confirmado                                             | Procedimiento y simulacros probados; ver sección 2                                   |        |       |
| Un solo servidor (VPS único)                                                      | Copia externa + PITR + monitor externo (sección 2); no hay alta disponibilidad       |        |       |
| Verificación del número del comensal por WhatsApp, Meta real y costos facturables | Módulo apagado por defecto                                                           |        |       |
| Traducción del contenido: la interfaz sigue en español                            | Contenido de la carta multilingüe con borrador y aprobación                          |        |       |

## 5. Firma (Checkpoint 10)

Definición de Terminado completa · sin vulnerabilidades críticas/altas aceptadas sin mitigación · monitoreo externo, copias y responsables de
incidentes activos · autorización del despliegue comercial.

| Verifica                             | Nombre   | Firma | Fecha |
| ------------------------------------ | -------- | ----- | ----- |
| Puertas técnicas (sección 1)         |          |       |       |
| Pendientes cerrados (sección 2)      |          |       |       |
| Piloto concluido (sección 3)         |          |       |       |
| **Autoriza el despliegue comercial** | Valentín |       |       |

_La firma es de una persona. Este documento no se da por firmado hasta que figure la de Valentín._
