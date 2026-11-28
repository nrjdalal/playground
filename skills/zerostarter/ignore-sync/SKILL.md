---
name: ignore-sync
description: Mirror .gitignore to .dockerignore. Use whenever a .gitignore entry is added or removed, or when auditing a bloated Docker build context.
source: https://github.com/nrjdalal/zerostarter
---

> [!CAUTION]
> Synced from https://github.com/nrjdalal/zerostarter. Customize this skill or remove this note to stop syncing.

# Ignore Sync

`.dockerignore` does not inherit from `.gitignore`. Whatever git ignores but `.dockerignore` misses still enters the Docker build context (`COPY . .` in the `prepare` stage of `web/next/Dockerfile` and `api/hono/Dockerfile`), and on this repo that has meant gigabytes: `web/next/.next` alone hit 3GB and `.turbo` 23GB.

## The two files are mirrors

`.gitignore` is the source of truth and `.dockerignore` follows it line for line. Every ignore rule and every shared `!` un-ignore (e.g. `!.yarn/patches`) lives in the shared body of both: same entry, same section, same order, same commit.

Two divergences are sanctioned:

- **The `**/` prefix.** Docker matches each pattern from the build context's root, while git matches a pattern with no slash before its end at any depth ([Build context](https://docs.docker.com/build/concepts/context/)). So `.dockerignore` writes each folder pattern git matches at any depth with a `**/` prefix (`node_modules/` becomes `**/node_modules/`), which keeps every workspace's `.next`, `dist` and `node_modules` out of the context. A pattern git anchors to the root, one with a slash before its end (`.claude/worktrees/`), stays as written.
- **The labeled override block**, for a git-only or docker-only override. There the label is all that differs, `# git overrides` versus `# docker overrides`, and today each block carries only `!.env.example`.

## .env stays out of the context

Real `.env*` files never enter the Docker context. Each build mounts the host file as a required BuildKit secret (`--mount=type=secret,id=dotenv,target=/app/.env,required=true`; compose supplies it via `secrets.dotenv.file: .env`), so it is validated in full during the build yet never lands in a layer. A diff that re-includes `.env*` to feed a builder-stage `COPY` is drift; sync it away.

## Audit

```bash
diff -u .gitignore <(sed 's#^\*\*/##' .dockerignore)
grep -nE '^[^#!/*][^/]*/$' .dockerignore
```

Done when the grep prints nothing (a folder pattern without its `**/`) and the diff's only difference is the override block's label:

```diff
-# git overrides
+# docker overrides
```

Any other differing line is a missed sync.
