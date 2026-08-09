---
name: block-dev-vars-edits
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.dev\.vars(\.[\w-]+)?$
---

🛑 **Do not write to `.dev.vars`.**

That file holds the developer's real local secrets (DATABASE_URL, API keys) and
is theirs to edit. Rewriting it — even with a backup-and-restore — clobbers a
running dev server and loses data if the process is interrupted.

**Instead:**
- Per-environment local secrets: create `.dev.vars.<environment>` and select it
  with `CLOUDFLARE_ENV=<environment>` (Vite plugin) or `wrangler dev --env <environment>`.
  When that file exists, `.dev.vars` is not loaded at all — hermetic by design.
- Node-side processes (Temporal worker, scripts): pass env directly to the
  process; they inherit `process.env` normally.
- Note that setting env on the parent process does **not** reach the Worker —
  workerd only sees wrangler `vars` plus the `.dev.vars` file.
