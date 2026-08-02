---
name: docker
description: Docker conventions — multi-stage builds for Node/Next.js/NestJS, compose-based dev environments, image hygiene, container security basics, and running the CI image locally to reproduce a red pipeline. Load when writing or reviewing Dockerfiles or compose files, when a change touches how the app is built or run, or when reproducing a CI failure that won't reproduce in your workspace.
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

## The CI image as a debugging tool

Containers here are not only a delivery artifact — they are how you reproduce a CI failure that won't
reproduce in your workspace (`aidlc:ci-cd` → *Diagnosis protocol* step 4, F31). Run the **same image
CI runs**, and replicate the CI *layout* rather than mounting your whole workspace: an **isolated
single-repo checkout** plus a lockfile install, then the failing step.

```bash
docker run --rm -v "$PWD":/w -w /w node:22 sh -c 'npm ci && npm run lint'
```

Two uses that pay for themselves: regenerating a `package-lock.json` in the Linux context CI uses
(F29), and proving a cross-repo dependency resolves under isolated checkout (F28). Pin the image to
the tag CI pins — reproducing against `node:latest` reproduces a different environment. The full
recipes are `aidlc-stack-web:ci-web`.

## Review checklist

Multi-stage? · non-root USER? · .dockerignore present/complete? · layers ordered for cache? ·
versions pinned? · no secrets baked in? · healthcheck? · compose up works from clean clone
(verify: `docker compose up --build` + hit the health endpoint)?
