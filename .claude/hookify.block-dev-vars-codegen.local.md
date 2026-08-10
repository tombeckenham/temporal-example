---
name: block-dev-vars-codegen
enabled: true
event: file
action: block
conditions:
  - field: new_text
    operator: regex_match
    pattern: (writeFileSync|writeFile|appendFileSync|unlinkSync)\s*\([^)]*(\.dev\.vars|DEV_VARS)
---

🛑 **Code that rewrites `.dev.vars` at runtime.**

This is how the e2e harness ended up clobbering local secrets and killing a
running dev server. Do not reintroduce it.

**Instead:** commit a `.dev.vars.<environment>` file with non-secret test values
and select it with `CLOUDFLARE_ENV=<environment>`. Cloudflare loads _only_ that
file when it exists, so the developer's `.dev.vars` is never read or touched.
