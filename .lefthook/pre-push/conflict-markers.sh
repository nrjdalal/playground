#!/usr/bin/env bash
exec bun --no-env-file packages/scripts/src/conflict-markers.ts --push
