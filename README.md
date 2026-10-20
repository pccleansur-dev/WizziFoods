# La plataforma

Base técnica para una plataforma gastronómica multitenant. El producto se encuentra en construcción; las decisiones funcionales viven en `PLAN-PRODUCTO.md` y el orden de implementación en `tasks/`.

## Componentes

- `apps/web`: interfaz web/PWA en Next.js.
- `apps/api`: API REST en NestJS con Fastify.
- `apps/worker`: procesos asincrónicos fuera del ciclo HTTP.
- `packages/contracts`: contratos TypeScript compartidos.

## Requisitos de desarrollo

- Node.js 24.x.
- pnpm 11.25.0, administrado mediante Corepack.
- Docker y Docker Compose para la próxima etapa de Supabase local.

## Primer inicio

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

Servicios durante el desarrollo:

- Web: `http://localhost:3000`.
- API: `http://localhost:3001`.
- Salud de API: `http://localhost:3001/health`.

## Controles obligatorios

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Ningún archivo `.env`, clave, token o certificado se versiona. `.env.example` contiene únicamente nombres y valores locales no sensibles.
