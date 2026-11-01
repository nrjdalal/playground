#!/usr/bin/env bash
# Signal only processes this runner started: each job's background-task shell writes its pid to <job>.pid
# when it starts; `record` walks that pid's process tree (turbo puts each task in its own process group)
# and keeps every pid, pgid and command it finds; `stop` sends TERM to the recorded groups that still
# hold a recorded process, waits, then KILLs whatever of those groups is left. Nothing is chosen by name.
#   procs.sh record <job>   snapshot the job's tree (merged with earlier snapshots, so orphans stay known)
#   procs.sh stop <job>     stop every recorded group of the job; exits 1 if anything survived
#   procs.sh left <job>     list recorded processes still alive (no signals)
set -u
# The data folder, as packages/env/src/data-dir.ts resolves it: PLAYGROUND_DATA_DIR, else ~/.playground
DATA=${PLAYGROUND_DATA_DIR:-$HOME/.playground}
DIR=$DATA/ops/dashboard
job=${2:?job name}
PIDFILE="$DIR/$job.pid"
REC="$DIR/$job.procs"

tree() { echo "$1"; for k in $(pgrep -P "$1"); do tree "$k"; done; }

record() {
  [ -f "$PIDFILE" ] || { echo "no $PIDFILE"; return 1; }
  root=$(cat "$PIDFILE")
  touch "$REC"
  if kill -0 "$root" 2>/dev/null; then
    for p in $(tree "$root"); do
      line=$(ps -o pid=,pgid=,command= -p "$p" 2>/dev/null | sed -E 's/^ +//; s/  +/ /') || continue
      [ -n "$line" ] && echo "$line"
    done >> "$REC"
  fi
  sort -u -o "$REC" "$REC"
  echo "$job: $(wc -l < "$REC" | tr -d ' ') processes in groups $(groups_of | tr '\n' ' ')"
}

groups_of() { awk '{print $2}' "$REC" 2>/dev/null | sort -un; }

# A recorded process is alive when its pid still runs the command it ran when recorded.
alive() {
  [ -f "$REC" ] || return 0
  while read -r pid pgid cmd; do
    now=$(ps -o command= -p "$pid" 2>/dev/null | sed -E 's/  +/ /') || continue
    [ -n "$now" ] && [ "$now" = "$cmd" ] && echo "$pid $pgid $cmd"
  done < "$REC"
}

live_groups() { alive | awk '{print $2}' | sort -un; }

# builder, 9 Oct: a roll TERMed the dashboard mid-delivery and left the owner's message typed but unsent. deliver() types inside an open transaction
# that holds its activity insert, so before stopping dashboard-dev wait (up to 30s) until no such transaction is open, in the container the supervisor
# last found (its dashboard-db file; none found, no wait); and keep the dev log the
# next start truncates, as devlogs/dev-<utc>.log (the newest 10).
drain() {
  local i n c
  c=$(cat "$DIR/dashboard-db" 2>/dev/null); [ -n "$c" ] || return 0
  for i in $(seq 1 30); do
    n=$(docker exec "$c" psql -U postgres -tAc "select count(*) from pg_stat_activity where state like 'idle in transaction%' and query ilike 'insert into \"activity\"%'" 2>/dev/null | tr -d ' ')
    [ "${n:-0}" = 0 ] && { [ "$i" -gt 1 ] && echo "$job: drained after $((i - 1))s"; return 0; }
    sleep 1
  done
  echo "$job: a delivery was still typing after 30s; stopping anyway"
}
keep_log() {
  local log="$DIR/dev.log" d="$DIR/devlogs"
  [ -s "$log" ] || return 0
  mkdir -p "$d" && cp "$log" "$d/dev-$(date -u +%Y%m%dT%H%M%SZ).log" && chmod 600 "$d"/dev-*.log
  ls -1t "$d"/dev-*.log 2>/dev/null | tail -n +11 | while read -r f; do rm -f "$f"; done
}

stop() {
  [ "$job" = dashboard-dev ] && { drain; keep_log; }
  record >/dev/null 2>&1
  gs=$(live_groups)
  [ -z "$gs" ] && { echo "$job: nothing left to stop"; rm -f "$REC"; return 0; }
  for g in $gs; do kill -TERM -- "-$g" 2>/dev/null && echo "$job: TERM group $g"; done
  for i in $(seq 1 20); do [ -z "$(live_groups)" ] && break; sleep 0.5; done
  for g in $(live_groups); do kill -KILL -- "-$g" 2>/dev/null && echo "$job: KILL group $g"; done
  sleep 1
  if [ -n "$(alive)" ]; then echo "$job: still alive:"; alive; return 1; fi
  echo "$job: stopped, nothing left"; rm -f "$REC"
  # portless keeps a stopped stack's names registered a moment longer, and a start inside that window fails ("already registered by a
  # running process"), as the 12 Oct 13:43Z roll did: give it a few seconds
  [ "$job" != dashboard-dev ] || sleep 5
}

case "${1:-}" in
  record) record ;;
  stop) stop ;;
  left) alive ;;
  *) sed -n '2,/^[^#]/{/^#/p;}' "$0"; exit 2 ;;
esac
