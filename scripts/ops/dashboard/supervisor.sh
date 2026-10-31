#!/usr/bin/env bash
# The live dashboard's supervisor: one background task of runner-pride's cmux session that keeps the dashboard stack and
# the session follower running as its own children (so both stay descendants of a cmux terminal), and rolls them
# to every new head of the branch upstream.sh names end to end: build it while the old stack serves (prebuild, from a staging worktree, unless it migrates), stop both by their recorded process groups, reset to it, install, build or
# migrate when the merge needs it, take its build (build_head, kept per head in $S/builds) and serve it, check it, start the follower, check it. Each roll, outage or anomaly
# appends one line to results.log (a refused roll a second, naming its refusal), which wakes the runner to report it. It signals only processes it started.
# It runs the latest head of the branch its main checkout sits on (upstream.sh: main for an install, canary for a checkout kept on canary), never one-off hashes or branches
# or worktrees. A head that fails its roll is remembered in bad-builds and never rolled again (one dev refused to start for its own settings, on its third refusal), and the dashboard falls back to the head it ran
# before. A file named paused in its state folder (ops/dashboard) stops every roll (restarts of a dead stack still run): touch it before a
# restart by hand, remove it after.
# It runs in the dashboard's checkout (run.sh's working directory), and stops its stack on SIGHUP, SIGTERM, or once run.sh has exited and left it to launchd.
set -m   # each background child gets its own process group, so stopping one never touches this script
D=$(cd "$(dirname "$0")" && pwd)
# The data folder, as packages/env/src/data-dir.ts resolves it: PLAYGROUND_DATA_DIR, else ~/.playground
DATA=${PLAYGROUND_DATA_DIR:-$HOME/.playground}
S=$DATA/ops/dashboard; mkdir -p "$S"
WT=$PWD
RESULTS="$S/results.log"
LOG="$S/supervisor.log"
DEVLOG="$S/dev.log"
INGLOG="$DATA/dashboard-ingest.log"
OPS=$(dirname "$D")
BAD="$S/bad-builds"
# 12 Oct (the owner saw "Network request failed" errors on the API grow frequent; five rolls 16:21-16:59Z each restarted the API):
# every roll, an upstream move included, waits ROLL_GAP after the last and for OWNER_IDLE with no owner action (a dashboard message or an Inbox
# answer), batching what lands meanwhile, or ROLL_GAP alone when the owner's idle cannot be read while the dashboard's Postgres runs (roll_due); a file named roll-now in its state folder (ops/dashboard) rolls at once, for a fix to live breakage
# or `playground update`, and with nothing to roll to it logs CURRENT, or SKIP for a head in bad-builds, and is removed
ROLL_GAP=1800 OWNER_IDLE=300 ASKS=$DATA/asks
cd "$WT" || exit 1
# a roll resets this checkout hard (redeploy-pull.sh), so only the dashboard's own checkout, on the branch live.branch names, is ever taken
LIVE=$(bun --no-env-file "$D/../../../packages/scripts/src/playground/setting.ts" --text live.branch 2>&1) ||
  { echo "supervisor: refusing to run in $WT: it cannot read live.branch: $LIVE" >&2; exit 1; }
branch=$(git symbolic-ref --short HEAD 2>/dev/null)
[ "$branch" = "$LIVE" ] || { echo "supervisor: refusing to run in $WT on ${branch:-a detached HEAD}: the dashboard's checkout is on $LIVE" >&2; exit 1; }

say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }
result() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$RESULTS"; say "RESULT $*"; }

# The head's production build, kept in $S/builds/<sha> outside the checkout: made by bun run build when it is missing, or when it was built for other URLs, since next bakes NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_API_URL into its client and auth bakes HONO_APP_URL's host; NODE_ENV and SKIP_ENV_VALIDATION_SERVER let it build before first run writes its .env, whose values the stack reads at its start; a failure prints its last error line; $1 is the tree it builds, the checkout by default, or prebuild's staging worktree
build_head() {
  local src=${1:-.} sha dir was started out
  sha=$(git -C "$src" rev-parse HEAD); dir=$S/builds/$sha
  dashboard_urls || { echo "bunx portless get failed"; return 1; }
  if [ -d "$dir" ]; then
    was=$(cat "$dir/urls" 2>/dev/null)
    [ "$was" = "$WEB $API" ] && return 0
    say "rebuilding ${sha:0:7}: its build was for ${was:-no URLs}, the Dashboard is now on $WEB $API"
  fi
  say "building ${sha:0:7} for $WEB $API"; started=$(date +%s)
  if ! out=$(cd "$src" && HONO_APP_URL=$API HONO_TRUSTED_ORIGINS=$WEB NEXT_PUBLIC_API_URL=$API NEXT_PUBLIC_APP_URL=$WEB NODE_ENV=production SKIP_ENV_VALIDATION_SERVER=true bun run build 2>&1); then
    echo "$out" >> "$LOG"
    echo "$out" | grep -E 'error|Error|ERR' | tail -1 | cut -c1-200; return 1
  fi
  rm -rf "$dir.tmp"; mkdir -p "$dir.tmp"
  # next's standalone server leaves .next/static and public for its host to copy beside it
  cp -R "$src/web/next/.next/standalone" "$dir.tmp/web" && mkdir -p "$dir.tmp/web/web/next/.next" && cp -R "$src/web/next/.next/static" "$dir.tmp/web/web/next/.next/static" &&
    { [ ! -d "$src/web/next/public" ] || cp -R "$src/web/next/public" "$dir.tmp/web/web/next/public"; } &&
    echo "$WEB $API" > "$dir.tmp/urls" || { echo "copying the build to $dir failed"; return 1; }
  rm -rf "$dir"; mv "$dir.tmp" "$dir"
  say "built ${sha:0:7} in $(( $(date +%s) - started ))s, $(du -sh "$dir" | cut -f1)"
}
# Before a roll stops anything: build the target ($1, the roll tagged $2) into $S/builds/<sha> from a detached staging worktree while the old stack serves, so build_head finds it kept after the stop; a target that migrates, whose commit cannot be had here, or whose staging worktree or install fails, builds after the stop as before; a build that fails lists the target in bad-builds and returns 1 with nothing stopped; the staging worktree goes either way
prebuild() {
  local target=$1 tag=$2 stage=$S/staging built rc=0
  drop_stage() { git worktree remove --force "$stage" >> "$LOG" 2>&1 || rm -rf "$stage"; git worktree prune; }
  "$D/net-git.sh" fetch -q origin >> "$LOG" 2>&1
  git cat-file -e "$target^{commit}" 2>/dev/null || { say "no commit ${target:0:7} here yet; building after the stop"; return 0; }
  git diff --quiet HEAD "$target" -- packages/db/drizzle/ || { say "${target:0:7} migrates; building after the stop"; return 0; }
  rm -rf "$stage"; git worktree prune
  git worktree add -q --detach "$stage" "$target" >> "$LOG" 2>&1 || { say "the staging worktree for ${target:0:7} failed; building after the stop"; drop_stage; return 0; }
  # node_modules as an APFS clone of the checkout's, then an install for what the move changed and each workspace's own links; .env as the checkout's, which bun run build loads
  if ! { { [ ! -d node_modules ] || cp -cR node_modules "$stage/"; } && (cd "$stage" && unset NODE_ENV SKIP_ENV_VALIDATION && bun install --frozen-lockfile --ignore-scripts); } >> "$LOG" 2>&1; then
    say "the staging worktree's install for ${target:0:7} failed; building after the stop"
    drop_stage; return 0
  fi
  [ ! -f .env ] || cp .env "$stage/.env"
  say "building ${target:0:7} before the stop, from $stage"
  built=$(build_head "$stage") || rc=1
  drop_stage
  [ $rc -eq 0 ] && return 0
  echo "$target" >> "$BAD"
  result "$tag ${target:0:7} FAIL build before the stop: ${built:-no error line; see supervisor.log}; still serving $(git rev-parse --short HEAD)"
  tell_dispatcher "Dashboard roll to ${target:0:7} FAILED its build; nothing stopped, still on $(git rev-parse --short HEAD)"
  return 1
}
# After a pass: keep this head's build and the last one that passed before it, for the next fallback, and remove the rest
keep_builds() {
  local before d; before=$(cat "$S/builds/passed" 2>/dev/null)
  for d in "$S/builds"/*/; do d=$(basename "$d"); [ "$d" = "$1" ] || [ "$d" = "$before" ] || rm -rf "${S:?}/builds/$d"; done
  [ "$before" = "$1" ] || echo "$1" > "$S/builds/passed"
}
start_dev() {
  PLAYGROUND_BUILD=$S/builds/$(git rev-parse HEAD) bun run serve --ui stream > "$DEVLOG" 2>&1 &
  echo $! > "$S/dashboard-dev.pid"; say "dev started, pid $!"
}
start_follower() {
  bash "$D/start-ingest.sh" &
  echo $! > "$S/dashboard-ingest.pid"; say "follower started, pid $!"
}
stop_all() {
  dashboard_container > /dev/null
  "$D/procs.sh" stop dashboard-ingest >> "$LOG" 2>&1
  "$D/procs.sh" stop dashboard-dev >> "$LOG" 2>&1
}
# the dashboard's URLs as portless names them for this checkout, read at every check, since portless's proxy can move (http on 1355 to https on 443)
dashboard_urls() { WEB=$(bunx portless get playground) && API=$(bunx portless get api.playground); }
# Up to 90 tries, a second apart, for the dashboard's health to answer, its URLs read afresh each try: before portless's proxy runs, portless get names its default port
# The branch the dashboard rolls to, read once at start, and its head on origin, read each time
UPSTREAM=$("$D/upstream.sh")
upstream_head() { "$D/net-git.sh" ls-remote origin "refs/heads/$UPSTREAM" 2>>"$LOG" | cut -f1; }
# A roll only moves forward: an upstream head the running head already holds (main behind a checkout that rolled on canary) waits until the upstream passes it
behind() { git merge-base --is-ancestor "$1" HEAD 2>/dev/null; }
wait_dashboard() { local i; for i in $(seq 1 90); do dashboard_urls && curl -sf "$API/api/health" > /dev/null 2>&1 && return 0; sleep 1; done; return 1; }
alive() { kill -0 "$(cat "$S/$1.pid" 2>/dev/null)" 2>/dev/null; }
# first run's setup has not written the database yet: no POSTGRES_URL in the environment or this checkout's .env, so the follower, which validates it as it starts, waits rather than exiting on every tick
setup_pending() { [ -z "${POSTGRES_URL:-}" ] && ! grep -qE "^POSTGRES_URL=[\"']?[^\"'[:space:]]" "$WT/.env" 2>/dev/null; }
# an importer holds the follower's lock: a follower an earlier supervisor left running counts, so this one's "another importer holds the lock" exit is no outage; the status read gets HELD_WAIT seconds, then is stopped by its own process group (set -m gives it one), so a wedged docker child under it goes too, and exits 2, holder unknown, so a wedged Docker or database never freezes the loop
follower_held() { local p i; bun api/hono/src/bin/dashboard-ingest.ts status > /dev/null 2>&1 & p=$!; for i in $(seq 1 "${HELD_WAIT:-20}"); do kill -0 "$p" 2>/dev/null || { wait "$p" && return 0 || return 1; }; sleep 1; done; kill -- -"$p" 2>/dev/null; wait "$p" 2>/dev/null; return 2; }

# The bare aliases (playground.localhost, api.playground.localhost) hold the ports of the live stack's own routes in portless's route file, read by alias.ts and never written; a mismatch, a missing route or a missing file is one ANOMALY result and one alert, said again only when it changes, and one result once it is right again
check_aliases() { local out; dashboard_urls || return 0; if out=$(bun --no-env-file "$D/alias.ts" "${PORTLESS_STATE_DIR:-$HOME/.portless}/routes.json" "$WEB" "$API" 2>&1); then [ -z "${alias_said:-}" ] || result "ALIAS ok again: $out"; alias_said=; return 0; fi; [ "$out" = "${alias_said:-}" ] || { result "ANOMALY alias: $out"; "$OPS/notify.sh" dashboard "alias: $out"; }; alias_said=$out; return 1; }
# Dev up and checked: health answers, verify passes against HEAD, approvals stay off. Prints one summary.
# every verify check but pages, one call each (verify takes one check per call): the pages check opens /dashboard/apps/changelog,
# which marks the changelog read for LocalAgent, the owner's account, so each roll cleared the owner's +1 (fixed since, 7 Oct)
# signin, ws and system sign in through the agent route, which only a checkout whose .env turns AGENT_SIGNIN_ENABLED on serves; a person's checkout starts it blank from .env.example, so there health and map are the checks
verify_dashboard() {
  local c out rc=0 checks="health map"
  grep -qiE '^AGENT_SIGNIN_ENABLED=(true|1|yes|on|y|enabled)$' .env 2>/dev/null && checks="health signin ws system map"
  dashboard_urls || { echo "✗ urls: bunx portless get failed"; return 1; }
  for c in $checks; do
    out=$(bun run verify "$c" --web "$WEB" --api "$API" --expect "$(git rev-parse HEAD)" 2>&1) || rc=1
    echo "$out"
  done
  return $rc
}

# The dev log's line that names why the stack stopped, on the dev launcher's vocabulary: the launcher's own notes pass over, a refusal or an error names itself
dev_reason() {
  awk '/^dev: / && !/^dev: refusing/ { next } /^dev: refusing|EADDRINUSE|ERROR|SyntaxError|error:/ { print; exit }'
}

check_dev() {
  wait_dashboard
  # the launcher's own dev: notes (cmux's refusal names an ERROR) pass over to the line that stopped the stack, a refusal kept
  if ! alive dashboard-dev; then echo "dev=DOWN ($(dev_reason < "$DEVLOG" | cut -c1-140))"; return 1; fi
  sleep 3; "$D/procs.sh" record dashboard-dev >> "$LOG" 2>&1
  local version v ok=0
  version=$(curl -sf "$API/api/health" | sed -nE 's/.*"version":"([^"]+)".*/\1/p' | head -1)
  v=$(verify_dashboard); ok=$?
  # a roll's first verify can land while next or the proxy is still settling (502): wait and verify once more before reporting FAIL
  if [ $ok -ne 0 ]; then sleep 45; v=$(verify_dashboard); ok=$?; fi
  echo "$v" >> "$LOG"
  local fails; fails=$(echo "$v" | grep '^✗' | cut -c1-120 | tr '\n' ';')
  local appr="blank"; grep -qE '^(PLAYGROUND_APPROVALS_ENABLED|DESK_APPROVALS_ENABLED)=.+' .env && appr="SET(!)"
  echo "version=${version:-unknown} verify=$([ $ok -eq 0 ] && echo PASS || echo "FAIL $fails") approvals=$appr"
  [ $ok -eq 0 ] && [ "$appr" = blank ]
}
# Follower up and checked: waits for its "following" line after this start, then bun run ingest status.
check_follower() {
  local since=$1 i line
  for i in $(seq 1 90); do
    line=$(awk -v t="$since" '$1 >= t' "$INGLOG" | grep -E 'following|refusing|exited with code' | tail -1)
    case "$line" in *following*) break ;; esac
    alive dashboard-ingest || break; sleep 1
  done
  "$D/procs.sh" record dashboard-ingest >> "$LOG" 2>&1
  local st code; st=$(bun run ingest status 2>&1); code=$?
  echo "follower=$([ $code -eq 0 ] && echo running || echo "FAIL $(tail -2 "$INGLOG" | tr '\n' ' ' | cut -c1-160)") $(echo "$st" | sed -n 2p | cut -c1-60) $(echo "$st" | grep -o 'entries: [0-9]*')"
  [ $code -eq 0 ]
}
# The loop's DOWN dev reason: the echoed bun command spent the old tail's 200 before the refusal showed, so the reason names itself first; bun's own `error: script` exit line drops out first, or every crash but a refusal would name it, and the last line left names a death the vocabulary does not; three lines suffice, since a refusal exits at once and only that line follows it, and 360 holds the launcher-gone refusal's pids inside notify's 400 past the 31-character stamp
dev_down() {
  local tail reason
  tail=$(tail -3 "$DEVLOG" | grep -v '^error: script ')
  reason=$(printf '%s\n' "$tail" | dev_reason)
  [ -n "$reason" ] || reason=$(printf '%s\n' "$tail" | tail -1)
  printf '%s' "$reason" | cut -c1-360
}
roll_up() {   # build the head when it has no build, start it and the follower, check both, and report one line; returns 0 on PASS
  local tag=$1 sha dev fol t built
  sha=$(git rev-parse --short HEAD)
  # a failed build leaves no dev log of its own, so finish_roll never reads the last stack's refusal as this head's
  built=$(build_head) || { : > "$DEVLOG"; result "$tag $sha FAIL build: $built"; return 1; }
  start_dev; dev=$(check_dev); local dok=$?
  local fok=0
  if setup_pending; then
    fol="follower=waiting for first run's setup"; say "follower: waiting for first run's setup, which writes POSTGRES_URL; not starting it"; waiting_f=1
  else
    t=$(date -u +%Y-%m-%dT%H:%M:%S); start_follower; fol=$(check_follower "$t"); fok=$?
  fi
  if [ $dok -eq 0 ] && [ $fok -eq 0 ]; then result "$tag $sha PASS $dev $fol"; keep_builds "$(git rev-parse HEAD)"; return 0; else result "$tag $sha FAIL $dev $fol"; return 1; fi
}
# The owner's rule: restart the app every time something lands on the upstream, so the change is visible at once
tell_dispatcher() { NOTIFY_TO=dispatcher "$OPS/notify.sh" dashboard "$1"; }

# The dashboard's database container, by the rule bun run ingest proves (the one running container publishing POSTGRES_URL's port on loopback alone), read with this checkout's own code and .env, and written to dashboard-db for procs.sh's drain (empty when none); a failed lookup logs its reason once, when it starts failing
dashboard_container() { local c; if c=$(bun "$WT/api/hono/src/bin/dashboard-db.ts" 2>&1); then echo "$c" > "$S/dashboard-db"; echo "$c"; else { [ ! -e "$S/dashboard-db" ] || [ -s "$S/dashboard-db" ]; } && say "dashboard db not found: $c"; : > "$S/dashboard-db"; return 1; fi; }
# Seconds since the last message sent from the dashboard (the activity row deliver() writes); empty when it cannot tell
quiet_for() { local c; c=$(dashboard_container) || return 0; docker exec "$c" psql -U postgres -tAc "select coalesce(extract(epoch from now() - max(created_at))::int, 999999) from activity where action in ('dashboard.message', 'desk.message')" 2>/dev/null | tr -d ' '; }
# Seconds since the owner last acted on the dashboard: a dashboard message, or an Inbox answer (it rewrites the ask's file); empty when it cannot tell
owner_idle() {
  local q a newest
  q=$(quiet_for); [ -n "$q" ] || return 0
  newest=$(stat -f %m "$ASKS"/*.json 2>/dev/null | sort -n | tail -1)
  a=$(( $(date +%s) - ${newest:-0} ))
  [ "$a" -lt "$q" ] && echo "$a" || echo "$q"
}
# a roll is due once ROLL_GAP has passed ($1 seconds since the last) and the owner has been idle OWNER_IDLE ($2), or the owner's idle cannot be read while the dashboard's Postgres runs ($3 is up), so a canary move never waits on a reading; with the container down a roll would fail its database proof, so it holds
roll_due() { [ "$1" -ge $ROLL_GAP ] && { [ -n "$2" ] && [ "$2" -ge $OWNER_IDLE ] || { [ -z "$2" ] && [ "$3" = up ]; }; }; }
dashboard_db() { dashboard_container > /dev/null && echo up || echo down; }
# When the running code (from head $1, or a copy outside this checkout) differs from the checkout's scripts/ops/dashboard/, write the roll to $S/reload (the head, tag $2, then $3-$5 for finish_roll) and exit 75 with the stack down, so run.sh execs the checkout's own copy
reload_if() {
  [ "$D" -ef "$WT/scripts/ops/dashboard" ] && git diff --quiet "$1" HEAD -- scripts/ops/dashboard/ && return 0
  printf '%s\n' "$(git rev-parse HEAD)" "$2" "${3:-}" "${4:-}" "${5:-}" > "$S/reload"
  say "reloading at $(git rev-parse --short HEAD) on its own scripts/ops/dashboard/ ($2)"; exit 75
}
# The roll the last supervisor handed on, read and removed; one written at another head is stale and dropped
take_reload() { [ -s "$S/reload" ] || return 1; { read -r r_head; read -r r_tag; read -r r_target; read -r r_prev; read -r r_mig; } < "$S/reload"; rm -f "$S/reload"; [ "$r_head" = "$(git rev-parse HEAD)" ]; }
# Pull to $1 and set out, mig and pulled, its exit; a pull that failed before it reached $1 (a fetch, the live branch's refusal) leaves the head it was on, so it reports an ANOMALY and returns 1 for the caller to start that head again, and the next roll tries again
pull_to() {
  pulled=0; mig=
  out=$("$D/redeploy-pull.sh" "$1" 2>&1) || pulled=$?; echo "$out" >> "$LOG"
  echo "$out" | grep -qx migrate && mig=migrate
  if [ "$pulled" -ne 0 ] && [ "$(git rev-parse HEAD)" != "$(git rev-parse -q --verify "$1^{commit}")" ]; then result "ANOMALY pull to ${1:0:7} failed before it moved (exit $pulled); staying on $(git rev-parse --short HEAD)"; return 1; fi
}
# Build $1 while the old stack serves (prebuild), then stop, move the checkout to $1, start, check; falls back to the head it ran before when the roll fails (never after a migration).
roll_to() {
  local target=$1 why=$2 prev out notes mig tag pulled
  prebuild "$target" "ROLL $why" || return 0
  stop_all
  if [ -n "$("$D/procs.sh" left dashboard-dev)$("$D/procs.sh" left dashboard-ingest)" ]; then result "ANOMALY stop left processes alive; not rolling"; return 1; fi
  prev=$running
  if ! pull_to "$target"; then roll_up RESTART; last_roll=$(date +%s); return; fi
  notes=$(echo "$out" | grep -E '^(install|build|migrate)$|^added ' | tr '\n' ' ')
  tag="ROLL $why${notes:+ ($notes)}"
  # a pull that failed on the head (its install, build or migration) fails the roll before the head starts, so it never runs on a stale dist
  [ "$pulled" -eq 0 ] && reload_if "$prev" "$tag" "$target" "$prev" "$mig"
  finish_roll "$tag" "$target" "$prev" "$mig" "$pulled"
  running=$(git rev-parse HEAD); last_roll=$(date +%s)
}
# Start and check the head a roll reset to ($2, tagged $1), and fall back to $3 when it fails or its pull failed ($5 non-zero), unless it migrated ($4)
finish_roll() {
  local tag=$1 target=$2 prev=$3 mig=$4 pulled=${5:-0}
  # a failed pull skips roll_up, so it writes the roll's FAIL line itself, which playground update reads before the FALLBACK
  [ "$pulled" -eq 0 ] || result "$tag $(git rev-parse --short HEAD) FAIL pull exited $pulled"
  if [ "$pulled" -eq 0 ] && roll_up "$tag"; then
    say "dashboard on $(git rev-parse --short HEAD)"   # 8 Oct: a passing roll needs no notice
  elif [ -n "$mig" ]; then
    tell_dispatcher "Dashboard roll to $(git rev-parse --short HEAD) FAILED after a migration; left on it for ops (see ops/dashboard/supervisor.log)"
    "$OPS/notify.sh" dashboard "roll to $(git rev-parse --short HEAD) failed after a migration; not falling back"
  else
    # bad-builds first: a supervisor the fallback reloads into keeps off the target at its start; a refusal dev_reason names is no bad build, but the head's own, its settings refusal (its env schema asks for what .env lacks), counts in refused, its third joining bad-builds
    # every other refusal is the machine's or the checkout's (cmux, the database, another stack, portless's proxy, whose `portless service install` needs the owner's sudo), so a retry each ROLL_GAP is all the supervisor can do, and a refusal no one listed stays out of bad-builds
    local refusal="" n note="not the head's, no bad build"
    [ "$pulled" -ne 0 ] || refusal=$(dev_reason < "$DEVLOG" 2>/dev/null | sed -n 's/^dev: refusing to start: //p')
    if [ -z "$refusal" ]; then
      echo "$target" >> "$BAD"
    else
      if printf '%s' "$refusal" | grep -q "^the API's settings could not be read"; then
        echo "$target" >> "$S/refused"; n=$(grep -cx "$target" "$S/refused"); note="refusal $n of 3, no bad build"
        [ "$n" -lt 3 ] || { echo "$target" >> "$BAD"; note="refusal 3 of 3, so it joins bad-builds"; }
      fi
      result "$tag $(git rev-parse --short HEAD) FAIL dev refusing: $(printf '%s' "$refusal" | cut -c1-300) ($note)"
    fi
    stop_all
    "$D/redeploy-pull.sh" "$prev" >> "$LOG" 2>&1 && say "fell back to $(git rev-parse --short HEAD)"
    # the code running is the target's once its pull passed, and still the head before's when it failed
    reload_if "$([ "$pulled" -eq 0 ] && echo "$target" || echo "$prev")" FALLBACK "$target" "$prev"
    fall_back "$target" "$prev"
  fi
}
# a target the fallback left out of bad-builds was refused, which is no bad build
fall_back() {
  local failed=FAILED; grep -qx "$1" "$BAD" 2>/dev/null || failed="refused to start, which is no bad build"
  roll_up "FALLBACK" && tell_dispatcher "Dashboard roll to ${1:0:7} $failed; fell back to $(git rev-parse --short HEAD)" || tell_dispatcher "Dashboard roll to ${1:0:7} $failed and the fallback to ${2:0:7} failed too; ops is on it"
  "$OPS/notify.sh" dashboard "roll to ${1:0:7} failed; fell back to ${2:0:7}"
}
# At start: go on with the roll the last supervisor handed on, or else move to the upstream's head when it is new and not in bad-builds, and start
boot() {
  local was upstream out mig pulled
  # a handed-on roll is the checkout's own copy's to finish, so a copy outside it hands on again and leaves the file
  [ -s "$S/reload" ] && ! [ "$D" -ef "$WT/scripts/ops/dashboard" ] && { say "handing the pending roll on to $WT/scripts/ops/dashboard/"; exit 75; }
  if take_reload; then
    say "reloaded at $(git rev-parse --short HEAD): $r_tag"
    case "$r_tag" in
      START) roll_up START ;;
      FALLBACK) fall_back "$r_target" "$r_prev" ;;
      *) finish_roll "$r_tag" "$r_target" "$r_prev" "$r_mig" ;;
    esac
    return
  fi
  was=$(git rev-parse HEAD)
  upstream=$(upstream_head)
  [ -n "$upstream" ] && [ "$upstream" != "$was" ] && behind "$upstream" && say "$UPSTREAM ${upstream:0:7} is behind the running head ${was:0:7}; waiting"
  if [ ! -e "$S/paused" ] && [ -n "$upstream" ] && [ "$upstream" != "$was" ] && ! behind "$upstream" && ! grep -qx "$upstream" "$BAD" 2>/dev/null; then
    pull_to "$upstream" && [ "$pulled" -ne 0 ] && { finish_roll START "$upstream" "$was" "$mig" "$pulled"; return; }
  fi
  reload_if "$was" START
  roll_up START
}

trap 'say "supervisor stopping"; stop_all; exit 0' TERM INT HUP

say "supervisor armed at $(git rev-parse --short HEAD)"
boot
running=$(git rev-parse HEAD); last_roll=$(date +%s); target=$running
while true; do
  # a background sleep and wait, so a signal runs its trap at once rather than after the sleep
  sleep 30 & wait $!
  parent=$(ps -o ppid= -p $$ | tr -d ' '); [ -n "$parent" ] && [ "$parent" != "$PPID" ] && { say "run.sh is gone; stopping"; stop_all; exit 0; }
  if [ -e "$S/paused" ]; then
    [ -z "${paused_said:-}" ] && say "paused: no rolls while $S/paused exists" && paused_said=1
  else
    paused_said=
    head=$(upstream_head)
    now=$(date +%s)
    if [ -n "$head" ] && [ "$head" != "$target" ]; then say "$UPSTREAM moved: ${target:0:7} -> ${head:0:7}"; target=$head; fi
    back=; [ -n "$head" ] && [ "$target" != "$running" ] && behind "$target" && back=1
    if [ -n "$back" ] && [ "${behind_said:-}" != "$target" ]; then say "$UPSTREAM ${target:0:7} is behind the running head ${running:0:7}; waiting"; behind_said=$target; fi
    if [ -n "$head" ] && [ -n "$target" ] && [ "$target" != "$running" ] && [ -z "$back" ] && ! grep -qx "$target" "$BAD" 2>/dev/null; then
      why="$UPSTREAM ${head:0:7}"
      if [ -e "$S/roll-now" ]; then
        rm -f "$S/roll-now"; say "roll-now: rolling to ${target:0:7} at once"
        roll_to "$target" "$why (roll-now)"; held_said=
      else
        idle=$(owner_idle); gap=$((now - last_roll)); db=up
        [ -n "$idle" ] || db=$(dashboard_db)
        if roll_due "$gap" "$idle" "$db"; then
          [ -n "$idle" ] || say "owner idle unread: rolling to ${target:0:7} on the gap alone"
          roll_to "$target" "$why"; held_said=
        elif [ "${held_said:-}" != "$target" ]; then
          say "roll to ${target:0:7} held: last roll ${gap}s ago (needs $ROLL_GAP), owner idle ${idle:-?}s (needs $OWNER_IDLE), dashboard db $db"; held_said=$target
        fi
      fi
    elif [ -n "$head" ] && [ -e "$S/roll-now" ]; then
      # nothing to roll to: answer the roll-now (playground update reads the line) and remove it, so it never lifts the next roll's holds
      rm -f "$S/roll-now"
      if [ "$target" != "$running" ] && [ -z "$back" ]; then result "SKIP ${target:0:7} FAIL ${target:0:7} failed its roll before (bad-builds)"; else result "CURRENT $(git rev-parse --short HEAD)"; fi
    fi
  fi
  if ! alive dashboard-dev; then
    result "DOWN dev: $(dev_down)"
    stop_all; roll_up RESTART
  elif ! alive dashboard-ingest && setup_pending; then
    [ -n "${waiting_f:-}" ] || { say "follower: waiting for first run's setup, which writes POSTGRES_URL; not starting it"; waiting_f=1; }
  elif ! alive dashboard-ingest && { follower_held; held=$?; [ $held -ne 1 ]; }; then
    # a holder this supervisor did not start keeps its own code across rolls, so it is named once each time it appears; a status read past its wait leaves the follower as it is, since a restart would wait on the same database
    [ "${held_said_f:-}" = $held ] || { [ $held -eq 0 ] && say "follower: another importer holds the lock, a process this supervisor did not start; leaving it" || say "follower: bun run ingest status gave no answer in ${HELD_WAIT:-20}s; not restarting it"; held_said_f=$held; }
  elif ! alive dashboard-ingest; then
    held_said_f=
    if [ -n "${waiting_f:-}" ]; then
      waiting_f=; say "follower: first run's setup wrote POSTGRES_URL; starting it"; step=START
    else
      result "DOWN follower: $(tail -2 "$INGLOG" | tr '\n' ' ' | cut -c1-200)"; step=RESTART
    fi
    t=$(date -u +%Y-%m-%dT%H:%M:%S); start_follower; fol=$(check_follower "$t") && result "$step follower $fol" || result "FAIL follower $fol"
  else
    held_said_f=
  fi
  check_aliases
done
