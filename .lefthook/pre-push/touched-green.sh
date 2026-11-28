#!/usr/bin/env bash
exec bun --no-env-file packages/scripts/src/touched-green.ts --push
