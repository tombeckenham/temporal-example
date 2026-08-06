# Temporal + TanStack AI video example

A small demo of **Temporal workflows** driving **Grok Imagine** video generation via **TanStack AI** and **TanStack Start**.

## What you will learn

Video generation is a multi-minute, failure-prone job. Temporal makes that durable:

1. **Workflow** orchestrates steps (enhance prompt → start job → poll)
2. **Activities** call xAI / TanStack AI (side effects)
3. **Queries** expose live status to the UI
4. **Sleep** between polls is durable — worker restarts do not lose progress

Open the [Temporal UI](http://localhost:8233) while a job runs and inspect the event history.

## Prerequisites

- [Bun](https://bun.sh)
- [Temporal CLI](https://docs.temporal.io/cli) **or** Docker
- An [xAI API key](https://console.x.ai) with access to Grok text + Imagine video

## Setup

```bash
bun install
```

Add your key to `.env.local`:

```bash
XAI_API_KEY=xai-...
```

## Run (three processes)

**Terminal 1 — Temporal server**

```bash
# Preferred (Temporal CLI)
bun run temporal:dev

# Or Docker
bun run temporal:docker
```

**Terminal 2 — Worker** (executes workflows + activities)

```bash
bun run worker
```

**Terminal 3 — Web app**

```bash
bun --bun run dev
```

Open [http://localhost:3000](http://localhost:3000), submit a prompt, and watch phases: `enhancing` → `starting` → `generating` → `completed`.

## Architecture

```
Browser  ──server fn──►  Temporal Client  ──start/query──►  Temporal Server
                                                                  │
                                                                  ▼
                                                           Worker process
                                                    workflows/ + activities/
                                                           │
                                                           ▼
                                              TanStack AI → xAI (Grok Imagine)
```

| Path | Role |
| --- | --- |
| `src/temporal/workflows/` | Deterministic orchestration + status query |
| `src/temporal/activities/` | Prompt enhance + video start/poll |
| `src/server/video.ts` | Start workflow / query status |
| `src/routes/index.tsx` | UI |
| `AGENTS.md` | Conventions for coding agents |

## Notes

- Default video model: `grok-imagine-video` (text-to-video, 1–15s)
- Default size: `16:9_480p` (cheaper/faster for demos)
- Generated video URLs from xAI are temporary — download if you need to keep them
- See `AGENTS.md` for Temporal pitfalls and coding rules
