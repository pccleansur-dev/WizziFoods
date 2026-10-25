# Entrada por QR (T16)

El comensal escanea el QR de su mesa y llega a `https://<dominio-del-negocio>/m/<token>`.
La página pregunta a la API qué significa ese código **ahora** y muestra lo que puede hacer
o por qué no puede.

## Qué resuelve

`POST /v1/public/table-entry` con cuerpo `{ "token": "<64 hex>" }`.

- El token viaja en el cuerpo, no en la URL de la API, para que no quede en los logs de acceso.
- El tenant y la ubicación salen sólo del dominio (`TenantHostGuard`); un token de otro
  negocio no resuelve.
- Un token desconocido, rotado, de una mesa retirada o malformado responde igual:
  `{ "data": { "status": "invalid" } }`. Un cuerpo con otros campos devuelve 400.
- Un dominio inexistente o de un negocio suspendido responde 404 y la página muestra
  «Local no disponible», sin distinguir un caso del otro.
- La respuesta nunca incluye el token ni ids internos.

La función SQL es `private.resolve_table_entry` (migración
`20261024070000_resolve_table_entry.sql`, rollback en `supabase/rollbacks`, pgTap
`table_entry.test.sql`). Reutiliza `private.resolve_floor_table_qr` y agrega la planta, el
estado de servicio, si el negocio está publicado y si acepta mesas nuevas
(`private.can_open_table_session`).

## Estado de la mesa

`private.floor_table_service_states` guarda `occupied`, `needs_cleaning` o `out_of_service`.
**Una mesa sin fila está disponible.** T16 sólo lee esta tabla; quien la escribirá es la
operación del salón (T19), la sesión de mesa (T22) y el cierre/limpieza (T26, ya implementado: `cierre-limpieza-y-comprobante.md`).

| Situación                                     | Modo          | ¿Confirma pedido? | Mensaje                                        |
| --------------------------------------------- | ------------- | ----------------- | ---------------------------------------------- |
| Disponible                                    | `start`       | Sí                | «La mesa está lista…»                          |
| Ocupada                                       | `join`        | Sí                | «Tu mesa ya está abierta: te sumás al pedido»  |
| Pendiente de limpieza                         | `view_only`   | No                | Puede ver la carta y llamar al mozo            |
| Fuera de servicio                             | `view_only`   | No                | Ídem; el mozo lo ayuda a sentarse en otra mesa |
| Disponible, con suspensión comercial en curso | `view_only`   | No                | «Por hoy el local no abre mesas nuevas»        |
| Ocupada, con suspensión comercial en curso    | `join`        | Sí                | La mesa abierta puede terminar su servicio     |
| Negocio sin publicar                          | `unavailable` | —                 | «Este local aún no está abierto»               |

## Grupos

Las mesas de un grupo siguen siendo mesas distintas, pero comparten estado: si **alguna**
está ocupada, el resto entra como `join`; una mesa que no se puede usar conserva su propio
estado (pendiente de limpieza o fuera de servicio) aunque su vecina esté ocupada. El
comensal ve «Estás en <grupo> (mesas X y Y)». La respuesta lleva el nombre del grupo y las
etiquetas de sus mesas, no su id.

**Todavía no existe la sesión de mesa** (T22). `join` sólo informa que corresponde unirse a
la sesión abierta; hasta T22 no se une a nada. Cuando exista, la sesión deberá colgar de
`group.id` si hay grupo y de la mesa si no.

## Agrupación cambiada

La página recalcula el grupo en cada carga y, mientras sigue visible, vuelve a preguntarlo
cada 15 segundos y al volver a la pestaña (`EntryRefresh`); no guarda nada en el
dispositivo. Así si el grupo se arma, se separa o la
mesa se retira, el comensal ve el estado vigente; si el QR se rotó o la mesa se retiró,
ve «No reconocemos este código» y la indicación de pedir uno nuevo al personal. No hay
sesión viva que migrar: unir o separar mesas con una cuenta abierta cambia qué mesas cubre la
sesión, nunca mueve deuda ni pedidos, y el personal elige la mesa ancla al separar (T27, ver
`unir-y-separar-mesas.md`). Todos los QR del grupo leen el grupo vigente en cada escaneo.

## Qué no hace T16

- No hay carta pública navegable, borrador de pedido ni llamado al mozo (T17–T19): la
  página lista lo que el comensal podrá hacer.
- **La regla «no agrupar mesas con cuentas abiertas distintas»** la aplican T27 (al unir en el
  servicio, `PT278`) y el editor del plano (no puede romper los grupos de una cuenta abierta,
  `PT280`).
- No hay límite de tasa para probar tokens; con 256 bits de entropía no es adivinable, pero
  conviene un límite por IP en T33.

## Verificación

- pgTap con dos tenants: `supabase/tests/database/table_entry.test.sql` (11 aserciones).
- Unitarias: repositorio, servicio, controlador, parser y vista.
- Integración HTTP contra Postgres local con dos tenants
  (`local-table-entry.integration.test.ts`, 10 casos: todos los estados, grupo, token
  ajeno/desconocido/malformado, host inexistente, cierre comercial, sin publicar y
  suspendido). Se corre con `DATABASE_URL`, `DATABASE_ADMIN_URL`, `SUPABASE_URL` y
  `SUPABASE_SECRET_KEY` locales; sin ellos se omite.
- E2E con Playwright (`pnpm e2e`, carpeta `e2e/`): 8 recorridos en móvil (375 px) y en
  escritorio, escaneo simulado abriendo la URL del QR. Requiere `pnpm infra:up`; levanta
  la API (3101) y la web (3100) por su cuenta sin tocar la demo, siembra dos negocios
  `e2e-*` y los borra al terminar. No corre en CI todavía (no hay Supabase local ahí).
- Navegador real (escritorio y 375 px; cambiar el estado en la base con la página abierta
  la actualiza sola) contra un negocio de prueba temporal con mesa
  libre, mesa agrupada con la vecina ocupada, pendiente de limpieza, fuera de servicio,
  token desconocido, dominio inexistente y token de otro negocio.
