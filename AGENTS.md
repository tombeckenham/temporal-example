<!-- intent-skills:start -->

## Skill Loading

Before editing files for a substantial task:

- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

# AGENTS.md — video-at-scale

Guidance for coding agents working in this repo.

## What this project is

**video-at-scale** — AI video generation with durable Temporal workflows on **Cloudflare**:

1. User submits a prompt in a TanStack Start UI (Workers)
2. Edge starts a Temporal workflow via the **Node HTTP gateway** (not gRPC in-isolate)
3. Workflow optionally **enhances the prompt** (TanStack AI + Grok text)
4. Workflow **starts** a Grok Imagine video job (async)
5. Workflow **durably polls** until the video is ready (`sleep` + activity)
6. Activities **publish status** to a Cloudflare **JobRoom Durable Object** (HMAC webhook)
7. UI receives **real-time updates over WebSocket** (hibernating DO sockets)

| Layer           | Tech                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| App             | TanStack Start + Cloudflare Vite plugin (Workers)                             |
| Real-time       | Durable Objects (`JobRoom`) + WebSocket hibernation                           |
| AI              | TanStack AI (`@tanstack/ai`, `@tanstack/ai-grok`, `@tanstack/ai-persistence`) |
| Video engine    | Grok Imagine via xAI API                                                      |
| Orchestration   | Temporal TypeScript SDK + **Temporal Cloud** (or local for dev)               |
| Worker host     | **Node process** (not CF Workers) — Fly/Render/local                          |
| Package manager | Bun (launcher); Node is the Temporal worker runtime                           |

**Critical facts (do not invent alternatives):**

- **1 JobRoom DO per `workflowId`** — never a global status hub
- **Product UI does not poll Temporal** — WebSocket + optional job list APIs
- **Postgres is an index / auth store**, not the live status path
- **Temporal workers never run on CF Workers** — long-lived Node + gRPC
- **Edge never imports `@temporalio/*`** — HTTP gateway only
- **Provider video URLs expire** — R2 persistence is the durable path
- **`XAI_API_KEY` never goes in client code** — activities / Node worker only

## Setup / first run

Local loop always needs **three processes**: Temporal server, Node worker (+ gateway `:8788`), Vite/Workerd (`:3000`).

```bash
bun install
# Copy secrets into .env.local + .dev.vars (see Environment)
bun run db:migrate
bun run dev:all          # temporal:dev + worker + vite
# App: http://localhost:3000 · Temporal UI: http://localhost:8233
```

Before starting anything: check whether `:3000`, `:8788`, or `:7233` are already up — do not stack duplicate dev servers.

## Commands

```bash
# Dev
bun run dev:all               # temporal:dev + worker (gateway :8788) + vite :3000
bun run temporal:dev          # local Temporal (or: temporal:docker)
bun run worker                # workflows + activities + HTTP gateway
bun run dev                   # http://localhost:3000 (Workerd via CF vite plugin)

# Quality
bun run typecheck             # TypeScript 7 native tsc --noEmit
bun run lint                  # oxlint
bun run format                # oxfmt write + oxlint --fix
bun run check                 # oxfmt --check

# DB (Postgres / PlanetScale via Drizzle — not D1)
bun run db:generate           # migration from schema edits
bun run db:migrate            # apply (needs CREATE on public)
bun run db:studio
# NEVER bun run db:push against shared/prod DBs

# E2E (Playwright + AIMock + isolated Postgres — no real xAI key)
bun run test:e2e            # Docker Postgres per worktree (default)
bun run test:e2e:ui
bun run test:e2e:ps         # PlanetScale ephemeral/worktree branch

# Build / deploy
bun run build                 # Vite production build (NOT `bun build`)
bun run deploy                # build + wrangler deploy (edge Worker only)
bun run cf-typegen            # regenerate Worker Env types
# Node Temporal worker: fly.toml / Dockerfile.worker (or CI on main)
```

**CI deploy (push / workflow_dispatch on `main`):** after `checks` + `migrate`, parallel
`deploy-edge` (Cloudflare) and `deploy-worker` (Fly). Only GitHub secret:
`DOPPLER_TOKEN`. Deploy + app secrets live in Doppler `video-at-scale` / `prd`
(`CLOUDFLARE_*`, `FLY_API_TOKEN`, etc.). Platform runtime secrets still projected
to wrangler/fly for process runtime.

**Anti-commands:** do not use `bun build` for the app; do not use `db:push` on shared DBs; do not run Temporal inside the Worker isolate.

Typecheck uses TypeScript 7 native `tsc`. Lint/format uses oxlint + oxfmt (not ESLint/Prettier).

## Environment

`.env.local` (gitignored via `*.local`) for Node worker + scripts; `.dev.vars` for Workerd bindings/secrets.

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

# Node → JobRoom status push (Workerd origin in local dev)
STATUS_WEBHOOK_URL=http://127.0.0.1:3000
STATUS_WEBHOOK_SECRET=...

# Temporal Cloud (optional):
# TEMPORAL_API_KEY=...
# TEMPORAL_TLS_CERT_PATH=...
# TEMPORAL_TLS_KEY_PATH=...
```

Wrangler secrets for production edge: `DATABASE_URL`, `BETTER_AUTH_*`, `STATUS_WEBHOOK_SECRET`, `TEMPORAL_STARTER_URL`, `TEMPORAL_STARTER_SECRET`.

`XAI_API_KEY` lives on the **Node worker** (Fly/local), not in client bundles. E2E points the worker at AIMock via `XAI_BASE_URL`. App e2e uses a worktree-local Docker Postgres (or PlanetScale branch in CI), not a shared long-lived test DB.

## Project layout

```
src/
  server.ts               # CF Worker entry (WS + webhooks + TanStack)
  durable-objects/
    JobRoom.ts            # Per-workflow status + WS hibernation (+ AI run storage)
  lib/
    video.ts              # createServerFn: start via Temporal gateway
    jobs.ts               # listMyJobsFn + scoped job reads
    jobSync.ts            # unscoped job writes for internal webhook
    jobEvents.ts          # HMAC webhook → JobRoom
    videos.ts             # R2 persist + GET
    internalAuth.ts       # HMAC sign/verify
    middleware.ts         # authMiddleware, jobOwnerMiddleware, scopedDb
    requestScope.ts       # per-request DB/auth scope (Workers)
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
    scoped/               # user-scoped queries (only path handlers should use)
e2e/                      # Playwright
wrangler.jsonc
fly.toml                  # Node worker deploy (Fly.io)
Dockerfile.worker
```

## Architecture rules (scale)

- **1 JobRoom DO per `workflowId`** — never a global status hub
- **Clients do not poll Temporal** — WebSocket + optional list/status server fns
- **Live status is not Postgres** — optional secondary index via `jobSync` only
- **Temporal workers never run on CF Workers** — long-lived Node + gRPC
- **Edge never imports `@temporalio/*`** — `fetch` to gateway only
- **xAI is poll-based today** — durable poll stays in the workflow; edge gets push via webhook

## Temporal mental model

- **Workflows** (`src/temporal/workflows/`):
  - Must be **deterministic** (no `fetch`, no `Date.now()`, no random, no Node APIs)
  - Orchestrate with `proxyActivities`, `sleep`, queries/signals
  - Survive restarts via event history replay
  - **Only `import type`** from activities — value imports break the workflow bundle

- **Activities** (`src/temporal/activities/`):
  - May do anything Node can do (HTTP, TanStack AI, disk)
  - Keep them **short** (one HTTP call). Poll loops belong in the **workflow** with `sleep`
  - `publishStatus` projects state to JobRoom for the UI

- **Queries** (`statusQuery`): ops / Temporal UI; product UI uses JobRoom

- **Worker** (`bun run worker`): polls Temporal + serves HTTP gateway on `:8788`

- **Edge client**: `POST /workflows/start` with `Authorization: Bearer $TEMPORAL_STARTER_SECRET` only

Task queue: `video-generation` (`TASK_QUEUE` in `types.ts`).

## Patterns

### Start a video job (edge server fn)

Steps: validate · auth middleware · optional Postgres index row · gateway start · surface errors.

```typescript
// src/lib/video.ts (shape)
export const startVideoWorkflowFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(generateVideoInputSchema)
  .handler(async ({ data, context }) => {
    const workflowId = newId()
    await context.scopedDb.jobs.create({ workflowId, prompt: data.prompt })

    const response = await starterFetch('/workflows/start', {
      method: 'POST',
      body: JSON.stringify({
        workflowId,
        prompt: data.prompt,
        duration: data.duration,
        size: data.size,
        enhancePrompt: data.enhancePrompt,
      }),
    })
    if (!response.ok) {
      await context.scopedDb.jobs.markFailed(workflowId)
      throw new Error(`Failed to start workflow (${response.status})`)
    }
    return { workflowId: (await response.json()).workflowId }
  })
```

### Workflow (deterministic) + project status

```typescript
// import type only — never value-import activities
import type * as activities from '../activities/index.ts'

const { enhancePrompt, startVideoJob, pollVideoJob, persistVideo } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes' /* … */,
  })

const { publishStatus } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  /* status publishes get their own retry policy */
})

// Poll in the workflow, not inside an activity:
await sleep('5 seconds')
const result = await pollVideoJob(jobId)
```

### Activity → JobRoom (status push)

```typescript
// publishStatus activity → POST $STATUS_WEBHOOK_URL/internal/job-events
// HMAC: X-Signature: hex(hmac-sha256(body, STATUS_WEBHOOK_SECRET))
// handleJobEvents verifies → routes to JobRoom DO by workflowId → WS broadcast
```

### JobRoom

- DO id / name keyed by **`workflowId`**
- Hibernating WebSockets for UI
- Accepts status from internal webhook only (HMAC), not from untrusted clients

## Wiring checklists

### New Temporal activity

1. Implement in `src/temporal/activities/`
2. Re-export from `src/temporal/activities/index.ts` (worker registers `* as activities`)
3. `proxyActivities` in the workflow (**`import type` only** from activities)
4. If UI-visible: call `publishStatus` with the right `phase` / message
5. Keep activity short — no long `sleep` loops

### Status path (worker → edge → UI)

1. Activity signs body with `STATUS_WEBHOOK_SECRET`
2. Posts to `STATUS_WEBHOOK_URL` + `/internal/job-events`
3. `handleJobEvents` verifies HMAC, optionally syncs Postgres index
4. Forwards into JobRoom DO for that `workflowId`
5. DO broadcasts to hibernating WS clients

Secrets must match on **both** Node worker env and Workerd (`.dev.vars` / wrangler secrets).

### Start path (UI → Temporal)

1. UI calls `startVideoWorkflowFn`
2. Auth + `scopedDb.jobs.create` (when not e2e-bypassed)
3. Edge `fetch` → gateway `POST /workflows/start` with bearer secret
4. Gateway uses Temporal client (Node only) to start `generateVideoWorkflow`
5. Worker picks up tasks on `video-generation`

## TanStack AI usage

- Text: `chat({ adapter: grokText('grok-4.3'), stream: false, ... })`
- Video start: `generateVideo({ adapter: grokVideo('grok-imagine-video'), ... })`
- Video poll: `getVideoJobStatus({ adapter, jobId })`
- Persistence: JobRoom-backed generation store (`src/persistence/jobRoomAdapter.ts`)
- Env: `XAI_API_KEY` on the Node worker; optional `XAI_BASE_URL` for AIMock/e2e

Prefer Grok / xAI for AI features in this repo (see build-with-ai skill).

## Coding conventions

- **No `any`**, no `as any`, no `@ts-ignore` / `@ts-nocheck`
- Prefer `unknown` + narrowing; no non-null assertions (`!`) unless unavoidable
- `tsconfig` is max-strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.)
- Don't add fallback code that hides failures — surface errors
- Prefer existing helpers; avoid duplication
- Frontend: inline skeleton/loading UI in the component (no separate skeleton files)
- Don't add large test suites for demos; cover critical paths only if needed
- Check if localhost is already running before starting `bun run dev` / `dev:all`
- Typecheck: `bun run typecheck` (TypeScript 7 native `tsc --noEmit`)
- Lint/format: oxlint + oxfmt (not ESLint/Prettier)

### Naming

- **`createServerFn` results end in `Fn`** — `getSessionFn`, `listMyJobsFn`,
  `startVideoWorkflowFn`. The call site reads as a network round trip, not a
  local helper. Same for `createIsomorphicFn`.
- `createMiddleware` results end in `Middleware` (`authMiddleware`), and
  `createServerOnlyFn` results take no suffix (`getServerEnv`, `getCfBindings`).

### Static imports only

- **No `await import(...)`** in app code. Imports go at the top of the file, so
  the module graph is visible to typecheck, lint and the bundler.
- Dynamic import is allowed only for browser code-splitting of a genuinely
  heavy client-side library, and in tests that need mock ordering.
- Dynamic import is **not** the tool for keeping server code out of the client
  bundle — module boundaries are. A module that a route component imports must
  export _only_ server functions and types: TanStack Start compiles away
  `.handler()` bodies, but a plain exported function keeps its imports in the
  client graph and drags Postgres/Better Auth into the browser bundle. That is
  why `syncVideoJobFromStatus` lives in `lib/jobSync.ts` rather than
  alongside `listMyJobsFn` in `lib/jobs.ts`.
- Guard rail: `dist/client` must stay free of `drizzle`, `postgres` and
  server-side `better-auth` after `bun run build` (~400K).

### Request-scoped state (Workers)

- **Never cache anything that owns I/O in module scope.** Workers rejects use
  of a socket or stream created by one request from another request's handler
  ("Cannot perform I/O on behalf of a different request"), so a module-level
  Postgres client fails on the _second_ request in an isolate.
- `getDb()` and `getAuth()` are wrapped in `perRequest()`
  (`lib/requestScope.ts`); the Workers entry opens the scope once per
  request with `runInRequestScope()`.
- Better Auth cannot be a module singleton here: its Drizzle adapter captures
  the client it is constructed with.
- Env: read `getEnv()` from `lib/env.ts` — the Workers env carries vars,
  secrets _and_ object bindings (`EMAIL`, `HYPERDRIVE`), so it is a superset of
  `process.env`. Never copy it into a module-level variable. The Node Temporal
  worker is a separate process and reads `process.env` directly.

### Database access

- **Handlers never query with a hand-written user filter.** `authMiddleware`
  puts a `context.scopedDb` on the request; use `context.scopedDb.jobs.*`, where
  the `userId` predicate is applied in one place (`db/scoped/jobs.ts`).
- Only `db/scoped/*`, `db/system.ts` and `auth/server.ts` may import `getDb`
  — enforced by `no-restricted-imports` in `.oxlintrc.json`.
- `db/system.ts` / internal webhook path: deliberately unscoped writes, authorized
  by HMAC instead of session. Anything with a session user belongs in the scoped layer.

## Testing

- **E2E (primary automated path today):** Playwright via `e2e/run.ts` (`bun run test:e2e`).
  - Isolated app DB: Docker Postgres per worktree (default) or PlanetScale `e2e-*` branch (`E2E_DB_BACKEND=planetscale` / CI).
  - Migrates this checkout only; truncates data each run; never shares schema across worktrees.
  - Real Better Auth (DEV fixed OTP when `E2E_FIXED_OTP=1`) + `video_job` index.
  - `@copilotkit/aimock` mocks Grok chat + Imagine video (`XAI_BASE_URL`).
  - Happy path: sign-in → Temporal → JobRoom WS → completed (`e2e/video-generation.spec.ts`).
  - Isolated from local dev: app **:3100**, gateway **:8789**, task queue
    `video-generation-e2e` (dev keeps :3000 / :8788 / `video-generation`).
- **Unit tests:** only if a critical pure path needs a guard; co-locate as `*.test.ts`. Prefer not growing large suites for demo UI.
- **Boundaries:** edge/unit code must not import `@temporalio/*`. Workflow tests (if added) mock activities; never hit real xAI from CI.

## Common pitfalls

| Trap                                       | Symptom                                              | Fix                                                                              |
| ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Worker not running                         | Temporal execution **Running**, UI stuck             | `bun run worker` (or `dev:all`)                                                  |
| Temporal server down                       | Gateway cannot connect to `:7233`                    | `bun run temporal:dev`                                                           |
| Gateway secret mismatch                    | Edge start returns **401**                           | Align `TEMPORAL_STARTER_SECRET` on edge + worker                                 |
| Wrong / unset `STATUS_WEBHOOK_URL`         | WS stays on initial status; workflow still completes | Point worker at Workerd origin (`http://127.0.0.1:3000` local; e2e uses `:3100`) |
| HMAC secret mismatch                       | `/internal/job-events` **401**                       | Align `STATUS_WEBHOOK_SECRET` on worker + Workerd                                |
| Value-import activities in workflow        | Bundle / replay breakage                             | `import type` only from activities                                               |
| Long sleep inside an activity              | Worker slots stuck / timeouts                        | `sleep` in the **workflow**; short activities                                    |
| Workflow imports Node-only modules         | Worker bundle fails or non-determinism               | Keep I/O in activities; workflow-safe types only                                 |
| Live job status only in Postgres           | Stale UI / write hotspot                             | JobRoom DO + WS; Postgres is secondary index                                     |
| Provider video URL in UI long-term         | Broken playback later                                | Persist via R2 (`persistVideo` path)                                             |
| `XAI_API_KEY` in client                    | Secret leak                                          | Node activities only                                                             |
| Module-level DB/auth client on Workers     | Second request I/O errors                            | `perRequest` + `runInRequestScope`                                               |
| Hand-written `userId` filters in handlers  | Authz bugs / drift                                   | `context.scopedDb.*` only                                                        |
| Server helpers co-exported with server fns | Postgres/auth in client bundle                       | Split modules (`jobSync.ts` vs `jobs.ts`)                                        |

## Where to look

| Concern                   | Path                                                |
| ------------------------- | --------------------------------------------------- |
| Workflow orchestration    | `src/temporal/workflows/generateVideoWorkflow.ts`   |
| Activities (AI + publish) | `src/temporal/activities/`                          |
| Start API                 | `src/lib/video.ts`                                  |
| JobRoom DO                | `src/durable-objects/JobRoom.ts`                    |
| CF Worker entry           | `src/server.ts`                                     |
| Temporal worker + gateway | `src/temporal/worker.ts`, `src/temporal/gateway.ts` |
| UI                        | `src/routes/index.tsx`                              |
| E2E                       | `e2e/video-generation.spec.ts`                      |
| Temporal UI (local)       | http://localhost:8233                               |
