---
name: warn-dynamic-import
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: /src/.*\.tsx?$
  - field: new_text
    operator: regex_match
    pattern: await\s+import\s*\(
---

⚠️ **Dynamic import in app code.**

Project rule (AGENTS.md): imports go at the top of the file so the module graph
is visible to typecheck, lint and the bundler.

**In particular, `await import()` is not the way to keep server code out of the
client bundle** — module boundaries are. A module that a route component imports
must export *only* server functions and types: TanStack Start compiles away
`.handler()` bodies, but a plain exported function keeps its imports in the
client graph and drags Postgres/Better Auth into the browser bundle.

Allowed: browser code-splitting of a genuinely heavy client-side library, and
tests that need `vi.doMock` ordering.
