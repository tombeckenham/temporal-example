# video-at-scale

App that generates short AI videos from a text prompt:

1. **Better Auth** email OTP sign-in (Postgres / PlanetScale)
2. TanStack Start UI on Cloudflare Workers
3. Temporal workflow enhances the prompt (Grok text), starts Grok Imagine, polls until done
4. Status is pushed to a per-job **Durable Object** (`JobRoom`) over hibernating WebSockets
5. Completed videos are downloaded and stored in **R2** (when the provider URL is fetchable)
6. Edge starts workflows via a Node HTTP gateway (no Temporal gRPC in Workers)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tombeckenham/video-at-scale)

Deploys the **edge Worker** (UI, JobRoom DOs, auth, webhooks, R2). You still need a separate **Node Temporal worker** (e.g. Fly / Docker) and Temporal Cloud + Postgres + secrets — see [Deploy](#deploy).

## Prerequisites

- [Bun](https://bun.sh)
- [Temporal CLI](https://docs.temporal.io/cli) **or** Docker
- [PlanetScale Postgres](https://planetscale.com) (or any Postgres) with a role that can `CREATE` tables
- An [xAI API key](https://console.x.ai)
- Optional: Cloudflare account for deploy + Email Service domain

## Setup

```bash
bun install
cp .env.example .env.local
```

Minimum env (see `.env.example` for the full list):

```bash
DATABASE_URL=postgresql://...@....pg.psdb.cloud:6432/postgres?sslmode=require
BETTER_AUTH_SECRET=   # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
EMAIL_MODE=console
XAI_API_KEY=xai-...
TEMPORAL_STARTER_SECRET=dev-starter-secret-change-me
STATUS_WEBHOOK_SECRET=dev-webhook-secret-change-me
STATUS_WEBHOOK_URL=http://127.0.0.1:3000
TEMPORAL_STARTER_URL=http://127.0.0.1:8788
```

Also put the same auth/DB secrets in `.dev.vars` for the Cloudflare Vite / workerd runtime.

### Database schema

PlanetScale **API** roles (`pscale_api_*`) have `USAGE` on `public` but **not** `CREATE`.  
Create a password with the **admin** role in the [PlanetScale dashboard](https://app.planetscale.com) (Roles → New password → Admin), put that URL in `DATABASE_URL` **without quotes** (and the same value in `.dev.vars` for workerd), then:

```bash
bun run db:migrate
```

Do **not** use `db:push` for this project — migrations under `drizzle/` are the source of truth.

As the default `postgres` role you can also grant your API role DDL:

```sql
GRANT CREATE ON SCHEMA public TO "pscale_api_…";
```

Optional production: Cloudflare **Hyperdrive** in front of PlanetScale (see `wrangler.jsonc` comment).

## Run locally

```bash
bun run dev:all
```

| Process          | Port           | Role                                 |
| ---------------- | -------------- | ------------------------------------ |
| Temporal CLI     | 7233 / UI 8233 | Workflow engine                      |
| Worker + gateway | 8788           | Activities + `POST /workflows/start` |
| Vite / workerd   | 3000           | App + JobRoom DO + auth              |

1. Open [http://localhost:3000/login](http://localhost:3000/login)
2. Enter email → OTP is printed in the **server log** when `EMAIL_MODE=console`
3. Sign in → generate a video

## Deploy

### Edge (Cloudflare Workers)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tombeckenham/video-at-scale)

Or from this repo:

```bash
bun run deploy
```

**Worker (Node)** — Fly.io (`fly.toml`) or Docker:

```bash
docker build -f Dockerfile.worker -t video-at-scale-worker .
# or: fly launch && fly secrets set ... && fly deploy
```

Env for the Node worker: `XAI_API_KEY`, Temporal Cloud address/namespace/auth, `TEMPORAL_STARTER_SECRET`, `STATUS_WEBHOOK_URL`, `STATUS_WEBHOOK_SECRET`.

Gateway rate limit: `TEMPORAL_START_RATE_MAX` (default 30 starts/minute per process).

**Edge secrets** (`wrangler secret put`):

- `DATABASE_URL` (or Hyperdrive)
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `TEMPORAL_STARTER_URL`, `TEMPORAL_STARTER_SECRET`
- `STATUS_WEBHOOK_SECRET`
- `EMAIL_FROM` (and set `EMAIL_MODE=cf` once Email Service domain is onboarded)

## Architecture

```
Browser ──WS──► JobRoom DO (per workflowId)
Browser ──HTTP► TanStack Start + Better Auth ──HTTP► Node gateway ──gRPC► Temporal
                         │                                    │
                    PlanetScale PG                      Worker process
                    (users / sessions)            workflows + activities
                                                          │
                                           publishStatus ──► JobRoom
                                           persistVideo  ──► R2 via edge
                                           TanStack AI ──► xAI
```

## E2E

```bash
bun run test:e2e          # Docker Postgres per worktree + AIMock + Playwright
# bun run test:e2e:ps     # PlanetScale branch (needs pscale + PLANETSCALE_*)
```

Requires Docker (local default). Provisions an isolated Postgres, migrates this
checkout’s schema, signs in with a DEV-only fixed OTP, runs the full path
(auth → job index → Temporal → AIMock → JobRoom). Isolated from local dev:

|                  | Dev                | E2E                    |
| ---------------- | ------------------ | ---------------------- |
| App              | `:3000`            | `:3100`                |
| Temporal gateway | `:8788`            | `:8789`                |
| Task queue       | `video-generation` | `video-generation-e2e` |

Your `bun run worker` is left running. CI: `E2E_DB_BACKEND=planetscale` (or
`test:e2e:ps`) with PlanetScale tokens; each run creates/deletes an `e2e-ci-*`
branch.

## Notes

- Temporal Cloud is optional locally (`localhost:7233` is enough).
- R2 persist skips gracefully if the provider URL is not downloadable (e.g. AIMock placeholder URLs).
- Live job status is on Durable Objects, not Postgres.
