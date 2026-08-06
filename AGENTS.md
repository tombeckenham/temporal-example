# AGENTS.md — temporal-example

Guidance for coding agents working in this repo.

## What this project is

A **minimal AI video generation demo** that teaches **Temporal workflows**:

1. User submits a prompt in a TanStack Start UI
2. Server starts a Temporal workflow (`generateVideoWorkflow`)
3. Workflow optionally **enhances the prompt** (TanStack AI + Grok text)
4. Workflow **starts** a Grok Imagine video job (async)
5. Workflow **durably polls** until the video is ready (`sleep` + activity)
6. UI **queries** workflow status (Temporal Query) and plays the video

Stack:

| Layer | Tech |
| --- | --- |
| App | TanStack Start (React Router + Vite + Nitro) |
| AI | TanStack AI (`@tanstack/ai`, `@tanstack/ai-grok`) |
| Video engine | Grok Imagine (`grok-imagine-video`) via xAI API |
| Orchestration | Temporal TypeScript SDK |
| Package manager | Bun |

## Commands

```bash
bun install

# 1. Temporal server (pick one)
bun run temporal:dev          # Temporal CLI (preferred)
# or
docker compose up -d          # docker-compose.yml

# 2. Worker (separate terminal) — executes workflows + activities
bun run worker

# 3. Web app
bun --bun run dev             # http://localhost:3000
```

Typecheck: `bun tsgo --noEmit` (not `tsc`).

## Environment

`.env.local` (gitignored via `*.local`):

```bash
XAI_API_KEY=xai-...           # required for Grok text + video
DATABASE_URL=dev.db           # existing Drizzle/SQLite (unused by video flow)
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
```

Never put `XAI_API_KEY` in client code. Only activities / server functions may call xAI.

## Project layout

```
src/
  routes/                 # TanStack Router file routes (UI)
  server/video.ts         # createServerFn: start workflow + query status
  temporal/
    types.ts              # Shared types + TASK_QUEUE (workflow-safe)
    client.ts             # Temporal Client (server only)
    worker.ts             # Worker entrypoint (separate process)
    workflows/            # Deterministic workflow code only
    activities/           # Node I/O: TanStack AI, xAI HTTP
  db/                     # Drizzle schema (scaffold; not used by video demo)
```

## Temporal mental model (keep this clear)

- **Workflows** (`src/temporal/workflows/`):
  - Must be **deterministic** (no `fetch`, no `Date.now()`, no random, no Node APIs)
  - Orchestrate activities with `proxyActivities`, `sleep`, queries/signals
  - Survive process restarts via event history replay

- **Activities** (`src/temporal/activities/`):
  - May do anything Node can do (HTTP, TanStack AI, disk)
  - Keep them **short** (one HTTP call). Poll loops belong in the **workflow** with `sleep`

- **Queries** (`statusQuery`):
  - Read-only snapshot of in-memory workflow state
  - Used by the UI every ~2s while the job runs

- **Worker**:
  - Separate long-lived process (`bun run worker`)
  - Bundles workflows for the sandbox; injects activity implementations

- **Client** (web server functions):
  - `workflow.start` / `handle.query` only — does not execute workflow code

Task queue name: `video-generation` (`TASK_QUEUE` in `types.ts`).

## TanStack AI usage

- Text: `chat({ adapter: grokText('grok-4.3'), stream: false, ... })`
- Video start: `generateVideo({ adapter: grokVideo('grok-imagine-video'), ... })`
- Video poll: `getVideoJobStatus({ adapter, jobId })`
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
2. **Temporal server down** → server functions fail connecting to `:7233`
3. **Importing activities into workflows** → only `import type` from activities in workflow code
4. **Long sleep inside an activity** → use workflow `sleep` instead so cancellation/replay work
5. **Video URLs expire** → provider-hosted; download if persistence is needed
6. **Workflow bundling** → workflows must not import Node-only modules; keep them pure

## Where to look

- Workflow orchestration: `src/temporal/workflows/generateVideoWorkflow.ts`
- Activities (AI): `src/temporal/activities/`
- Start/status API: `src/server/video.ts`
- UI: `src/routes/index.tsx`
- Temporal UI: http://localhost:8233
