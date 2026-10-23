# Soporte temporal

## Regla de acceso

El equipo de la plataforma no obtiene acceso operativo permanente a los
negocios. Un Administrador del tenant debe autorizar explícitamente a una
identidad de Superadmin para una intervención concreta.

Cada autorización:

- pertenece al tenant resuelto desde la sesión y el dominio;
- identifica a la persona de soporte autorizada;
- exige un motivo visible;
- dura entre 15 minutos y 4 horas;
- puede revocarse inmediatamente;
- registra alta y revocación en la auditoría append-only.

El cuerpo de la solicitud no acepta `tenantId`, `grantedBy` ni otros campos de
autoridad. Esos valores se derivan exclusivamente del contexto validado por los
guards de autenticación, dominio y membresía.

## API del Administrador

Todas las rutas requieren sesión AAL2 y coincidencia entre identidad, membresía
y host:

| Método   | Ruta                                  | Acción                        |
| -------- | ------------------------------------- | ----------------------------- |
| `GET`    | `/v1/tenant/support-access`           | Ver autorización y estado     |
| `POST`   | `/v1/tenant/support-access`           | Autorizar acceso temporal     |
| `DELETE` | `/v1/tenant/support-access/{grantId}` | Revocar acceso inmediatamente |

El alta recibe únicamente `supportUserId`, `durationMinutes` y `reason`. La
revocación recibe únicamente `reason`.

## Estados

- `active`: la identidad autorizada puede resolver el grant hasta su
  vencimiento.
- `expired`: el plazo terminó y el acceso deja de resolverse automáticamente.
- `revoked`: el Administrador lo terminó antes del vencimiento.

Una nueva autorización para el mismo tenant y la misma persona de soporte
reactiva el registro corriente, mientras que el historial anterior permanece
en auditoría.

## Superficie actual

La base y la API aplican la política completa. Los estados se consultan con
`GET /v1/tenant/support-access`; el historial Superadmin muestra las altas y
revocaciones sin exponer secretos. Los controles específicos del Administrador
se incorporarán junto con el área de equipo de T14, reutilizando estas rutas y
sin cambiar el modelo de autorización.
