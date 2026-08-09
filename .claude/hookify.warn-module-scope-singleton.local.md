---
name: warn-module-scope-singleton
enabled: true
event: file
conditions:
  - field: new_text
    operator: regex_match
    pattern: \n(?:let|var)\s+_\w*\s*[:=]
---

⚠️ **Module-scope singleton (`let _foo`) — is it holding I/O?**

On Workers, an isolate serves many requests. Anything cached in module scope
survives between them, and a value that owns I/O (a Postgres socket, a stream,
an auth adapter holding a db client) is **unusable** from a later request:

> Cannot perform I/O on behalf of a different request.

This exact pattern (`let _db`, `let _auth`) caused a production sign-in failure
where the _second_ request in each isolate threw a DrizzleQueryError.

**Instead:** wrap the factory in `perRequest()` from `src/lib/requestScope.ts`:

```ts
export const getDb = perRequest(createClient)
```

Module-scope caching is fine for pure values (compiled regexes, constants,
config objects with no handles) — just not for anything that opens a connection.
