#!/usr/bin/env bash
# Run the session follower (`.agents/dashboard/ingest.md`). If its guard's DB connect times out right after dev
# starts, wait 30s and start it once more; a second failure ends this task so the runner tells Ops.
# The guard itself is never skipped or loosened.
# It runs in the dashboard's checkout, the supervisor's working directory.
unset NODE_ENV SKIP_ENV_VALIDATION
# The data folder, as packages/env/src/data-dir.ts resolves it: PLAYGROUND_DATA_DIR, else ~/.playground
DATA=${PLAYGROUND_DATA_DIR:-$HOME/.playground}
L="$DATA/dashboard-ingest.log"; mkdir -p "$(dirname "$L")"
bun run ingest --follow >> "$L" 2>&1; code=$?
if [ "$code" -ne 0 ] && tail -3 "$L" | grep -q 'refusing to write: Connection timeout'; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) runner: the guard's connect timed out; starting once more in 30s" >> "$L"
  sleep 30
  bun run ingest --follow >> "$L" 2>&1; code=$?
fi
exit "$code"
