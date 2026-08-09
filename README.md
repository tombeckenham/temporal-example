# Temporal + TanStack AI + Cloudflare video

App that generates short AI videos from a text prompt:

1. TanStack Start UI on Cloudflare Workers
2. Temporal workflow enhances the prompt (Grok text), starts a Grok Imagine job, and polls until done
3. Status is pushed to a per-job **Durable Object** (`JobRoom`) over hibernating WebSockets
4. Edge starts workflows via a Node HTTP gateway (no Temporal gRPC in Workers)

## Prerequisites

- [Bun](https://bun.sh)
- [Temporal CLI](https://docs.temporal.io/cli) **or** Docker
- An [xAI API key](https://console.x.ai) with Grok text + Imagine video
- Optional: Cloudflare account for `wrangler deploy`

## Setup

```bash
bun install
cp .env.example .env.local   # if you don't already have .env.local
```

Minimum env:

```bash
XAI_API_KEY=xai-...
TEMPORAL_STARTER_SECRET=dev-starter-secret-change-me
STATUS_WEBHOOK_SECRET=dev-webhook-secret-change-me
STATUS_WEBHOOK_URL=http://127.0.0.1:3000
TEMPORAL_STARTER_URL=http://127.0.0.1:8788
```

## Run locally

```bash
bun run dev:all
```

| Process | Port | Role |
| --- | --- | --- |
| Temporal CLI | 7233 / UI 8233 | Workflow engine |
| Worker + gateway | 8788 | Activities + `POST /workflows/start` |
| Vite / workerd | 3000 | TanStack Start + JobRoom DO |

Open [http://localhost:3000](http://localhost:3000). Phases stream over WebSocket: `enhancing` → `starting` → `generating` → `completed`.

Temporal UI (local): [http://localhost:8233](http://localhost:8233).

## Deploy (Cloudflare)

```bash
bun run deploy
```

Run the **Node worker** separately (Fly/Render/K8s/etc.) with access to Temporal Cloud and your Workers URL:

- `TEMPORAL_ADDRESS` / `TEMPORAL_NAMESPACE` + `TEMPORAL_API_KEY` (or mTLS cert paths)
- `STATUS_WEBHOOK_URL=https://<your-worker>.workers.dev`
- `STATUS_WEBHOOK_SECRET` (same as Wrangler secret)
- `TEMPORAL_STARTER_SECRET` (edge uses this via Wrangler secret)

```bash
wrangler secret put STATUS_WEBHOOK_SECRET
wrangler secret put TEMPORAL_STARTER_SECRET
wrangler secret put TEMPORAL_STARTER_URL
```

Temporal service: **Temporal Cloud** (recommended). Workers stay on Node — they do not run inside Cloudflare Workers isolates.

## Architecture

```
Browser ──WS──► JobRoom DO (per workflowId)
Browser ──HTTP► TanStack Start Worker ──HTTP► Node gateway ──gRPC► Temporal
                                                              │
                                                         Worker process
                                                   workflows + activities
                                                              │
                                              publishStatus (HMAC) ──► JobRoom
                                              TanStack AI ──► xAI (Grok Imagine)
```

| Path | Role |
| --- | --- |
| `src/durable-objects/JobRoom.ts` | Live status + WebSockets (one DO per job) |
| `src/temporal/workflows/` | Deterministic orchestration |
| `src/temporal/activities/` | Prompt enhance, video start/poll, edge notify |
| `src/temporal/gateway.ts` | Workflow start API for the edge |
| `src/server/video.ts` | Server function → gateway |
| `src/routes/index.tsx` | UI |
| `AGENTS.md` | Agent / contributor conventions |

Live job status is stored on **JobRoom** Durable Objects, not D1. D1 is optional for secondary indexes only.

## E2E tests (CopilotKit AIMock)

```bash
bun run test:e2e
```

[`@copilotkit/aimock`](https://github.com/CopilotKit/aimock) mocks Grok chat and Imagine video. The harness starts AIMock, a worker with `XAI_BASE_URL` / `XAI_API_KEY=mock`, and runs Playwright against the UI.

Optional: `XAI_BASE_URL` (see `src/temporal/activities/xaiConfig.ts`). Full env list: `.env.example`.

## Notes

- Provider video URLs can expire; R2 persistence is not wired yet.
- Product UI uses JobRoom WebSockets, not Temporal Query polling.
