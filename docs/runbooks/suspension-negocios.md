# Suspensión de negocios

## Modos

La suspensión siempre la solicita un Superadmin autenticado con AAL2, exige un
motivo de 3 a 500 caracteres y genera un evento de auditoría con correlación.

### Comercial gradual

1. El negocio pasa a `commercial_draining` y conserva `tenant.status = active`.
2. `private.can_open_table_session(tenant_id)` devuelve `false`, por lo que no
   se admiten mesas nuevas.
3. Las mesas abiertas y el personal continúan operando para finalizar el
   servicio.
4. Cuando el módulo de mesas confirme que no quedan sesiones abiertas, su
   trigger llama `private.complete_commercial_suspension(tenant_id)`.
5. El negocio pasa a `suspended` y se registra
   `tenant.suspension_completed`.

La función de finalización no está concedida a `authenticator`, al navegador ni
a identidades autenticadas. La conexión automática con el cierre de la última
mesa se incorpora en T16, cuando exista esa entidad; no puede adelantarse desde
la API enviando un contador manipulable.

### Seguridad inmediata

El negocio y su registro de suspensión pasan a `suspended` en la misma
transacción. También se revocan todas las sesiones activas del personal. Este
modo se reserva para compromiso de credenciales, fraude o riesgo grave.

Una suspensión terminal no puede degradarse a `commercial_draining`. La futura
reactivación debe tener un flujo explícito, autorización propia y auditoría; no
se reutiliza el endpoint de suspensión.

## API de plataforma

| Método | Ruta                                         | Acción                                            |
| ------ | -------------------------------------------- | ------------------------------------------------- |
| `GET`  | `/v1/platform/operations`                    | Lista negocios y los últimos 50 eventos sensibles |
| `POST` | `/v1/platform/tenants/{tenantId}/suspension` | Solicita suspensión comercial o de seguridad      |

El `POST` acepta exclusivamente:

```json
{
  "mode": "commercial",
  "reason": "Vencimiento de la suscripción"
}
```

La identidad y el identificador de correlación se derivan de la sesión y la
solicitud HTTP. La respuesta comercial informa `commercial_draining`; la de
seguridad informa `suspended`.

## Panel y auditoría

El panel Superadmin muestra:

- estado de cada negocio;
- `Cerrando mesas` para la suspensión comercial en curso;
- una explicación diferente para los modos comercial y seguridad;
- confirmación explícita antes de enviar;
- los últimos 50 eventos con fecha, negocio, acción, motivo y correlación.

El historial no incluye tokens, secretos, PIN, claves de API ni datos completos
de pago. La consulta está limitada a 100 registros en base y a 50 desde la API.

## Verificación

- La política pura cubre drenaje, finalización, bloqueo inmediato y contadores
  inválidos.
- pgTAP cubre 21 casos de suspensión y 10 de listado/autorización.
- La API cubre autenticación, rol Superadmin, normalización y rechazo de campos
  extra.
- El panel fue inspeccionado con render real, estructura accesible y estados de
  negocio e historial visibles.
