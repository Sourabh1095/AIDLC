---
name: docker
description: Docker conventions — multi-stage builds for Node/Next.js/NestJS, compose-based dev environments, image hygiene and container security basics. Load when writing or reviewing Dockerfiles, compose files or containerization work.
user-invocable: false
---

# Docker — conventions

## Dockerfile (Node services — Nest, Next)

Multi-stage, always:

```dockerfile
FROM node:22-alpine AS deps            # pin at least minor; match .nvmrc
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
# (prefer `npm ci --omit=dev` in a separate prod-deps stage when dev deps are heavy)
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

- Next.js: `output: "standalone"` in next.config and copy `.next/standalone` — not the whole build context.
- `.dockerignore` mirrors `.gitignore` + `node_modules`, `.git`, `.env*`, `.next`, `dist` — a
  missing .dockerignore is a review finding (cache-busting + secret-leak risk).
- Layer order = change frequency: manifests → install → source → build. `COPY . .` before
  `npm ci` destroys caching.
- No secrets in ENV/ARG/layers — runtime env injection only; build-time secrets via BuildKit
  `--mount=type=secret` if truly needed.
- `HEALTHCHECK` on services; exact-version base images; alpine or distroless unless a native
  dep forces glibc.

## Compose (local dev)

- One `docker-compose.yml` giving a new dev the full stack in one command: app(s) + postgres +
  mongo + anything else, with named volumes for data, healthchecks, and `depends_on:
  condition: service_healthy` (not sleeps).
- Dev credentials are throwaway-obvious (`postgres/postgres`) and still not real secrets;
  ports bound to localhost.
- App code bind-mounted for hot reload in dev variants (`docker-compose.override.yml`),
  node_modules in an anonymous volume to avoid host clobbering.

## Review checklist

Multi-stage? · non-root USER? · .dockerignore present/complete? · layers ordered for cache? ·
versions pinned? · no secrets baked in? · healthcheck? · compose up works from clean clone
(verify: `docker compose up --build` + hit the health endpoint)?
