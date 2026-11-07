#!/usr/bin/env bash
bun --no-env-file packages/scripts/src/pr-merge/config-dist.ts || exit 1
exec bun --no-env-file packages/scripts/src/pr-merge/prepush.ts
