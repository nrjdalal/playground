---
name: codebase-map
description: "Orient in this repo: which file to edit for a change, how a change ripples across the stack, and how to search the code. Use at the start of a task in an unfamiliar area, or before a cross-cutting change."
source: https://github.com/nrjdalal/zerostarter
---

# Codebase Map

One Bun + Turborepo monorepo: two deployable apps over shared packages. Imports use `@api/hono`, `@packages/*`, and the `@/` alias, never deep relative paths.

```
.generated/       # repo-root home for build-time generated assets (gitignored)
api/hono/         # backend (Hono): routers, middlewares, the AppType export
web/next/         # frontend (Next.js App Router): app/, components/, lib/, content/
packages/auth/    # Better Auth instance
packages/db/      # Drizzle schema + client
packages/redis/   # the lock store on Bun's Redis client (REDIS_URL), the merge lock's holder
packages/env/     # type-safe env, one validated entry per consumer
packages/config/  # TS base, tsdown factory, and site.ts (brand identity)
packages/scripts/ # build-only bun tooling (auth-schema, data-table-metrics, generate-env, lock, pr-merge, verify); every new script lands here, never bundled
packages/cli/     # the zerostarter scaffolding CLI (canonical repo only; init strips it)
tests/            # the whole suite, mirroring each subject's path; *.e2e.test.ts drive a running stack (canonical repo only; forks take no tests)
```

Read `AGENTS.md` first for the rules (the dashboard app's are in `.agents/dashboard/<topic>.md`: AGENTS.md holds each ALWAYS rule in one line and a pointer naming when to read its file); `curl "$(bunx portless get playground)/llms-full.txt"` dumps the whole codebase as one context file.

## Where to edit for X

Read `lat.md/where-to-edit.md` before you edit an area you have not worked in: each goal links the file or symbol to edit and names the skill to load next.

## Trace a feature across the stack

Types flow downhill, so a change ripples predictably:

```
packages/db/src/schema  →  api/hono/src/routers  →  api/hono/src/index.ts (AppType)  →  web/next/src/lib/api/client.ts  →  app / components
```

To add a field end to end: edit and migrate the schema, then select and return it in the router. Every `apiClient` call site is retyped automatically, and the compiler becomes your worklist of what still must change.

## Entry points (read these first)

- `api/hono/src/index.ts`, the `.route()` chain and `export type AppType`, the whole API shape in one file.
- `web/next/src/app/layout.tsx`, the web root.
- `packages/config/src/site.ts`, brand identity and injectable content.

## Fast find

```bash
rg -n "\.route\(" api/hono/src/index.ts               # every mounted router
rg -n "export const \w+Router" api/hono/src/routers   # every router definition
ls packages/db/src/schema                             # every schema file (tables)
rg -n "apiClient\." web/next/src                      # every API call site
rg -n "SOME_ENV_VAR" packages/env                     # where an env var is declared
ls .agents/skills                                     # every task skill available
```

## Then

Load the task skill (the Then column of `lat.md/where-to-edit.md`); `dev` runs and restarts the stack, and concept docs live under `/docs`.
