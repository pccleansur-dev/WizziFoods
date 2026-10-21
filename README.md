# La plataforma

Base técnica para una plataforma gastronómica multitenant. El producto se encuentra en construcción; las decisiones funcionales viven en `PLAN-PRODUCTO.md` y el orden de implementación en `tasks/`.

## Componentes

- `apps/web`: interfaz web/PWA en Next.js.
- `apps/api`: API REST en NestJS con Fastify.
- `apps/worker`: procesos asincrónicos fuera del ciclo HTTP.
- `packages/contracts`: contratos TypeScript compartidos.
- `packages/config`: lectura y validación estricta de configuración.
- `packages/observability`: logs, métricas y trazas compartidas.
- `packages/infra`: preparación reproducible de infraestructura local.
- `infra/supabase`: composición oficial fijada de Supabase autoalojado.

## Requisitos de desarrollo

- Node.js 24.x.
- pnpm 11.25.0, administrado mediante Corepack.
- Docker Desktop con Docker Compose. Supabase recomienda al menos 4 GB de RAM
  (8 GB para una experiencia cómoda).

## Primer inicio

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

Para levantar Supabase por primera vez:

```powershell
pnpm infra:up
```

El comando crea `infra/supabase/.env` con secretos locales aleatorios si aún no
existe y luego espera a que todos los servicios estén saludables. No sobrescribe
una configuración existente.

Servicios durante el desarrollo:

- Web: `http://localhost:3000`.
- API: `http://localhost:3001`.
- Salud de API: `http://localhost:3001/health`.
- Supabase Studio y gateway local: `http://localhost:18000`.
- PostgreSQL local: `localhost:54322`.
- Métricas web: `http://localhost:9466/metrics`.
- Métricas API: `http://localhost:9464/metrics`.
- Métricas worker: `http://localhost:9465/metrics`.

Los comandos operativos y la separación entre secretos locales y de producción
están documentados en `docs/runbooks/desarrollo-local.md`. La correlación,
privacidad de logs y diagnóstico están en `docs/runbooks/observabilidad.md`.

## Controles obligatorios

```powershell
pnpm ci:check
pnpm audit --prod --audit-level high
```

`ci:check` valida formato, lint, tipos, pruebas, build y secretos. GitHub Actions
ejecuta además la auditoría de dependencias en cada push y pull request.

Ningún archivo `.env`, clave, token o certificado se versiona. `.env.example`
contiene únicamente nombres y valores locales no sensibles. La configuración se
valida al iniciar cada servicio y una variable obligatoria ausente impide el
arranque.
