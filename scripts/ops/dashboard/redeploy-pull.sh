#!/usr/bin/env bash
# With the follower and the dashboard already stopped by their own recorded process groups (procs.sh, never by name), fast-forward
# the live branch (live.branch) to origin/<upstream>, the branch upstream.sh names (or reset it to the sha the supervisor names: the upstream's head, or the head it ran before a failed roll), install/build/migrate as the merge needs, then restart each ops job whose source the move changed (ops-restart) (the dev launcher sets GIT_SHA, so health reports HEAD without an env rebuild). Start dev and the
# follower afterwards as background tasks of the runner session (each writes its own pid file).
set -e
# It runs in the dashboard's checkout, the supervisor's working directory, and refuses any checkout not on live.branch, since it resets hard.
D=$(cd "$(dirname "$0")" && pwd)
LIVE=$(bun --no-env-file "$D/../../../packages/scripts/src/playground/setting.ts" --text live.branch 2>&1) ||
  { echo "redeploy-pull: refusing to reset $PWD: it cannot read live.branch: $LIVE" >&2; exit 1; }
branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
[ "$branch" = "$LIVE" ] || { echo "redeploy-pull: refusing to reset $PWD on ${branch:-a detached HEAD}: the dashboard's checkout is on $LIVE" >&2; exit 1; }
OLD=$(git rev-parse HEAD)
# an optional target sha to reset to (the upstream's head, or the head before a failed roll); none fast-forwards to origin/<upstream>
UPSTREAM=origin/$("$D/upstream.sh")
TARGET=${1:-$UPSTREAM}
git fetch -q origin
if [ "$TARGET" = "$UPSTREAM" ] && git merge-base --is-ancestor HEAD "$UPSTREAM"; then
  git merge -q --ff-only "$UPSTREAM"
else
  git reset -q --hard "$TARGET"
fi
echo "now at $(git log --oneline -1)"
CHANGED=$(git diff --name-only "$OLD" HEAD)
unset NODE_ENV SKIP_ENV_VALIDATION
if echo "$CHANGED" | grep -qE '(^|/)(bun\.lock|package\.json)$'; then echo "install"; bun install --frozen-lockfile --ignore-scripts; fi
# the dashboard runs packages/* from their dist, so a pull that changed one rebuilds them
if ! git diff --quiet "$OLD" HEAD -- packages ':!packages/scripts'; then echo "build"; env NODE_ENV=production SKIP_ENV_VALIDATION=true node_modules/.bin/turbo run build --filter='./packages/*'; fi
# A migration that builds an index on claude_entry blocks bun run ingest's writes while it runs (Drizzle wraps it in a transaction, so it can't be CONCURRENTLY): hold it for Ops to run at a quiet moment (the owner's go on 03e)
# Only one that builds indexes alone is held: a table or a column it adds is one the new head's code reads and writes from the restart on, so that one migrates now
if echo "$CHANGED" | grep -q '^packages/db/drizzle/'; then
  added=$(git diff "$OLD" HEAD -- 'packages/db/drizzle/*.sql' | grep -E '^\+' | grep -vE '^\+\+\+ ' | cut -c2- | sed -E 's/--> statement-breakpoint[[:space:]]*$//' | grep -vE '^[[:space:]]*$' || true)
  if echo "$added" | grep -iE '^create (unique )?index' | grep -qi 'claude_entry' && ! echo "$added" | grep -qviE '^create (unique )?index'; then
    echo "migrate-held"; "$(dirname "$D")/notify.sh" dashboard "migration held: a claude_entry index landed at $(git rev-parse --short HEAD); run bun run db:migrate in the dashboard checkout at a quiet moment, then bun run ingest status"
  else
    echo "migrate"; bun run db:migrate
  fi
fi
if echo "$CHANGED" | grep -q '^\.env\.example$'; then
  echo ".env.example changed; vars the merge added that .env lacks:"
  comm -23 <(git diff "$OLD" HEAD -- .env.example | grep -oE '^\+[A-Z_][A-Z0-9_]*=' | cut -c2- | sort -u) <(grep -oE '^[A-Z_][A-Z0-9_]*=' .env | sort -u)
fi
# Add each var the merge put in .env.example to .env, blank (unset), with its comment, as the runner has done by hand
if echo "$CHANGED" | grep -q '^\.env\.example$'; then
  for v in $(comm -23 <(git diff "$OLD" HEAD -- .env.example | grep -oE '^\+[A-Z_][A-Z0-9_]*=' | cut -c2- | tr -d '=' | sort -u) <(grep -oE '^[A-Z_][A-Z0-9_]*=' .env | tr -d '=' | sort -u)); do
    { printf '\n'; grep -B3 "^$v=" .env.example | grep -E '^#' | tail -1; echo "$v="; } >> .env; echo "added $v= (blank)"
  done
fi
# Restart each ops job whose source this move changed (ops-restart), on the build above; its failure leaves the roll as it is
bun --no-env-file "$PWD/packages/scripts/src/ops-restart/cli.ts" "$PWD" "$OLD" HEAD || echo "ops-restart exited $?"
