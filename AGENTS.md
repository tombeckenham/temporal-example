# AGENTS.md — temporal-example

Guidance for coding agents working in this repo.

## What this project is

A **minimal AI video generation demo** that teaches **Temporal workflows** on **Cloudflare**:

1. User submits a prompt in a TanStack Start UI (Workers)
2. Edge starts a Temporal workflow via the **Node HTTP gateway** (not gRPC in-isolate)
3. Workflow optionally **enhances the prompt** (TanStack AI + Grok text)
4. Workflow **starts** a Grok Imagine video job (async)
5. Workflow **durably polls** until the video is ready (`sleep` + activity)
6. Activities **publish status** to a Cloudflare **JobRoom Durable Object** (HMAC webhook)
7. UI receives **real-time updates over WebSocket** (hibernating DO sockets)

Stack:

| Layer | Tech |
| --- | --- |
| App | TanStack Start + Cloudflare Vite plugin (Workers) |
| Real-time | Durable Objects (`JobRoom`) + WebSocket hibernation |
| AI | TanStack AI (`@tanstack/ai`, `@tanstack/ai-grok`, `@tanstack/ai-persistence`) |
| Video engine | Grok Imagine via xAI API |
| Orchestration | Temporal TypeScript SDK + **Temporal Cloud** (or local for dev) |
| Worker host | **Node process** (not CF Workers) — Fly/Render/local |
| Package manager | Bun |

## Commands

```bash
bun install

# All three processes (preferred for local)
bun run dev:all               # temporal:dev + worker (gateway :8788) + vite :3000

# Or separately:
bun run temporal:dev          # Temporal CLI (or: temporal:docker)
bun run worker                # workflows + activities + HTTP gateway
bun run dev                   # http://localhost:3000 (workerd via CF vite plugin)

bun run build && bun run deploy   # Cloudflare Workers
bun run cf-typegen                # regenerate Worker Env types

# E2E (CopilotKit AIMock — no real xAI key)
bun run test:e2e
```

Typecheck: `bun run typecheck` (`tsc --noEmit`).

E2E uses `@copilotkit/aimock` to mock Grok chat + Imagine video. Activities honor
`XAI_BASE_URL` so the worker talks to AIMock instead of `api.x.ai`.


## Environment

`.env.local` (gitignored via `*.local`) + `.dev.vars` for workerd:

```bash
XAI_API_KEY=xai-...
DATABASE_URL=postgresql://...@....pg.psdb.cloud:6432/postgres?sslmode=require
BETTER_AUTH_SECRET=...        # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
EMAIL_MODE=console
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default

# Edge → Node Temporal gateway
TEMPORAL_STARTER_SECRET=...
TEMPORAL_STARTER_URL=http://127.0.0.1:8788

# Node → JobRoom status push
STATUS_WEBHOOK_URL=http://127.0.0.1:3000
STATUS_WEBHOOK_SECRET=...

# Temporal Cloud (optional):
# TEMPORAL_API_KEY=...
# TEMPORAL_TLS_CERT_PATH=...
# TEMPORAL_TLS_KEY_PATH=...
```

Wrangler secrets for production: `DATABASE_URL`, `BETTER_AUTH_*`, `STATUS_WEBHOOK_SECRET`, `TEMPORAL_STARTER_URL`, `TEMPORAL_STARTER_SECRET`.

Never put `XAI_API_KEY` in client code. Only activities / Node worker may call xAI.

Schema: `bun run db:push` (needs PlanetScale role with CREATE on `public`).

## Project layout

```
src/
  server.ts               # CF Worker entry (WS + webhooks + TanStack)
  durable-objects/
    JobRoom.ts            # Per-workflow status + WS hibernation (+ AI run storage)
  server/
    video.ts              # createServerFn: start via Temporal gateway
    jobs.ts               # listMyJobs + Postgres video_job sync
    jobEvents.ts          # HMAC webhook + WS routing
    videos.ts             # R2 persist + GET
    internalAuth.ts       # HMAC sign/verify
  auth/                   # Better Auth email OTP
  routes/                 # TanStack Router UI
  temporal/
    types.ts              # Shared types + TASK_QUEUE (workflow-safe)
    client.ts             # Temporal Client (Node only)
    gateway.ts            # HTTP starter for the edge
    worker.ts             # Worker + gateway entrypoint
    workflows/            # Deterministic workflow code only
    activities/           # Node I/O: TanStack AI, xAI, publishStatus, persistVideo
  persistence/
    jobRoomAdapter.ts     # TanStack AI generation store → JobRoom DO
  db/                     # Drizzle + Postgres (Better Auth + video_job index)
wrangler.jsonc
fly.toml                  # Node worker deploy (Fly.io)
Dockerfile.worker
```

## Architecture rules (scale)

- **1 JobRoom DO per `workflowId`** — never a global status hub
- **Clients do not poll Temporal** — WebSocket + optional `GET /api/jobs/:id`
- **D1 is not the live status path** — optional secondary indexes only
- **Temporal workers never run on CF Workers** — long-lived Node + gRPC
- **Edge never imports `@temporalio/*`** — HTTP gateway only
- **xAI is poll-based today** — durable poll stays in the workflow; edge gets push via webhook

## Temporal mental model (keep this clear)

- **Workflows** (`src/temporal/workflows/`):
  - Must be **deterministic** (no `fetch`, no `Date.now()`, no random, no Node APIs)
  - Orchestrate activities with `proxyActivities`, `sleep`, queries/signals
  - Survive process restarts via event history replay

- **Activities** (`src/temporal/activities/`):
  - May do anything Node can do (HTTP, TanStack AI, disk)
  - Keep them **short** (one HTTP call). Poll loops belong in the **workflow** with `sleep`
  - `publishStatus` projects state to JobRoom for the UI

- **Queries** (`statusQuery`):
  - Ops / Temporal UI; product UI uses JobRoom

- **Worker**:
  - Separate long-lived process (`bun run worker`)
  - Also serves Temporal HTTP gateway on `:8788`

- **Client** (edge server functions):
  - `fetch` to gateway `POST /workflows/start` only

Task queue name: `video-generation` (`TASK_QUEUE` in `types.ts`).

## TanStack AI usage

- Text: `chat({ adapter: grokText('grok-4.3'), stream: false, ... })`
- Video start: `generateVideo({ adapter: grokVideo('grok-imagine-video'), ... })`
- Video poll: `getVideoJobStatus({ adapter, jobId })`
- Persistence: JobRoom-backed generation store (`src/persistence/jobRoomAdapter.ts`)
- Env: `XAI_API_KEY` (xAI / SpaceXAI API)

Prefer Grok / xAI for AI features in this repo (see build-with-ai skill).

## Coding conventions

- **No `any`**, no `as any`, no `@ts-ignore` / `@ts-nocheck`
- Prefer `unknown` + narrowing; no non-null assertions (`!`) unless unavoidable
- `tsconfig` is max-strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.)
- Don't add fallback code that hides failures — surface errors
- Prefer existing helpers; avoid duplication
- Frontend: inline skeleton/loading UI in the component (no separate skeleton files)
- Don't add large test suites for demos; cover critical paths only if needed
- Check if localhost is already running before starting `bun dev`
- Typecheck: `bun run typecheck` (or `bun tsgo --noEmit` if available)

## Common pitfalls

1. **Worker not running** → workflows stay in Running with no progress
2. **Temporal server down** → gateway fails connecting to `:7233`
3. **Gateway secret mismatch** → edge start returns 401
4. **STATUS_WEBHOOK_URL wrong** → UI WS stays on initial status (workflow still works)
5. **Importing activities into workflows** → only `import type` from activities in workflow code
6. **Long sleep inside an activity** → use workflow `sleep` instead
7. **Video URLs expire** → provider-hosted; R2 persistence is the durable path
8. **Workflow bundling** → workflows must not import Node-only modules
9. **Putting live job status in D1** → write hotspot; use JobRoom DO

## Where to look

- Workflow orchestration: `src/temporal/workflows/generateVideoWorkflow.ts`
- Activities (AI + publish): `src/temporal/activities/`
- Start API: `src/server/video.ts`
- JobRoom DO: `src/durable-objects/JobRoom.ts`
- Worker entry: `src/server.ts`
- UI: `src/routes/index.tsx`
- Temporal UI (local): http://localhost:8233
