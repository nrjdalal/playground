#!/bin/bash
# run-slot.sh <who> [--model-bound] [--after <pid>] -- <command> [args...]: run one heavy run (a suite, a type check, Checks, a build) holding one of the machine's run slots.
# A --model-bound run (one that mostly waits on a model, such as a parity replay) takes run-slot-model-<n> instead, at most slots.modelBound at once (model_cap, below), counted apart from the CPU slots and their queue.
# It takes ops/run-slot, run-slot-2, run-slot-3 or run-slot-4 by mkdir, as the load rules (lanes_open) open them and its size's load units fit, waiting and
# retrying while none does; writes "<who> <its own pid> <iso> <units> <size>" to the slot's .holder file beside it
# (a quick lane writes "<who> <pid> <iso>", the clone lane adding its two checkouts, clone_ends); runs the command as its
# child, in a new session and process group; and gives the slot back (rmdir) however it ends: success, failure or a signal. A holder whose
# pid has died is reclaimed; a slot whose holder line has no pid, or has no holder line, is held until it is 2 hours old, or while its age reads back empty. It prints the slot
# it took to stderr and exits with the command's code.
set -u
OPS=${RUN_SLOT_OPS:-${PLAYGROUND_DATA_DIR:-$HOME/.playground}/ops}
# this copy's path and arguments, so a waiter can run a newer copy in its place (reread, below)
SELF=$0
ARGS=("$@")
# LANES is capacity()'s one lanes verdict for a count (lanes_now), so a value from the caller's env would steer every slot check outside a count
unset LANES
# a waiter that runs a newer copy hands it its first ask's time, so the runs log has one ask and the whole wait; the command never sees it
REREAD=""
case "${RUN_SLOT_ASKED:-}" in
  ''|*[!0-9]*) ASKED=$(date +%s) ;;
  *) ASKED=$RUN_SLOT_ASKED; REREAD=1 ;;
esac
unset RUN_SLOT_ASKED
# the command reads run-slot's own stdin through fd 3, since bash gives a script's background job /dev/null (a heredoc ran as an empty
# program and exited 0); a closed stdin gives it /dev/null, as before
{ exec 3<&0; } 2>/dev/null || exec 3</dev/null
# a file's mtime, and its stamp (inode and mtime, through a symlink), in GNU stat's form (the runner host's Linux) or BSD's (the Mac)
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }
stamp() { stat -L -c '%i %Y' "$1" 2>/dev/null || stat -L -f '%i %m' "$1" 2>/dev/null; }
STAMP=$(stamp "$SELF")
# A hand-set runner-host/slot-off kept the runner box idle for two days, so each ops switch carries "<who> <iso set> <iso expiry> <reason>"
# (run-slot.sh set, below) and drops itself past its expiry; a file with no such line counts as set at its mtime with the default 4 hours, and as off while that mtime reads back empty
SWITCHES="run-slot.3-off run-slot.4-off run-slot.clone-off run-slot.focus run-slot.load5-cap run-slot.single runner-host/off runner-host/slot-off"
# whether switch $1 (a path under ops) is on; one past its expiry is moved to <name>.expired-<ts> and logged in run-slot.runs.log
switch_on() {
  local f="$OPS/$1" line ends now m
  [ -e "$f" ] || return 1
  line=$(head -n 1 "$f" 2>/dev/null)
  ends=$(printf '%s\n' "$line" | grep -E '^[^ ]+ [0-9-]{10}T[0-9:]{8}Z [0-9-]{10}T[0-9:]{8}Z ' | cut -d' ' -f3)
  now=$(date -u +%FT%TZ)
  if [ -n "$ends" ]; then
    [[ "$now" < "$ends" ]] && return 0
  else
    m=$(mtime "$f" || date +%s)
    # an mtime that reads back empty counts as the file gone, rather than as a shell error (4 Nov: the same read in stale printed "syntax error: operand expected")
    case "$m" in '' | *[!0-9]*) return 1 ;; esac
    [ $(( $(date +%s) - m )) -lt 14400 ] && return 0
  fi
  mv "$f" "$f.expired-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null && echo "$now expire ${WHO:-run-slot} $$ $1 $line" >> "$OPS/run-slot.runs.log"
  return 1
}
# whether pid $1 runs: kill -0 reaches it, or the kernel refuses the signal (another user's process, or one outside Claude Code's sandbox, which also refuses the setuid ps) rather than finding no such process
alive() {
  local err
  err=$(LC_ALL=C kill -0 "$1" 2>&1) || case "$err" in *"not permitted"*) true ;; *) false ;; esac
}
# whether focus for session $1 spares session $2's runs, neither holding nor preempting them: its own, its own reviewer's and tester's (by name or by the roster row's worker), and ops' upkeep (ops-tick's beats, the dashboard), which keep running (dispatcher, 5 Nov)
focus_spares() {
  case "$2" in "$1" | ops-dashboard | ops-tick) return 0 ;; esac
  case "$2" in "${1%-worker}-reviewer" | "${1%-worker}-tester") return 0 ;; *-reviewer | *-tester | reviewer-* | tester-*) ;; *) return 1 ;; esac
  # a checker with an id of its own is the focused session's when its roster row names it as the worker, the key spawn.sh writes and size_of reads
  python3 -I - "$2" "$1" <<'PY'
import json, os, sys

data = os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground"))
try:
    with open(os.path.join(data, "roster.json")) as f:
        agents = json.load(f).get("agents") or []
except (OSError, ValueError, AttributeError):
    agents = []
row = next((a for a in agents if isinstance(a, dict) and a.get("name") == sys.argv[1]), {})
sys.exit(0 if row.get("worker") == sys.argv[2] else 1)
PY
}
# whether slot directory $1, whose holder line is $2, is stale: its pid has died, or a line with no pid (or no line, read by the directory's
# own mtime) has aged 2 hours; a run killed between free()'s rm of its holder and its rmdir leaves a directory with no line
stale() {
  local pid m
  pid=$(printf '%s' "$2" | cut -d' ' -f2)
  if printf '%s' "$pid" | grep -Eq '^[0-9]+$'; then
    ! alive "$pid"
  else
    m=$(mtime "$1.holder" || mtime "$1" || date +%s)
    # an mtime that reads back empty counts as young, rather than as a shell error (4 Nov: "<epoch> -  : syntax error: operand expected")
    case "$m" in '' | *[!0-9]*) return 1 ;; esac
    [ $(( $(date +%s) - m )) -ge 7200 ]
  fi
}
# a setting's value as JSON, as the settings reader in this script's checkout prints it, its default on a machine with no extensions; a reader that cannot answer says why on stderr
setting() {
  "$BUN" "$(checkout_root)/packages/scripts/src/playground/setting.ts" "$1" </dev/null
}
BUN=$(command -v bun || echo "$HOME/.bun/bin/bun")
# the checkout this script sits in, past the state folder's link to it
checkout_root() { python3 -I -c 'import os, sys; print(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(sys.argv[1])))))' "$SELF"; }
# The item size a session's runs and starts count, and its load units (load is split by item so a big plan never
# blocks small ones; small:medium:big weigh 1:2:3): RUN_SLOT_SIZE, else small for commit-<worktree>, a pre-commit step that runs in
# seconds and as its branch's big item waited 815s behind smaller runs, else the roster entry's size (a checker falls back to its worker's, and
# ops-checks-<n> reads the worker on factory.repo's PR n), else the plan.json item for issue <n> (its id PG-<n>, or its spec that issue's URL) that its
# branch PG-<n>-..., in either case (the roster's, else the checkout's) names, else medium
size_of() {
  local repo=""
  case "$1" in ops-checks-*) repo=$(setting factory.repo | tr -d '"') ;; esac
  python3 -I - "$1" "$(git symbolic-ref --short HEAD 2>/dev/null)" "$repo" <<'PY'
import json, os, re, sys

who, branch, repo = sys.argv[1], sys.argv[2], sys.argv[3].lower()
UNITS = {"small": 1, "medium": 2, "big": 3}

def done(size):
    print(size, UNITS[size])
    sys.exit(0)

if os.environ.get("RUN_SLOT_SIZE") in UNITS:
    done(os.environ["RUN_SLOT_SIZE"])
if who.startswith("commit-"):
    done("small")
# The data folder roster.ts reads, as dataDir() resolves it: PLAYGROUND_DATA_DIR, else .playground in the home folder.
data = os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground"))

def load(name):
    try:
        with open(os.path.join(data, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None

roster = load("roster.json")
agents = [a for a in ((roster.get("agents") or []) if isinstance(roster, dict) else []) if isinstance(a, dict) and isinstance(a.get("name"), str)]
by = {a["name"]: a for a in agents}
entry = by.get(who)
checks = re.fullmatch(r"ops-checks-(\d+)", who)
if checks:
    entry = next((a for a in agents if repo and str(a.get("pr", "")).lower().endswith(f"github.com/{repo}/pull/{checks.group(1)}") and not (a.get("kind") in ("reviewer", "tester") or re.fullmatch(r"(?:reviewer|tester)-.+|[23456789bcdfghjkmnpqrstvwxyz]{6}-(?:reviewer|tester)", a["name"]))), None)
chain = [e for e in (entry, by.get((entry or {}).get("worker"))) if e]
for e in chain:
    if e.get("size") in UNITS:
        done(e["size"])
branch = next((e["branch"] for e in chain if isinstance(e.get("branch"), str)), branch)

def find(node, n):
    if isinstance(node, dict):
        if (node.get("id") == f"PG-{n}" or str(node.get("spec", "")).endswith(f"/issues/{n}")) and node.get("size") in UNITS:
            return node["size"]
        node = list(node.values())
    if isinstance(node, list):
        for v in node:
            found = find(v, n)
            if found:
                return found
    return None

issue = re.match(r"pg-(\d+)-", branch, re.I)
if issue:
    found = find(load("bundles/plan.json"), issue.group(1))
    if found:
        done(found)
done("medium")
PY
}
# run-slot.sh box-off: print, one word a line, each precondition of the runner-box route (below) that fails, for ops-sweep's box-route-off finding, since a run otherwise falls back to this Mac without a word; nothing when the route can fire
if [ "${1:-}" = box-off ]; then
  [ -x "$OPS/runner-host/ci.sh" ] || echo no-ci-sh
  [ -e "${RUNNER_HOST_KEY:-$HOME/.ssh/playground_runner}" ] || echo no-ssh-key
  switch_on runner-host/off && echo runner-host-off
  switch_on runner-host/slot-off && echo slot-off
  exit 0
fi
# run-slot.sh clear-stale: remove each slot's leftover holder (and its directory) whose pid is dead, or whose directory is already gone,
# and each slot directory with no holder line that is 2 hours old.
# Sessions call this instead of a bare rm under ~/.claude, which raises Claude Code's delete prompt even in bypass mode (dispatcher, 12 Oct).
if [ "${1:-}" = clear-stale ]; then
  for s in run-slot run-slot-2 run-slot-3 run-slot-4 run-slot-commit run-slot-clone run-slot-quick $(ls "$OPS" 2>/dev/null | sed -n 's/^\(run-slot-model-[0-9]*\)\(\.holder\)\{0,1\}$/\1/p' | sort -u); do
    h="$OPS/$s.holder"
    if [ ! -e "$h" ]; then
      [ -d "$OPS/$s" ] && stale "$OPS/$s" "" && rmdir "$OPS/$s" 2>/dev/null && echo "$s: cleared a slot directory with no holder line"
      continue
    fi
    pid=$(cut -d' ' -f2 "$h" 2>/dev/null)
    if printf '%s' "$pid" | grep -Eq '^[0-9]+$' && alive "$pid"; then
      [ -d "$OPS/$s" ] && { echo "$s: held by $(cut -d' ' -f1 "$h") (pid $pid, alive); left alone"; continue; }
    fi
    line=$(cat "$h" 2>/dev/null)
    [ -d "$OPS/$s" ] && rmdir "$OPS/$s" 2>/dev/null
    rm -f "$h" && echo "$s: cleared a stale holder ($line)"
  done
  exit 0
fi
# run-slot.sh preempt: while run-slot.focus stands, TERM the process group of each <slot>.child that focus does not spare, only while it is still its holder's child leading its own group, so an urgent ticket's fix goes first (scripts/ops/README.md)
if [ "${1:-}" = preempt ]; then
  [ $# -eq 1 ] || { echo "usage: run-slot.sh preempt" >&2; exit 2; }
  switch_on run-slot.focus || { echo "run-slot.sh: no focus stands (run-slot.focus), so preempt stops nothing" >&2; exit 2; }
  h=$(cut -d' ' -f1 "$OPS/run-slot.focus")
  for s in run-slot run-slot-2 run-slot-3 run-slot-4 run-slot-commit run-slot-clone run-slot-quick $(ls "$OPS" 2>/dev/null | sed -n 's/^\(run-slot-model-[0-9]*\)\.holder$/\1/p' | sort -u); do
    [ -f "$OPS/$s.holder" ] && read -r who pid _ < "$OPS/$s.holder" || continue
    child=$(cat "$OPS/$s.child" 2>/dev/null)
    printf '%s' "$pid$child" | grep -Eq '^[0-9]+$' || continue
    focus_spares "$h" "$who" && continue
    [ "$(ps -o ppid=,pgid= -p "$child" 2>/dev/null | awk '{print $1, $2}')" = "$pid $child" ] || { echo "$s: $who's run has no child of its holder leading its own group; left alone"; continue; }
    echo "$child" > "$OPS/$s.preempted"
    kill -TERM -- "-$child" 2>/dev/null && echo "$(date -u +%FT%TZ) preempt $who $pid child=$child slot=$s focus=$h" >> "$OPS/run-slot.runs.log" && echo "$s: preempted $who's run (pid $child) for $h's focus"
  done
  exit 0
fi
# run-slot.sh size <who>: print the size and units size_of reads for that session (spawn.sh's load gate counts a start by it)
if [ "${1:-}" = size ]; then
  [ $# -eq 2 ] || { echo "usage: run-slot.sh size <who>" >&2; exit 2; }
  size_of "$2"
  exit
fi
# run-slot.sh set <who> <switch> [<value>] --reason "<why>" [--for <n>m|<n>h]: turn on switch 3-off, 4-off, clone-off, focus, load5-cap, single,
# or the runner host's off or slot-off, for 4 hours unless --for says; a value (load5-cap's cap) goes on the line below. A set with no reason is refused
if [ "${1:-}" = set ]; then
  usage='usage: run-slot.sh set <who> <switch> [<value>] --reason "<why>" [--for <n>m|<n>h]'
  [ $# -ge 3 ] || { echo "$usage" >&2; exit 2; }
  who=$2 name=$3 value="" reason="" span=4h
  shift 3
  while [ $# -gt 0 ]; do
    case "$1" in
      --reason) reason=${2:-}; shift; shift ;;
      --for) span=${2:-}; shift; shift ;;
      *) [ -z "$value" ] || { echo "$usage" >&2; exit 2; }; value=$1; shift ;;
    esac
  done
  case "$who" in *[!A-Za-z0-9._#-]*|"") echo "run-slot.sh: <who> is a session name (letters, digits, . _ - #)" >&2; exit 2 ;; esac
  case "$name" in
    off|slot-off) path=runner-host/$name ;;
    3-off|4-off|clone-off|focus|load5-cap|single) path=run-slot.$name ;;
    *) echo "run-slot.sh: no switch $name (3-off, 4-off, clone-off, focus, load5-cap, single, off, slot-off)" >&2; exit 2 ;;
  esac
  [ -n "$reason" ] || { echo "run-slot.sh: a set takes --reason \"<why>\", so whoever finds the switch on knows why it stands" >&2; exit 2; }
  case "$span" in [0-9]*m) unit=60 ;; [0-9]*h) unit=3600 ;; *) unit= ;; esac
  n=${span%[mh]}
  case "$n" in ""|*[!0-9]*|0*) unit= ;; esac
  [ -n "$unit" ] || { echo "run-slot.sh: --for takes a count of minutes or hours above 0, such as 30m or 4h" >&2; exit 2; }
  # focus stands 180 minutes at most (dispatcher, 5 Nov: run-slot.focus is approved on that cap)
  [ "$name" != focus ] || [ $((n * unit)) -le 10800 ] || { echo "run-slot.sh: focus stands 180 minutes at most" >&2; exit 2; }
  iso() { date -u -d "@$1" +%FT%TZ 2>/dev/null || date -u -r "$1" +%FT%TZ; }
  at=$(date +%s)
  ends=$(iso $((at + n * unit)))
  mkdir -p "$(dirname "$OPS/$path")"
  { echo "$who $(iso "$at") $ends $(printf '%s' "$reason" | tr '\n' ' ')"; [ -z "$value" ] || echo "$value"; } > "$OPS/$path.set-$$" && mv "$OPS/$path.set-$$" "$OPS/$path" || exit 1
  echo "run-slot.sh: $path is on until $ends"
  exit 0
fi
# every read subcommand below sets CAN_TAKE, so quick_kind never sends its bare true down the quick lane (run-slot-can-take.test.ts runs each)
# run-slot.sh can-take <slot> <who>: exit 0 when that slot is free, its off-switches, load rules and burst_held open it, and the load units (with that
# session's reserve) fit, else 1, so a script that takes its slot itself reads them as every run here does (ops-unstick does; localci and
# the merge train still take theirs by their own mkdir for now); it reads neither the queue nor run-slot.priority
CAN_TAKE=
# run-slot.sh head: prints the queue's head, the ticket first_waiter names (<ns>-<pid>-<who>), or nothing, so ops-unstick watches the waiter the queue serves next rather than the oldest
HEAD_ONLY=
if [ "${1:-}" = head ]; then
  [ $# -eq 1 ] || { echo "usage: run-slot.sh head" >&2; exit 2; }
  HEAD_ONLY=1 CAN_TAKE=run-slot
  set -- ops-unstick -- true
fi
# run-slot.sh slots: prints how many of run-slot to run-slot-4 are held or open now by the load rules and off-switches, the heavy-job cap ops-unstick reads
SLOTS_ONLY=
if [ "${1:-}" = slots ]; then
  [ $# -eq 1 ] || { echo "usage: run-slot.sh slots" >&2; exit 2; }
  SLOTS_ONLY=1 CAN_TAKE=run-slot
  set -- ops-unstick -- true
fi
# run-slot.sh room: prints "<lanes> <held> <free> <waiters>": the lanes slots counts, how many a run holds, how many a medium run could take now (the open, unheld ones while its load units fit beside the held runs' and slots.peers', less the reserve), and the live tickets in the queue, which spawn.sh's slots gate reads
ROOM_ONLY=
if [ "${1:-}" = room ]; then
  [ $# -eq 1 ] || { echo "usage: run-slot.sh room" >&2; exit 2; }
  ROOM_ONLY=1 CAN_TAKE=run-slot
  set -- ops-unstick -- true
fi
if [ "${1:-}" = can-take ]; then
  [ $# -eq 3 ] || { echo "usage: run-slot.sh can-take <slot> <who>" >&2; exit 2; }
  case "$2" in run-slot|run-slot-2|run-slot-3|run-slot-4) CAN_TAKE=$2 ;; *) echo "run-slot.sh: no slot $2" >&2; exit 2 ;; esac
  set -- "$3" -- true
fi
MODEL_BOUND=
AFTER=
while [ -z "$CAN_TAKE" ]; do
  case "${2:-}" in
    --model-bound) MODEL_BOUND=1; set -- "$1" "${@:3}" ;;
    --after)
      case "${3:-}" in 0*|1) echo "run-slot.sh: --after $3 names no run (a pid of 0 or 1 is never a run's, and kill -0 0 always succeeds), so this run never waits: give the pid on the first run's ask line" >&2; exit 2 ;; esac
      case "${3:-}" in ''|*[!0-9]*) echo "run-slot.sh: --after takes the pid on the first run's ask line in run-slot.runs.log (ask <who> <pid>)" >&2; exit 2 ;; esac
      AFTER=$3; set -- "$1" "${@:4}" ;;
    *) break ;;
  esac
done
if [ $# -lt 3 ] || [ "$2" != "--" ]; then
  echo "usage: run-slot.sh <who> [--model-bound] [--after <pid>] -- <command> [args...]" >&2
  exit 2
fi
WHO=$1
shift 2
case "$WHO" in *[!A-Za-z0-9._#-]*|"") echo "run-slot.sh: <who> is a session name (letters, digits, . _ - #)" >&2; exit 2 ;; esac
# every run drops each expired switch, so the readers that only look for the file (the merge train, Checks, the leads' sweep) find it gone too
for s in $SWITCHES; do switch_on "$s"; done
# a dev stack never ends, so it would hold a slot for hours (dispatcher, 19 Oct: a tester's `bun run dev` held run-slot.single with 7 waiters)
for a in "$@"; do
  case "$a" in dev|dev:*) echo "run-slot.sh: a dev stack runs as a background task under the load gate, not through run-slot" >&2; exit 2 ;; esac
done
# dispatcher, 18 Oct: a command that never exits holds its slot until it is stopped (keen-ledger's dev stack held one from 21:13Z to 21:58Z)
if printf ' %s' "$@" | grep -qE ' (bun|npm|pnpm|yarn) run dev( |$)| next dev( |$)| ingest .*--follow| --watch(=| |$)'; then
  echo "run-slot.sh: $* never exits, so it would hold a slot until stopped (slots): start a fixture stack outside run-slot, only while you take shots" >&2
  exit 2
fi
# zsh does not word-split an unquoted variable, so `run-slot.sh <who> -- pytest $FILES` passed 18 paths as one argument and ran none; REREAD skips it, so a waiter running a newer copy warns once
if [ -z "$REREAD" ]; then
  for a in "$@"; do
    case "$a" in
      *[[:space:]]*)
        read -r -d '' -a words <<< "$a"
        if [ ${#words[@]} -ge 2 ]; then
          for w in "${words[@]}"; do
            [ -e "$w" ] || continue 2
          done
          echo "run-slot.sh: '$a' is one argument holding only existing paths, which zsh did not word-split: pass them as separate words (\${=VAR} in zsh, or xargs)" >&2
        fi
        ;;
    esac
  done
fi
# --after <pid>: a run that needs <who>'s run <pid> to land first waits here, with no ask line, ticket or slot, until that run's end line: rc=0 asks, any other rc exits with it, and a pid gone with no end line exits 2 (4 Nov: a run that polled for another inside its slot held run-slot-2 for 1575 s while that run sat behind it in the queue)
# the last state of <who>'s run $1 in run-slot.runs.log: pending (asked, no end yet), ended <rc>, or none
after_state() {
  tail -n 20000 "$OPS/run-slot.runs.log" 2>/dev/null | W=$WHO P=$1 awk '
    $3 == ENVIRON["W"] && $4 == ENVIRON["P"] { if ($2 == "ask") s = "pending"; else if ($2 == "end") s = "ended " substr($5, 4) }
    END { print (s == "" ? "none" : s) }'
}
if [ -n "$AFTER" ] && [ -z "$REREAD" ]; then
  told=
  while :; do
    gone=
    alive "$AFTER" || gone=1
    st=$(after_state "$AFTER")
    case "$st" in
      "ended 0") break ;;
      ended\ *) echo "run-slot.sh: $WHO's run $AFTER ended rc=${st#ended }, so this run never asks" >&2; exit "${st#ended }" ;;
    esac
    if [ -n "$gone" ]; then
      echo "run-slot.sh: $WHO's run $AFTER has ended with no end line in run-slot.runs.log (a runner-host run, or one stopped hard), so this run never asks: read that run's result, then run this one again" >&2
      exit 2
    fi
    [ -n "$told" ] || { echo "run-slot.sh: waiting for $WHO's run $AFTER to end before this one asks (--after)" >&2; told=1; }
    sleep "${RUN_SLOT_POLL:-5}"
  done
  ASKED=$(date +%s)
fi
# bun run pr:merge or pr:train, as the whole command, runs at once outside the queue once any --after wait ends, since a merge carries its own gates and its type steps take their own slots (5 Nov: three wrapped merges in an hour each waited behind the heavy queue, and each inner type step queued again)
if [ "${1:-}" = bun ] && [ "${2:-}" = run ] && { [ "${3:-}" = pr:merge ] || [ "${3:-}" = pr:train ]; }; then
  echo "run-slot.sh: bun run $3 runs at once, outside the queue: a merge carries its own gates, and its type steps take their own slots (packages/scripts/src/pr-merge/README.md)" >&2
  exec "$@" 3<&-
fi
# dispatcher, 18 Oct: a test, type check (from the checkout's root), lint or format check runs on the runner host, taking no slot here. ci.sh exec
# sends the working tree, tracked edits and untracked source alike, and gives back the command's output and exit code; anything else (a browser,
# verify, an install, a dev stack) waits for a slot here, and so does a run the box cannot take (ci.sh exits 255, as on an untracked file it does not take).
# The box has no /private/tmp, so a run that sets TMPDIR to a Mac path takes RUN_SLOT_HERE=1.
# runner-host/off and runner-host/slot-off turn it off; every box run is a line in runner-host/runs.log.
box_dir() {
  local prev="" a
  for a in "$@"; do
    case "$a" in --cwd=*) echo "${a#--cwd=}"; return ;; esac
    case "$prev" in --cwd|-C) echo "$a"; return ;; esac
    prev=$a
  done
  pwd
}
box_fits() {
  local a first="" line=" $* "
  # RUN_SLOT_HERE=1, in run-slot's environment or as an env word of the command, keeps the run on this Mac (builder, 19 Oct: a Mac rerun of a red seen only on the box)
  [ -n "${RUN_SLOT_HERE:-}" ] && return 1
  for a in "$@"; do case "$a" in RUN_SLOT_HERE=?*) return 1 ;; esac; done
  for a in "$@"; do
    case "$a" in env|*=*) continue ;; esac
    first=$a
    break
  done
  case "$first" in bun|bunx) ;; *) return 1 ;; esac
  # a build's output is this Mac's dist, so a build stays here (worker-firm-keel, 19 Oct)
  printf '%s' "$line" | grep -qE ' (test|run test|test:file|check-types|run check-types|lint|run lint|test:skills|run test:skills|format:check|run format:check)( |$)' || return 1
  if printf '%s' "$line" | grep -qE ' (check-types|run check-types)( |$)'; then
    local d p
    d=$(box_dir "$@")
    # a type check goes only from a checkout's root: one from a subfolder (--cwd=<wt>/web/next) reads the other workspaces' dist, which the box lacks (worker-firm-keel, 19 Oct: 332 false errors)
    [ -e "$d/.git" ] || return 1
    # a type check here also builds this checkout's packages/*/dist, which a later run on the Mac imports, so it stays here while one is missing (round 2); this checks that a dist exists, not that it is fresh
    for p in "$d"/packages/*/package.json; do
      grep -q '"build"' "$p" 2>/dev/null && [ ! -d "$(dirname "$p")/dist" ] && return 1
    done
  fi
  # a word that needs this Mac (a browser, a stack, docker, an install) keeps the run here; a path is judged only as an e2e test (a review's finding)
  for a in "$@"; do
    case "$a" in
      */*) case "$a" in *.e2e.*) return 1 ;; esac ;;
      *verify*|*e2e*|*install*|*shadcn*|*playwright*|agent-browser|--watch|dev|dev:*|*docker*) return 1 ;;
    esac
  done
}
# runner-host/slot-off keeps run-slot's runs here and leaves the box to Checks (ops, 20 Oct: 19 one-file runs queued ahead of 3 gate suites on its 2 slots)
if [ -z "$CAN_TAKE" ] && [ -z "$MODEL_BOUND" ] && [ -x "$OPS/runner-host/ci.sh" ] && ! switch_on runner-host/off && ! switch_on runner-host/slot-off && box_fits "$@"; then
  BOXDIR=$(box_dir "$@")
  # the box runs BOXDIR's checkout, so a path in another one would run in the wrong tree there and go red as "Script not found" (9jhtsd, 24 Oct)
  checkout_of() {
    local d=$1
    while [ ! -d "$d" ] && [ "$d" != / ]; do d=$(dirname "$d"); done
    d=$(cd "$d" 2>/dev/null && pwd -P) || return
    while [ "$d" != / ] && [ ! -e "$d/.git" ]; do d=$(dirname "$d"); done
    [ "$d" != / ] && echo "$d"
  }
  here=$(checkout_of "$BOXDIR")
  for a in "$@"; do
    case "$a" in /*) there=$(checkout_of "$a") ;; *) continue ;; esac
    if [ -n "$there" ] && [ "$there" != "$here" ]; then
      echo "run-slot.sh: $a is in the checkout $there, but the runner host runs ${here:-$BOXDIR}'s: run from inside $there, or pass --cwd $there" >&2
      exit 2
    fi
  done
  echo "run-slot.sh: $WHO runs this on the runner host, with no slot here" >&2
  echo "$(date -u +%FT%TZ) start $WHO $BOXDIR $*" >> "$OPS/runner-host/runs.log"
  bash "$OPS/runner-host/ci.sh" exec "$BOXDIR" -- "$@"
  rc=$?
  echo "$(date -u +%FT%TZ) end $WHO rc=$rc" >> "$OPS/runner-host/runs.log"
  [ "$rc" -ne 255 ] && exit "$rc"
  echo "run-slot.sh: the runner host could not take it, so it waits for a slot here" >&2
fi
# a `sh -c`, `bash -c` or `zsh -c` chain's steps, or those of a `bash <script file>`, whose arguments only a $ word reads (5 Nov: a script that only
# commits waited in the general queue), one a line, each step's words joined by the unit separator, as python's shlex splits the script at each run of
# &, |, ;, <, > and parentheses, zsh's |& and &| among them (a line whose first word starts with # is a comment, dropped whatever it ends with, a line
# ending in an odd run of `\` is joined to the next, as sh does, and a newline then counts as ;); a cd beside any other separator than && or ; keeps
# it as a word, since that cd does not carry to the next step, and env words before the shell (a BASH_ENV or PATH changes what it runs) are a step of
# their own; nothing for any other command, a file after an option word (`--rcfile a.sh b.sh` runs b.sh), or a script shlex cannot split or a file
# over 64 KB
chain_steps() {
  local a first="" script="" next="" file="" opt="" lead=""
  for a in "$@"; do
    [ -n "$next" ] && { script=$a; break; }
    [ -n "$file" ] && break
    case "$a" in env|*=*) [ -z "$first" ] && { lead+=$a$'\x1f'; continue; } ;; esac
    if [ -z "$first" ]; then first=$(basename -- "$a"); case "$first" in sh|bash|zsh) continue ;; *) return ;; esac; fi
    case "$a" in -c | -[!-]*c) next=1 ;; -*) opt=1 ;; *) [ -z "$opt" ] || return; file=$a ;; esac
  done
  if [ -n "$file" ]; then plain "$file" && [ -f "$file" ] && [ -r "$file" ] || return; fi
  [ -n "$script$file" ] || return
  python3 -I - "${file:+-f}${script:+-c}" "$file$script" "${lead%$'\x1f'}" <<'PY'
import shlex, sys

try:
    text = sys.argv[2]
    if sys.argv[1] == "-f":
        with open(text, encoding="utf-8") as f:
            text = f.read(65537)
        if len(text) > 65536:
            sys.exit(1)
    lines, buf = [], None
    for line in text.split("\n"):
        if buf is None and line.lstrip().startswith("#"):
            continue
        buf = line if buf is None else buf + line
        if (len(buf) - len(buf.rstrip("\\"))) % 2:
            buf = buf[:-1]
            continue
        lines.append(buf)
        buf = None
    text = "\n".join(lines + ([buf] if buf is not None else []))
    lex = shlex.shlex(text.replace("\n", "\n;"), posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    lex.commenters = ""
    steps, seps = [[]], [""]
    for tok in lex:
        if tok and not tok.strip("&|;<>()"):
            steps.append([])
            seps.append(tok)
        else:
            steps[-1].append(tok)
except (OSError, ValueError):
    sys.exit(1)
seps.append("")
if sys.argv[3]:
    print(sys.argv[3])
for i, step in enumerate(steps):
    if step[:1] == ["cd"]:
        step += [s for s in (seps[i], seps[i + 1]) if s not in ("", "&&", ";")]
    if step:
        print("\x1f".join(step))
PY
}
# a chain step's git subcommand, past env, VAR=x and git's -C <dir> or -c <value>; nothing for a step that runs no git
git_verb() {
  local a state=lead
  for a in "$@"; do
    case "$state" in
      lead) case "$a" in env|*=*) continue ;; esac; [ "$(basename -- "$a")" = git ] || return; state=git ;;
      git) case "$a" in -C|-c) state=value ;; -*) ;; *) echo "$a"; return ;; esac ;;
      value) state=git ;;
    esac
  done
}
# a word sh would leave as written: no $, backquote, ~, glob, brace or # (a comment to sh, which shlex here keeps as a word), so the word run-slot
# reads is the word the command gets; a ( is left alone, since chain_steps splits at each unquoted one, so a word that keeps one was quoted or escaped (a type(scope): commit message)
plain() { local a; for a in "$@"; do case "$a" in *'$'* | *'`'* | *'~'* | *'*'* | *'?'* | *'['* | *'{'* | *'#'*) return 1 ;; esac; done; }
# a chain's git add words, failing closed (builder, 5 Nov): paths, and only the flags whose staging chain_add reads, never -f, which stages ignored files
add_flags() { local w; for w in "$@"; do case "$w" in -A | --all | -u | --update | -- | --pathspec-from-file=*) ;; -*) return 1 ;; esac; done; }
# a script's `set` words that only switch -e, -o pipefail, -u or -x, as a chain script's `set -euo pipefail` does (set -k reads a later VAR=x as env)
set_flags() { local w; for w in "$@"; do case "$w" in pipefail) ;; [-+] | [-+]*[!eoux]*) return 1 ;; [-+]*) ;; *) return 1 ;; esac; done; }
# an absolute folder in a git repo, written plain
abs_in_repo() { case "${1:-}" in /*) ;; *) return 1 ;; esac; plain "$1" && git -C "$1" rev-parse --show-toplevel >/dev/null 2>&1; }
# Whether every step of a chain is a form the commit lane proves safe, a closed list (builder, 5 Nov: three review rounds each found one more form
# a reading of cd, ~ or env let through): a git add, commit or push in run-slot's own folder, a `cd` to an absolute folder in a repo, a git add,
# commit or push after it or as `git -C <that kind of folder>`, `bun run precommit:light`, and a script's `set` of shell options, each word plain.
# CHAIN_SAFE then holds each git step as `git -C <folder> <verb> ...`, joined by \x1f, one a line; else CHAIN_BAD holds the first step outside the list. Any other form, an env
# prefix, ~, $HOME, a backquote, cd - or a relative folder, is outside it, with no attempt to resolve it.
CHAIN_SAFE="" CHAIN_BAD=""
chain_safe() {
  local line words cdir="" folder verb rest=()
  CHAIN_SAFE="" CHAIN_BAD=""
  while IFS= read -r line; do
    IFS=$'\x1f' read -ra words <<< "$line"
    [ ${#words[@]} -gt 0 ] || continue
    CHAIN_BAD=${line//$'\x1f'/ }
    case "${words[0]}" in
      cd) [ ${#words[@]} -eq 2 ] && abs_in_repo "${words[1]}" || return 1; cdir=${words[1]}; continue ;;
      bun) [ "${words[1]:-}" = run ] && [ "${words[2]:-}" = precommit:light ] && plain "${words[@]}" || return 1; continue ;;
      set) set_flags "${words[@]:1}" || return 1; continue ;;
      git) ;;
      *) return 1 ;;
    esac
    plain "${words[@]}" || return 1
    if [ "${words[1]:-}" = -C ]; then
      abs_in_repo "${words[2]:-}" || return 1
      folder=${words[2]} verb=${words[3]:-} rest=("${words[@]:4}")
    else
      folder=${cdir:-$PWD} verb=${words[1]:-} rest=("${words[@]:2}")
    fi
    case "$verb" in add) add_flags ${rest[@]+"${rest[@]}"} || return 1 ;; commit|push) ;; *) return 1 ;; esac
    CHAIN_SAFE+=$(printf '%s\x1f' git -C "$folder" "$verb" ${rest[@]+"${rest[@]}"})$'\n'
  done < <(chain_steps "$@")
  CHAIN_BAD=""
}
# a chain's lane: `commit` when it commits or pushes and chain_safe takes every step, so it ends in seconds as a bare commit does (4 Nov: a
# docs-only commit and push inside sh -c waited about 45 minutes in the general queue); `general <step>` for one that commits or pushes with a
# step outside that list, which run-slot says, so its worker can run the commit on its own; else nothing
chain_lane() {
  local line words commits=""
  while IFS= read -r line; do
    IFS=$'\x1f' read -ra words <<< "$line"
    [ ${#words[@]} -gt 0 ] || continue
    case "$(git_verb "${words[@]}")" in commit|push) commits=1 ;; esac
  done < <(chain_steps "$@")
  [ -n "$commits" ] || return
  if chain_safe "$@"; then echo commit; else echo "general $CHAIN_BAD"; fi
}
# Quick slots, outside the queue, one holder each: a plain git commit (its pre-commit build, about 17s) takes run-slot-commit (builder,
# 13 Oct: five commits waited in a fifteen-deep queue; a commit with a longer hook goes through the queue as <who> -- bash -c '...'), and a
# node_modules clone (cp -cR <sibling>/node_modules <worktree>/) takes run-slot-clone (dispatcher, 13 Oct: three load spikes, 77 and 43
# among them, each with fseventsd near 100% while clones ran at once); a git merge or pull takes run-slot-commit too, and a short bun test,
# docs:wrap or format:check takes run-slot-quick
quick_rule() {
  local a first=""
  # a pre-commit step commit-slot.ts hands over (the build or a type check), marked RUN_SLOT_COMMIT_STEP=1 under its commit-<worktree> name, is a plain git commit's own step, so it takes run-slot-commit too (3 Nov: a plain commit's build waited about an hour in the queue)
  case "$WHO" in commit-*) [ "${RUN_SLOT_COMMIT_STEP:-}" = 1 ] && { echo commit; return; } ;; esac
  # the command's first word past env and VAR=x, as box_fits finds it (optimizer, 19 Oct: a commit run as env NODE_ENV=... git commit waited 14 min in the queue)
  for a in "$@"; do case "$a" in env|*=*) continue ;; esac; first=$a; break; done
  case "$(basename -- "$first")" in sh|bash|zsh) [ "$(chain_lane "$@")" = commit ] && echo commit; return ;; esac
  if [ "$(basename -- "$first")" = git ]; then
    # a merge or pull runs no pre-commit build (lefthook.yml has no merge hook), so it ends in seconds (optimizer, 20 Oct: a 1s git merge waited 26.6 min behind suites)
    # a push runs only the pre-push hook's seconds (retro 2, 31 Oct: git push queued 205 min in a day)
    for a in "$@"; do case "$a" in commit|merge|pull|push) echo commit; return ;; esac; done
  elif [ "$(basename -- "$first")" = cp ]; then
    for a in "$@"; do a=${a%/.}; case "${a%/}" in node_modules|*/node_modules) echo clone; return ;; esac; done
  elif [ "$(basename -- "$first")" = bun ]; then
    # a bun test or bun run test:file naming 1 to 3 test files under tests/, nothing else, takes run-slot-quick, with --cwd=<p> anywhere or a bare --cwd after run or test, since bun misreads one before the subcommand (scripts/hooks/README.md's no-false-green; ops, 20 Oct: with slot-off, a 5-file run that ran 1s waited 52 min behind suites; PG-2158)
    # bun run docs:wrap and format:check never run past seconds (run-slot.runs.log, 20 Oct: max 2s and 9s), so they take run-slot-quick too
    for a in "$@"; do case "$a" in docs:wrap|format:check) echo quick; return ;; esac; done
    # bun install --ignore-scripts after a node_modules clone only links what the clone holds (retro 2, 31 Oct: 619 min queued in a day)
    case " $* " in *" install --ignore-scripts "* | *" install "*" --ignore-scripts "*) echo quick; return ;; esac
    local n=0 t="" skip=""
    for a in "$@"; do
      [ -n "$skip" ] && { skip=""; continue; }
      if [ "$a" = --cwd ]; then [ -n "$t" ] && skip=1 || return; continue; fi
      case "$a" in env|*=*|-*) continue ;; esac
      [ "$a" = "$first" ] && continue
      # only a test file under the repo's tests/ folder counts, so a replay of scratch test files goes through the queue (retro 35: one held the quick slot 30 min, and its waiters waited 87 min in all)
      case "$a" in run|test|test:file) t="$t $a" ;; *.e2e.* | */../*) return ;; tests/*.test.ts|tests/*.test.tsx|./tests/*.test.ts|./tests/*.test.tsx) n=$((n + 1)) ;; *) return ;; esac
    done
    case "$t" in " test" | " run test:file") [ "$n" -ge 1 ] && [ "$n" -le 3 ] && echo quick ;; esac
  fi
}
# whether each of the last 3 runs of this exact command line in run-slot.runs.log ran over $2 s ($1 over) or $2 s or less ($1 within); the words after them are the line
ran_last3() {
  local side=$1 bound=$2; shift 2
  tail -n 20000 "$OPS/run-slot.runs.log" 2>/dev/null | RUN_LINE="$*" BOUND=$bound SIDE=$side awk '
    $2 == "ask" { c = $0; for (k = 0; k < 4; k++) sub(/^[^ ]+ /, "", c); line[$4] = c; next }
    $2 == "end" && line[$4] == ENVIRON["RUN_LINE"] { delete line[$4]; for (i = 5; i <= NF; i++) if ($i ~ /^ran=[0-9]+s$/) r[++n] = substr($i, 5) + 0 }
    END { if (n < 3) exit 1; for (i = n - 2; i <= n; i++) if ((r[i] > ENVIRON["BOUND"] + 0) != (ENVIRON["SIDE"] == "over")) exit 1 }'
}
# each of the last 3 ended in 10 s or less (retro 2, 31 Oct: 408 of 686 CPU-lane runs did, and queued 2,004 min against 17 min of running)
ran_short() { ran_last3 within 10 "$@"; }
# each of the last 3 ran over 60 s (1 Nov: a two-file test:file line ran 39, 421 and 226 s back to back in the one quick slot, and the quick lane's waiters waited 63 min in the hour from 12:00Z)
ran_long() { ran_last3 over 60 "$@"; }
# the slot a command takes outside the queue: its rule's, else quick when it ran short its last 3 times, so a long run after short ones holds the one quick slot and sends the next back to the queue; a line the rule calls quick that ran long its last 3 times goes to the queue, since its file count says nothing of its time
quick_kind() {
  # a read command takes no slot and runs a bare true, so three short true runs in the log would take can-take and head down the quick lane, past their own exits (issue 285)
  [ -n "$CAN_TAKE" ] && return
  [ -n "$HEAVY" ] && return
  local kind
  kind=$(quick_rule "$@")
  [ "$kind" = quick ] && ran_long "$@" && kind=""
  [ -z "$kind" ] && ran_short "$@" && kind=quick
  echo "$kind"
}
# whether turbo's dry run, in the run's checkout and with its env words, finds every check-types task and the builds under it cached; a dry run that fails or takes over 10 s counts as not cached (retro 5, 31 Oct: the dry run takes about 0.2 s, while 88 of 226 check-types runs ended in 10 s or less and waited 19,953 s, and the rest ran up to 190 s)
types_cached() {
  local a vars=()
  for a in "$@"; do case "$a" in env) continue ;; *=*) vars+=("$a") ;; *) break ;; esac; done
  turbo_cached check-types "$(box_dir "$@")" ${vars[@]+"${vars[@]}"}
}
# whether turbo's dry run of task $1, in folder $2 with the VAR=x words after them, finds every task it runs cached
turbo_cached() {
  (cd "$2" 2>/dev/null && python3 -I - "$1" "${@:3}" 2>/dev/null <<'PY'
import json, os, signal, subprocess, sys
env = dict(os.environ, **dict(v.split("=", 1) for v in sys.argv[2:]))
p = subprocess.Popen(["bun", "run", "turbo", "run", sys.argv[1], "--dry=json"], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
try:
    out, _ = p.communicate(timeout=10)
except subprocess.TimeoutExpired:
    os.killpg(p.pid, signal.SIGKILL)
    p.wait()
    sys.exit(1)
tasks = [t for t in json.loads(out)["tasks"] if t.get("command") != "<NONEXISTENT>"]
sys.exit(0 if p.returncode == 0 and tasks and all(t["cache"]["status"] == "HIT" for t in tasks) else 1)
PY
  )
}
# what a chain's git add step stages, for the chain's later commit step: the whole tree, untracked files included, for :/, -A, --all, -u or a
# pathspec file, else the paths it names, . among them, each read from the step's own folder (4 Nov: read against the index alone, a chain whose own add staged a next file took the commit lane)
CHAIN_ADD_ALL="" CHAIN_ADD=()
chain_add() {
  local a past=""
  for a in "$@"; do
    [ -n "$past" ] || { [ "$a" = add ] && past=1; continue; }
    case "$a" in
      --) ;;
      :/ | -A | --all | -u | --update | --pathspec-from-file* | -[!-]*[Au]*) CHAIN_ADD_ALL=1 ;;
      -*) ;;
      *) CHAIN_ADD+=("$a") ;;
    esac
  done
}
# a commit whose pre-commit build runs next build, a git commit (but -n), in a repo whose lefthook.yml pre-commit runs a build, staging a file @web/next#build builds from (unless every file is Markdown or a Python test under tests/, which lefthook's build skips), with -a or a pathspec file any it may stage, or one under a path it names, or commit-slot.ts's build (commit-<worktree>) for one, goes through the queue as a big run (3 Nov, 04:05Z and 06:41Z: one built at 1.7 cores beside its own session's big run, and one beside a clone with load1 at 56)
heavy_build() {
  local a c f files top dir="" commit="" all="" nv="" odd="" state=lead paths=() vars=() line words first="" adir=""
  # a chain that commits counts as a build unless chain_safe takes every step; then it builds when one of its commit steps would, read with the
  # files the chain's git add steps before it stage, and counts as a build when an add runs in another folder than a commit, whose paths it would
  # misread (the first word is found outside a $( ), since bash 3.2 misparses a case inside one)
  for a in "$@"; do case "$a" in env|*=*) continue ;; esac; first=$a; break; done
  case "$(basename -- "$first")" in
    sh|bash|zsh)
      while IFS= read -r line; do
        IFS=$'\x1f' read -ra words <<< "$line"
        [ ${#words[@]} -gt 0 ] && [ "$(git_verb "${words[@]}")" = commit ] && commit=1
      done < <(chain_steps "$@")
      if [ -n "$commit" ]; then
        chain_safe "$@" || return 0
        CHAIN_ADD_ALL="" CHAIN_ADD=()
        while IFS= read -r line; do
          IFS=$'\x1f' read -ra words <<< "$line"
          [ ${#words[@]} -gt 0 ] || continue
          case "${words[3]}" in
            add) adir=${adir:-${words[2]}}; [ "$adir" = "${words[2]}" ] && chain_add "${words[@]}" || { CHAIN_ADD_ALL="" CHAIN_ADD=(); return 0; } ;;
            commit) { [ -z "$adir" ] || [ "$adir" = "${words[2]}" ]; } && ! heavy_build "${words[@]}" || { CHAIN_ADD_ALL="" CHAIN_ADD=(); return 0; } ;;
          esac
        done <<< "$CHAIN_SAFE"
        CHAIN_ADD_ALL="" CHAIN_ADD=()
        return 1
      fi ;;
  esac
  # commit-slot.ts's build step (`bun run build`) alone, never its type checks, which build nothing
  case "$WHO" in commit-*) for a in "$@"; do [ "$a" = build ] && commit=1; done ;; esac
  for a in "$@"; do
    case "$state" in
      lead) case "$a" in env) continue ;; NODE_ENV=* | RUN_SLOT_HERE=*) vars+=("$a"); continue ;; *=*) odd=1; continue ;; esac; [ "$(basename -- "$a")" = git ] || break; state=git ;;
      git) case "$a" in -C) state=dir ;; -c) odd=1; state=gitvalue ;; -*) odd=1 ;; commit) commit=1; state=commit ;; *) [ -n "$odd" ] || break ;; esac ;;
      gitvalue) state=git ;;
      dir) case "$a" in /*) dir=$a ;; *) dir=${dir:+$dir/}$a ;; esac; state=git ;;
      value) state=commit ;;
      paths) paths+=("$a") ;;
      commit) case "$a" in
          --) state=paths ;;
          -n|--no-verify) nv=1 ;;
          --all | --pathspec-from-file=*) all=1 ;;
          --pathspec-from-file) all=1; state=value ;;
          --author|--cleanup|--date|--file|--fixup|--message|--reedit-message|--reuse-message|--squash|--template|--trailer) state=value ;;
          --allow-empty | --allow-empty-message | --amend | --gpg-sign | --gpg-sign=* | --include | --no-edit | --no-gpg-sign | --no-signoff \
            | --only | --pathspec-file-nul | --quiet | --reset-author | --signoff | --untracked-files | --untracked-files=* | --verbose | --author=* \
            | --cleanup=* | --date=* | --file=* | --fixup=* | --message=* | --reedit-message=* | --reuse-message=* | --squash=* | --template=* | --trailer=*) ;;
          --*) odd=1 ;;
          -?*) f=${a#-}
            while [ -n "$f" ]; do c=${f:0:1}; f=${f:1}
              case "$c" in a) all=1 ;; n) nv=1 ;; [CFcmt]) [ -z "$f" ] && state=value; break ;; [uS]) break ;; [ioqsv]) ;; *) odd=1 ;; esac
            done ;;
          *) paths+=("$a") ;;
        esac ;;
    esac
  done
  [ -n "$commit" ] || { [ "$state" = git ] && [ -n "$odd" ]; } || return 1
  # fail closed (builder, 5 Nov): a flag outside the lists above, git's own or the commit's, counts as a build
  [ -z "$odd" ] || return 0
  [ -z "$nv" ] || return 1
  # only a repo whose own lefthook.yml pre-commit runs a build builds on commit (the dispatcher, 4 Nov: another repo's lint-staged commit sat 65 min in the big-run queue for a 1 s job)
  top=$(git ${dir:+-C "$dir"} rev-parse --show-toplevel 2>/dev/null)
  awk '/^[^ #]/ { pre = ($0 ~ /^pre-commit:/) } pre && /^ +(- )?run:.* run build([ "'"'"']|$)/ { found = 1 } END { exit !found }' \
    "$top/lefthook.yml" 2>/dev/null || return 1
  files=$({ git ${dir:+-C "$dir"} diff --cached --name-only; [ -z "$all" ] || git ${dir:+-C "$dir"} diff --name-only
    [ ${#paths[@]} -eq 0 ] || git ${dir:+-C "$dir"} diff --name-only HEAD -- "${paths[@]}"
    [ -z "$CHAIN_ADD_ALL" ] || { git ${dir:+-C "$dir"} diff --name-only; git ${dir:+-C "$dir"} ls-files --others --exclude-standard --full-name :/; }
    [ ${#CHAIN_ADD[@]} -eq 0 ] || { git ${dir:+-C "$dir"} diff --name-only -- "${CHAIN_ADD[@]}"; git ${dir:+-C "$dir"} ls-files --others --exclude-standard --full-name -- "${CHAIN_ADD[@]}"; }; } 2>/dev/null)
  grep -Evq '^$|\.md$|^tests/.*\.py$' <<<"$files" || return 1
  grep -Eq '^(web/next|api/hono|packages)/|^(bun\.lock|package\.json|turbo\.json)$' <<<"$files" || return 1
  # a build turbo replays whole from its cache runs in seconds, so only one with a task to run counts big (5 Nov: under run-slot, commit-slot.ts
  # runs the build bare inside the commit's own slot, so a big one stays in the queue); the cache folder is lefthook.yml's pre-commit default
  ! turbo_cached build "$top" "TURBO_CACHE_DIR=${TURBO_CACHE_DIR:-$HOME/.cache/turbo/playground}" ${vars[@]+"${vars[@]}"}
}
# packages/scripts/src/docker-build.ts, the docker build reader run-slot shares with the hooks
docker_reader() { "$BUN" "$(checkout_root)/packages/scripts/src/docker-build.ts" "$@" </dev/null; }
# A docker build, as docker_reader reads it past the hooks' wrappers: run (one image), each (a compose build of no service or several, built one at a time), refuse <why>, or nothing; a chain with a docker build in any step is refused, so each build is a run of its own
docker_kind() {
  local found line words
  # the reader starts only for a command that names docker or portless, so every other run skips its bun start
  case " $* " in *docker*|*portless*) ;; *) return ;; esac
  found=$(docker_reader kind -- "$@")
  [ "$found" != none ] && { echo "$found"; return; }
  while IFS= read -r line; do
    IFS=$'\x1f' read -ra words <<< "$line"
    [ ${#words[@]} -gt 0 ] || continue
    case "$(docker_reader kind -- "${words[@]}")" in
      none) ;;
      *) echo "refuse run-slot.sh refuses a chain that builds a docker image (${words[*]}): run each docker build as a run-slot run of its own, so run-slot holds it to one at a time"; return ;;
    esac
  done < <(chain_steps "$@" | grep -E "docker|portless")
}
# a light run, whatever its session's size: a quick kind, a bun install or add, a filtered turbo run, a plain tsc, or a check-types whose work is cached (retro 3, 31 Oct: a big session's 2s git push and 1s bun install each waited over 1,290s for the age bump)
light_run() {
  [ -n "$(quick_kind "$@")" ] && return
  local a first="" next="" turbo="" filter="" types=""
  for a in "$@"; do case "$a" in env|*=*) continue ;; esac; [ -z "$first" ] && first=$a && continue; next=$a; break; done
  # the 4 bare bunx tsc runs in the runs log each ran 1 s or less, while an sh -c holding a build and then tsc ran up to 152 s, so only the bare program counts (retro 5, 31 Oct)
  [ "$(basename -- "$first")" = tsc ] && return
  case "$(basename -- "$first")" in bun|bunx) ;; *) return 1 ;; esac
  [ "$(basename -- "$first")" = bunx ] && [ "$next" = tsc ] && return
  for a in "$@"; do case "$a" in install|add) return 0 ;; turbo) turbo=1 ;; --filter|--filter=*|-F) filter=1 ;; check-types) types=1 ;; esac; done
  [ -n "$turbo" ] && [ -n "$filter" ] && return
  [ -n "$types" ] && types_cached "$@"
}
# one line when a Mac run asks, takes its slot and ends, so a run's wait sits beside its run time (optimizer, 19 Oct)
rlog() { echo "$(date -u +%FT%TZ) $1 $WHO $$ $2" >> "$OPS/run-slot.runs.log" 2>/dev/null; }
[ -n "$CAN_TAKE" ] || [ -n "$REREAD" ] || rlog ask "$*"
# a named run from a worktree under .claude/worktrees/ records its session as that worktree's owner, named as commit-slot.ts names the folder
case "$WHO:$PWD" in
  commit-*) ;;
  */.claude/worktrees/*)
    if [ -z "$CAN_TAKE" ] && [ -z "$REREAD" ]; then
      OWNED=${PWD#*/.claude/worktrees/}
      OWNED=$(printf '%s' "${OWNED%%/*}" | tr -c 'A-Za-z0-9._#-' '-')
      mkdir -p "$OPS/run-slot.owner" && printf '%s\n' "$WHO" > "$OPS/run-slot.owner/$OWNED"
    fi ;;
esac
# a chain that commits beside a heavier step says the lane it takes and why, on stderr and as a `why` line after its ask (the ask line stays the command alone, which ran_last3 matches)
if [ -z "$CAN_TAKE" ] && [ -z "$REREAD" ]; then
  WHY=$(chain_lane "$@")
  case "$WHY" in
    "general "*)
      echo "run-slot.sh: this chain goes through the general queue, not the commit lane, since \`${WHY#general }\` is not a form the commit lane takes (git add, commit or push in run-slot's folder, or after a cd or as git -C to an absolute folder in the repo, and bun run precommit:light); run the commit as one of those to take the commit lane" >&2
      rlog why "general: \`${WHY#general }\` is outside the commit lane's forms" ;;
  esac
fi
read -r SIZE UNITS <<EOF
$(size_of "$WHO")
EOF
case "$UNITS" in 1|2|3) ;; *) SIZE=medium UNITS=2 ;; esac
# a ticket's units come from the run, so a light run from a big session ranks as small; a suite or a full build keeps its session's size
HEAVY=
heavy_build "$@" && HEAVY=1
light_run "$@" && SIZE=small UNITS=1
DOCKER=$(docker_kind "$@")
case "$DOCKER" in refuse\ *) echo "${DOCKER#refuse }" >&2; rlog refused "docker"; exit 2 ;; ?*) HEAVY=1 ;; esac
# a model-bound run skips the queue's lanes, run-slot-docker among them, and a build fills the VM rather than waiting on a model
[ -n "$DOCKER" ] && [ -n "$MODEL_BOUND" ] && { echo "run-slot.sh refuses --model-bound for a docker build, which fills the Docker VM rather than waiting on a model: run it without --model-bound, so it takes run-slot-docker, one docker build at a time" >&2; rlog refused "docker"; exit 2; }
[ -n "$HEAVY" ] && SIZE=big UNITS=3
# Merging keeps going: a run that gates a merge (Checks, local CI, the merge train, the dashboard's build) goes before the
# rest and may use the small reserve, as may an org's run (below) and the run-slot.priority pick. A checker's run is ranked by its worker's size (size_of), and
# the rest keep class 2 so an older copy's ticket still ranks.
case "$WHO" in ops-checks-*|ops-localci|ops-merge-train|ops-dashboard) CLASS=0 ;; *) CLASS=2 ;; esac
# the session a run counts as for the priority pick and its class: a commit-<worktree> pre-commit step counts as the last named session that ran run-slot from
# that worktree (run-slot.owner/<worktree>), since the hook's waiter carries no session's name (4 Nov: a commit's build waited from 20:45Z
# while the priority named its session, until a lead named its commit-<worktree> by hand)
owner_of() { case "$1" in commit-*) cat "$OPS/run-slot.owner/${1#commit-}" 2>/dev/null ;; *) echo "$1" ;; esac; }
# A company's runs go ahead of every other waiter (the owner's priority): class 1, for a session whose roster
# entry, or its worker's (a checker's), has a pr or repo under a GitHub org ext.links guards. Else a session whose entry, or its worker's, has an
# owner (the owner's own ask, which its lead set) marks its ticket ask, which ordered_waiters ranks after the merge gates; a commit-<worktree>
# pre-commit step reads as its worktree's session (owner_of)
ASK=""
[ "$CLASS" = 2 ] && { python3 -I - "$(owner_of "$WHO")" "$SELF" <<'PY'
import json, os, re, shutil, subprocess, sys

data = os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground"))
try:
    with open(os.path.join(data, "roster.json")) as f:
        by = {a["name"]: a for a in json.load(f)["agents"] if isinstance(a, dict) and isinstance(a.get("name"), str)}
except (OSError, ValueError, KeyError, TypeError):
    sys.exit(1)
entry = by.get(sys.argv[1]) or {}
chain = [entry, by.get(str(entry.get("worker"))) or {}]
# exit 0 for an org's run, 3 for the owner's ask, 1 for neither
other = 3 if any(str(e.get("owner") or "").strip() for e in chain) else 1
values = [str(e.get(k, "")).lower() for e in chain for k in ("pr", "repo") if e.get(k)]
if not values:
    sys.exit(other)
# the guarded orgs as the settings reader in this script's checkout prints them, read only for a session with a pr or repo
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(sys.argv[2]))))
bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
try:
    r = subprocess.run([bun, os.path.join(root, "packages", "scripts", "src", "playground", "setting.ts"), "--guarded-orgs"], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    orgs = json.loads(r.stdout) if r.returncode == 0 else []
except (OSError, ValueError, TypeError, subprocess.SubprocessError):
    sys.exit(other)
sys.exit(0 if any(re.search(rf"(?:^|/){re.escape(o)}/", v) for o in orgs for v in values) else other)
PY
  case $? in 0) CLASS=1 ;; 3) ASK=ask ;; esac; }
# Caps pytest-xdist's `-n auto` at 4 workers (a 15-worker round pushed load5 to 26).
export PYTEST_XDIST_AUTO_NUM_WORKERS=4
SLOT=""
DOCKER_SLOT=""
CHILD=""
# seconds between a waiter's looks, and a held clone's (the tests shorten both)
POLL=${RUN_SLOT_POLL:-15}
CLONE_POLL=${RUN_SLOT_POLL:-5}

# Waiters take slots oldest first (builder, 12 Oct: a request queued at 13:28Z lost three slots in a row to later ones): each waiter leaves a
# ticket, run-slot.waiters/<ns>-<pid>-<who>, and only the oldest ticket whose pid is alive may take a slot; a ticket goes once its slot is taken
# or its waiter ends. The dashboard's own build and the merge train take run-slot-2 outside the queue, as in single-slot mode.
QUEUE="$OPS/run-slot.waiters"
TICKET=""
ticket() {
  [ "$WHO" != ops-dashboard ] && [ "$WHO" != ops-merge-train ] && [ -z "$CAN_TAKE" ] && [ -z "$MODEL_BOUND" ] || return 0
  mkdir -p "$QUEUE"
  TICKET="$QUEUE/$(python3 -I -c 'import time; print(time.time_ns())')-$$-$WHO"
  # "s2" marks a waiter that can take run-slot-2 in single-slot mode (#i162); an empty ticket is an older copy that takes run-slot only.
  # Then its rank (class and units, 01 to 23), units and size, which order the queue, and ask for the owner's own ask, which an older copy ignores
  echo "s2 $CLASS$UNITS $UNITS $SIZE${ASK:+ $ASK}" > "$TICKET"
}
ticket
# A pinned ticket keeps its place by age: one with no rank, from an older copy or local CI (plain "s2", or empty), which no newer ticket
# passes, since those take a slot only while theirs is the oldest live ticket and any other order deadlocks them (a review's round 1), and
# one that has waited AGED seconds, 20 minutes, which no newer ticket of its class passes, so the slots drain and a run too big for the free
# units still starts; a class above it (ordered_waiters) passes it, as a merge's gates and a reviewer's pass an aged worker's
AGED=1200
# the ready line, "<pr> <place>" a line: merge-queue.json's entries (PLAYGROUND_MERGE_QUEUE moves it, as for the train) with a readyAt, by goAt (one with none after) and then readyAt
# (Checks on a ready PR goes first by itself, as run-slot.priority does by hand, after an org's runs); a file that does not read ranks nothing
ready_line() {
  python3 -I - "${PLAYGROUND_MERGE_QUEUE:-${PLAYGROUND_DATA_DIR:-$HOME/.playground}/merge-queue.json}" 2>/dev/null <<'READY'
import json, sys
try:
    queue = json.load(open(sys.argv[1]))["queue"]
    ready = [e for e in queue if isinstance(e, dict) and isinstance(e.get("pr"), int) and isinstance(e.get("readyAt"), str)]
except (OSError, ValueError, KeyError, TypeError):
    sys.exit(0)
ready.sort(key=lambda e: (not isinstance(e.get("goAt"), str), str(e.get("goAt", "")), e["readyAt"]))
for place, e in enumerate(ready):
    print(e["pr"], place)
READY
}
# the best place in the ready line ($2) of the PRs a Checks run names (ops-checks-<n>, or -<n>-<m> for a batch), else nothing
ready_place() {
  local n p best=""
  case "$1" in ops-checks-*) ;; *) return ;; esac
  for n in $(printf '%s' "${1#*-checks-}" | tr -c '0-9' ' '); do
    p=$(printf '%s\n' "$2" | awk -v n="$n" '$1 == n { print $2 }')
    [ -n "$p" ] && { [ -z "$best" ] || [ "$p" -lt "$best" ]; } && best=$p
  done
  echo "$best"
}
ordered_waiters() {
  # the live tickets in the order they take slots, one "<pinned 0|1> <ticket>" a line. A ticket with no rank (local CI's, an older copy's) is a wall
  # no newer ticket passes. Between walls go first the runs that go ahead, past AGED or not, class by class: an org's, then Checks for a PR in the
  # ready line by its place there, then those that gate a merge, then one for the owner's own ask (a ticket marked ask), then a reviewer's
  # (<id>-reviewer, -reviewer-spec), so a drafted review is never held behind workers' long runs (Ops, 2 Nov: 9 of 17 waiters were reviewers). Then
  # the rest. Within each class one past AGED is pinned, so no newer ticket of its class passes it; each small before medium before big, oldest first.
  # A dead waiter's goes on the way
  local t pid rank ask m p aged k sub seg=0 now ready
  local -a subs=(1 1 1 1 1 1)
  now=$(date +%s)
  ready=$(ready_line)
  for t in $(ls "$QUEUE" 2>/dev/null | sort -t- -k1,1n); do
    pid=$(printf '%s' "$t" | cut -d- -f2)
    if ! alive "$pid"; then rm -f "${QUEUE:?}/${t:?}"; continue; fi
    m=$(mtime "$QUEUE/$t") || continue
    rank="" ask=""
    read -r _ rank _ _ ask _ 2>/dev/null < "$QUEUE/$t"
    case "$rank" in
      [0-2][1-3]) ;;
      *) echo "$((seg + 1)) 0 0 00 1 $t"; seg=$((seg + 2)); subs=(1 1 1 1 1 1); continue ;;
    esac
    aged=0
    [ $((now - m)) -lt "$AGED" ] || aged=1
    case "$rank" in
      1?) rank=0$rank ;;
      2?) case "${t#*-*-}" in *-reviewer|*-reviewer-spec) rank=21${rank#2} ;; *) rank=2$rank ;; esac ;;
      *) p=$(ready_place "${t#*-*-}" "$ready"); if [ -n "$p" ]; then rank=1$(printf '%04d' "$p"); else rank=2$rank; fi ;;
    esac
    # the class: 0 an org's, 1 the ready line, 2 the merge gates, 3 the owner's ask, 4 a reviewer's, 5 the rest
    case "$rank" in 0*) k=0 ;; 1*) k=1 ;; 20?) k=2 ;; 21?) k=4 ;; *) k=5 ;; esac
    # an ask ticket ranks as 23<units>, so a checker's and a worker's sort by units alone within the class
    [ "$k" -lt 4 ] || [ "$ask" != ask ] || { k=3; rank=23${rank: -1}; }
    sub=${subs[$k]}
    if [ "$aged" = 0 ]; then echo "$seg $k $sub $rank 0 $t"; else echo "$seg $k $((sub + 1)) 00 1 $t"; subs[$k]=$((sub + 2)); fi
  done | sort -s -k1,1n -k2,2n -k3,3n -k4,4 | cut -d' ' -f5,6
}
first_waiter() {
  # the first waiter in that order whose run fits the units free now, so a run too big for them never holds back a smaller one behind it,
  # or the first pinned one, fitting or not; with s2, only among the waiters that can take run-slot-2 (builder, 12 Oct: older copies at
  # the head left slot 2 idle)
  local p t f c r m held list mode=${1:-}
  c=$(capacity); r=$(reserve "$c"); held=$(held_units)
  list=$(ordered_waiters)
  while read -r p t; do
    [ -n "$t" ] || continue
    f=$(cat "$QUEUE/$t" 2>/dev/null)
    [ "$mode" = s2 ] && [ -z "$f" ] && continue
    set -- $f
    m=$(may_reserve "${2:-22}" "${4:-medium}" "${t#*-*-}" "$r")
    if [ "$p" = 1 ] || fits "$(held_for "$m" "$held")" "${3:-2}" $((c - m)); then echo "$t"; return; fi
  done <<< "$list"
}
# a waiter whose script was replaced while it waits (a pull, a link-skills run) runs the new copy with its own arguments, since bash keeps
# reading the old file (dispatcher, 18 Oct: waiters started before a run-slot change kept the old clone-allow and queue rules)
reread() {
  [ "$(stamp "$SELF")" = "$STAMP" ] && return
  [ -r "$SELF" ] || return
  echo "run-slot.sh: $SELF changed while $WHO waited; running the new copy" >&2
  [ -n "$TICKET" ] && rm -f "$TICKET"
  RUN_SLOT_ASKED=$ASKED exec bash "$SELF" "${ARGS[@]}"
}

# run-slot.priority (a lead's pick, under an hour old) works with the queue (builder, 12 Oct: a priority naming the 8th waiter deadlocked it):
# the named session may take a slot whatever its place, and the reservation holds only while that session is itself waiting in the queue
prio_holder() {
  local m
  # while run-slot.focus stands its session is the pick, whatever run-slot.priority says or its age, so focus never loses its slot to a lapse
  focus_holder && return
  m=$(mtime "$OPS/run-slot.priority") || return
  # an mtime that reads back empty counts as no pick, rather than as a shell error, as in stale
  case "$m" in '' | *[!0-9]*) return 1 ;; esac
  [ $(( $(date +%s) - m )) -lt 3600 ] && cut -d' ' -f1 "$OPS/run-slot.priority"
}
# the session run-slot.focus names while it stands (playground focus); nothing, exit 1, when it does not
focus_holder() {
  switch_on run-slot.focus || return 1
  cut -d' ' -f1 "$OPS/run-slot.focus"
}
# true while focus holds this run: a heavy lane waits for every session but the focus one and ops' upkeep (ops-tick's beats, the dashboard), which keep running (dispatcher, 5 Nov)
focus_holds() {
  local h
  h=$(focus_holder) || return 1
  ! focus_spares "$h" "$WHO"
}
focus_wait() {
  [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for $(focus_holder)'s focus to end (run-slot.focus, until $(cut -d' ' -f3 "$OPS/run-slot.focus" 2>/dev/null))" >&2
  sleep "$POLL"
  waited=$((waited + 15))
}
prio_for() { local h; h=$(prio_holder) && [ -n "$h" ] && [ "$(owner_of "$1")" = "$h" ]; }
# the oldest live ticket the priority holder owns, its worktree's commit steps' included: the one of its tickets that skips the queue, so its
# runs go in the order it asked for them (4 Nov: a merge asked later took a slot before the same session's older merge)
prio_first() {
  local h t pid
  h=$(prio_holder) || return
  [ -n "$h" ] || return
  for t in $(ls "$QUEUE" 2>/dev/null | sort -t- -k1,1n); do
    [ "$(owner_of "${t#*-*-}")" = "$h" ] || continue
    pid=$(printf '%s' "$t" | cut -d- -f2)
    alive "$pid" && { echo "$t"; return; }
  done
}
# true while the priority holder has a ticket whose waiter still runs
prio_waiting() { [ -n "$(prio_first)" ]; }

free() {
  # give the slot back only while its holder line is still ours
  if [ -n "$SLOT" ] && [ "$(cut -d' ' -f2 "$SLOT.holder" 2>/dev/null)" = "$$" ]; then
    # the holder line goes first, so a waiter whose mkdir loses to the next taker never reads our dead pid and reclaims that taker's slot (reviewer-ops-load-units, 19 Oct)
    rm -f "$SLOT.holder" "$SLOT.child" "$SLOT.preempted"
    rmdir "$SLOT" 2>/dev/null
  fi
  SLOT=""
  if [ -n "$DOCKER_SLOT" ] && [ "$(cut -d' ' -f2 "$DOCKER_SLOT.holder" 2>/dev/null)" = "$$" ]; then
    # however the build ended, a TERM included, its builder stops before the next build may start, so its idle memory goes back to the VM
    env -u BUILDX_BUILDER docker buildx stop "$DOCKER_BUILDER" >/dev/null 2>&1
    rm -f "$DOCKER_SLOT.holder"
    rmdir "$DOCKER_SLOT" 2>/dev/null
  fi
  DOCKER_SLOT=""
  [ -n "$TICKET" ] && rm -f "$TICKET"
  [ -n "${MEM_TOLD:-}" ] && rm -f "$MEM_TOLD-suite" "$MEM_TOLD-clone" "$MEM_TOLD-idle" "$MEM_TOLD-swap" "$MEM_TOLD-busy"
}
trap 'free' EXIT
trap '[ -n "$CHILD" ] && kill -TERM -- "-$CHILD" 2>/dev/null; wait "$CHILD" 2>/dev/null; [ -n "$CHILD" ] && { reap "$CHILD"; rlog end "rc=143 ran=$(($(date +%s) - TOOK))s"; }; exit 143' TERM INT HUP

# process group $1's members, a `<pid> <command>` line each: from ps, else from the kernel's process table (ptable.py), since Claude Code's sandbox refuses the setuid ps
members() {
  local all
  if all=$(ps -A -o pid=,pgid=,command= 2>/dev/null); then
    printf '%s\n' "$all" | awk -v g="$1" '$2 == g { $2 = ""; print }'
  else
    python3 -I "$(dirname "$(realpath "$SELF")")/ptable.py" group "$1"
  fi
}
# stops what is left in the command's group once it has ended, TERM then KILL after 3 seconds, logging each pid (a suite's worker once outlived it by 5 hours)
reap() {
  local left
  left=$(members "$1")
  [ -n "$left" ] || return 0
  printf '%s\n' "$left" | while read -r pid cmd; do rlog reap "pid=$pid $cmd"; done
  kill -TERM -- "-$1" 2>/dev/null
  gone "$1" && return 0
  kill -KILL -- "-$1" 2>/dev/null
  gone "$1"
}

# whether a process group has emptied within 3 seconds, since a signalled process lingers until the kernel has torn it down
gone() {
  local i
  for i in $(seq 15); do
    [ -n "$(members "$1")" ] || return 0
    sleep 0.2
  done
  return 1
}

# a clone runs through this: the clone itself, then, once it exits 0 from one checkout's root node_modules into another, each workspace's own the same way, so no bun install has to follow (PG-655: 74 of 80 clones in a day were followed by one, 177 min queued)
CLONE_WORKSPACES='
import glob, json, os, subprocess, sys
code = subprocess.call(sys.argv[1:])
if code:
    sys.exit(code)
words = sys.argv[1:]
words = words[next((i for i, w in enumerate(words) if os.path.basename(w) == "cp"), len(words)):]
flags = [w for w in words[1:] if w.startswith("-")]
paths = [w.rstrip("/") for w in words[1:] if not w.startswith("-")]
if not words or len(paths) != 2 or os.path.basename(paths[0]) != "node_modules":
    sys.exit(0)
src = os.path.dirname(paths[0]) or "."
dst = os.path.dirname(paths[1]) if os.path.basename(paths[1]) == "node_modules" else paths[1]
try:
    workspaces = json.load(open(os.path.join(src, "package.json"))).get("workspaces", [])
    json.load(open(os.path.join(dst, "package.json")))
except (OSError, ValueError):
    sys.exit(0)
if isinstance(workspaces, dict):
    workspaces = workspaces.get("packages", [])
for pattern in workspaces:
    for ws in sorted(glob.glob(os.path.join(src, pattern, "node_modules"))):
        into = os.path.join(dst, os.path.relpath(os.path.dirname(ws), src))
        if os.path.isdir(into) and not os.path.lexists(os.path.join(into, "node_modules")):
            code = subprocess.call([words[0], *flags, ws, into + "/"])
            if code:
                sys.exit(code)'

# a clone's source checkout and destination, from cp <flags> <src>/node_modules <dst>[/node_modules] (the shape CLONE_WORKSPACES reads), each absolute and led by a tab, for the clone lane's holder line, so playground rm refuses a worktree a running clone reads from or copies into (PG-714); nothing for words of another shape
clone_ends() {
  local a seen="" paths=()
  for a in "$@"; do
    [ -n "$seen" ] || { [ "$(basename -- "$a")" = cp ] && seen=1; continue; }
    case "$a" in -*) ;; *) a=${a%/.}; paths+=("${a%/}") ;; esac
  done
  [ ${#paths[@]} -eq 2 ] && [ "$(basename -- "${paths[0]}")" = node_modules ] || return 0
  local dst=${paths[1]}
  [ "$(basename -- "$dst")" = node_modules ] && dst=$(dirname -- "$dst")
  printf '\t%s\t%s' "$(absolute "$(dirname -- "${paths[0]}")")" "$(absolute "$dst")"
}
absolute() { (cd -- "$1" 2>/dev/null && pwd -P) || case "$1" in /*) printf %s "$1" ;; *) printf %s "$PWD/$1" ;; esac; }

# A docker build runs in playground-capped, a docker-container BuildKit capped at half the Docker VM's memory, made when missing and never the default (no --use), loading its image into the engine's store
DOCKER_BUILDER=playground-capped
# half the VM, as the engine reports it, so the cap follows the VM's size (6 Nov 01:38Z: the VM went from 3 GiB to 8 GiB) and the other half stays for the engine, the kernel and the live dashboard's Postgres
docker_memory() {
  local total
  total=$(docker info --format '{{.MemTotal}}' 2>/dev/null)
  case "$total" in ''|*[!0-9]*) return 1 ;; esac
  echo "$((total / 2 / 1048576))m"
}
capped_builder() {
  local memory have
  memory=$(docker_memory) || return 1
  if have=$(docker buildx inspect "$DOCKER_BUILDER" 2>/dev/null); then
    case "$have" in *"memory=\"$memory\""*) return ;; esac
    # a builder made under another VM size keeps its old cap, so it is made again at this one's
    docker buildx rm "$DOCKER_BUILDER" >/dev/null 2>&1 || return 1
  fi
  docker buildx create --name "$DOCKER_BUILDER" --driver docker-container --driver-opt "memory=$memory" \
    --driver-opt "memory-swap=$memory" --driver-opt default-load=true >/dev/null
}

# runs the command as the leader of a process group of its own (macOS has no setsid(1)), which reap stops once it ends, and exits with its code; where Claude Code's sandbox refuses the new group or the nice, it says so on stderr and runs the command without it
run_command() {
  local code
  [ "${KIND:-}" = clone ] && set -- python3 -I -c "$CLONE_WORKSPACES" "$@"
  if [ -n "${DOCKER:-}" ]; then
    capped_builder || { echo "run-slot.sh: could not make the capped builder $DOCKER_BUILDER, so this docker build does not run uncapped" >&2; rlog end "rc=1 ran=0s"; exit 1; }
    export BUILDX_BUILDER=$DOCKER_BUILDER DOCKER_BUILDKIT=1
  fi
  [ "${DOCKER:-}" = each ] && set -- "$BUN" "$(checkout_root)/packages/scripts/src/docker-build.ts" each -- "$@"
  python3 -I -c '
import os, sys
for step, call in (("its own process group", os.setsid), ("nice " + os.environ.get("RUN_SLOT_NICE", "10"), lambda: os.nice(int(os.environ.get("RUN_SLOT_NICE", "10"))))):
    try:
        call()
    except OSError as error:
        print(f"run-slot.sh: runs the command without {step} ({error.strerror})", file=sys.stderr)
os.execvp(sys.argv[1], sys.argv[1:])' "$@" <&3 3<&- &
  CHILD=$!
  # the child's record, the one handle preempt signals
  [ -n "$SLOT" ] && echo "$CHILD" > "$SLOT.child"
  wait "$CHILD"
  code=$?
  [ -n "$SLOT" ] && [ "$(cat "$SLOT.preempted" 2>/dev/null)" = "$CHILD" ] && echo "run-slot.sh: focus preempted this run for $(focus_holder || echo a session that has since ended); ask again once its focus ends" >&2
  reap "$CHILD"
  CHILD=""
  rlog end "rc=$code ran=$(($(date +%s) - TOOK))s"
  exit "$code"
}

reclaim() {
  # $1 is a slot directory that mkdir found taken: free it when its holder line ($2 of stale) has gone stale; the line and the directory are
  # read again just before the rmdir, so a waiter that freed and took the slot meanwhile keeps it
  local line dir
  line=$(cat "$1.holder" 2>/dev/null); dir=$(stamp "$1")
  stale "$1" "$line" || return 0
  [ "$(cat "$1.holder" 2>/dev/null)" = "$line" ] && [ "$(stamp "$1")" = "$dir" ] && rmdir "$1" 2>/dev/null
}

# the 5-minute load run-slot-2 in single-slot mode starts under: 22, or run-slot.load5-cap's cap while it stands (builder, 12 Oct: 12 while the live dashboard's cmux reads time out), 22 at most
# its cap is the file's last line, the one a set writes below its reason or an old-shape file's only one
load_line() {
  local cap
  cap=$(switch_on run-slot.load5-cap && tail -n 1 "$OPS/run-slot.load5-cap" | grep -xE '[0-9]{1,3}'); [ -n "$cap" ] || cap=22; [ "$cap" -le 22 ] || cap=22
  echo "$cap"
}
# whether the load rules open slot $1 to this run now
slot_open() {
  local s=$1
  # run-slot.single (builder, 9 Oct: heavy suites one at a time) closes slots 2 and 3 to new holders while it exists
  # ...except for the dashboard's own build and the merge train (12 Oct: single-slot mode left both waiting an hour behind testers' runs), which shut lanes leave run-slot-2 open to as well (retro 22: two 5/5 PRs sat about 55 min while the train raced the queue for run-slot alone)
  # #i162: in single-slot mode run-slot-2 still opens for a second suite; since 13 Oct (dispatcher, so work runs while the
  # machine allows) it opens on memory: free share 40% or more (ops, 19 Oct 01:16Z, from the optimizer: 9 Mac-only waiters at
  # pressure 1 with 43% free), pressure normal and swap-ins under SWAPINS_MAX (mem_ok), and the 5-minute load under 22 as a backstop
  if [ "$s" != run-slot ] && switch_on run-slot.single && [ "$WHO" != ops-dashboard ] && [ "$WHO" != ops-merge-train ]; then
    if [ "$s" = run-slot-2 ] && [ "$(load5)" -lt "$(load_line)" ] && mem_ok; then :; else return 1; fi
  elif [ "$s" = run-slot-2 ] && [ "$WHO" != ops-dashboard ] && [ "$WHO" != ops-merge-train ] && ! lanes_now; then
    return 1
  fi
  # a third slot, approved by dispatcher (8 Oct), opens only while lanes_open does; a holder that took it finishes either way
  # run-slot.3-off closes it too (dispatcher, 18 Oct: the owner's machine loud at load1 29.6; two slots until load5 holds under 12 for 10 minutes)
  if [ "$s" = run-slot-3 ] && { switch_on run-slot.3-off || ! lanes_now; }; then
    return 1
  fi
  # a fourth slot, dispatcher's factory call (18 Oct, a two-way door: 14 waiters at 12:40Z, 5/5 PRs to merge within 30 minutes): it opens
  # only while lanes_open does and run-slot.4-off is absent; Ops creates run-slot.4-off when load5 holds over 25 for
  # 10 minutes or the owner's dictation shows a delay
  if [ "$s" = run-slot-4 ] && { switch_on run-slot.4-off || ! lanes_now; }; then
    return 1
  fi
  return 0
}
# whether the gauges open slots 2 to 4: mem_ok passing and the CPU 40% idle or more under load1 45 (5 Nov, 06:19 to 07:45Z: a 50% bar from load1 30
# to 45 left the CPU at a median 48% idle, and 14 of its 30 CPU shuts read 40 to 49% idle) (dispatcher, 3 Nov: the resting sessions held load1 at 14 to 20 on 15 cores while the CPU sat 53 to 67% idle, so the old load1 lines of 12
# and the cores left one lane open with 24 to 33 runs waiting; retro 36, 4 Nov: at a load1 30 stop the lanes were shut 109 of 120 minutes
# with the CPU about half idle, and heavy runs waited up to 122 minutes); load1 45 stays a hard stop for the spikes, load1 64 after a burst
# of starts and 73 after a clone; a run's verdict that differs from the last, run-slot.lanes, is a lanes line in run-slot.runs.log with the
# gauges, mem_ok's free share and pressure level and, when shut, why: the first of load1, cpu and mem that shut it (dispatcher, 5 Nov: retro 39
# counted 19 shuts by the CPU, 12 by memory and 6 by load1 from readings alone), while a read subcommand writes neither
lanes_open() {
  local idle swap tps mbs load need="" verdict=shut why="" seen free level
  read -r idle swap tps mbs _ <<< "$(gauges)"
  load=$(loadavg | awk '{print $2}')
  case "$idle" in
    -) told idle "run-slot.sh: cannot read the CPU's idle share (top -l 2 -n 0), so slots 2 to 4 stay shut" ;;
    busy) told busy "$BUSY_TOLD" ;;
  esac
  if [ "${load%.*}" -lt 45 ] 2>/dev/null; then need=40; fi
  if [ -z "$need" ]; then
    why=load1
  elif [ "$idle" = - ] || [ "$idle" = busy ] || ! [ "${idle%.*}" -ge "$need" ] 2>/dev/null; then
    why=cpu
  elif ! mem_ok; then
    why=mem
  else
    verdict=open
  fi
  seen=$(cat "$OPS/run-slot.lanes" 2>/dev/null)
  if [ -z "$CAN_TAKE" ] && [ "$seen" != "$verdict" ]; then
    echo "$verdict" > "$OPS/run-slot.lanes"
    free=$(memstat level); level=$(memstat vm_pressure_level)
    rlog lanes "$verdict${why:+ why=$why} idle=$idle% load1=$load free=${free:--}${free:+%} pressure=${level:--} swapins=$swap disk0_tps=${tps:--} disk0_mbs=${mbs:--}"
  fi
  [ "$verdict" = open ]
}

# A burst of starts outruns the reading the slots open on, since load1 shows a run's load about a minute after it starts (issue 610, 2 Nov:
# five medium suites and two clones started in 70 s at load1 16, and load1 reached 64): while run-slot.runs.log shows more runs started on
# run-slot to run-slot-4 or the clone slot in the last minute than ended there, so the held runs grew, a medium or big run waits for the
# reading to show them and the slots fill one a minute; a run that takes a slot a run freed adds nothing and goes on, as does a small run,
# and the dashboard's and the merge train's runs go on too, as they skip slot 2's lanes_open; prints how many runs the last
# minute added when it holds
burst_held() {
  local now cutoff
  [ "$SIZE" != small ] && [ "$WHO" != ops-dashboard ] && [ "$WHO" != ops-merge-train ] || return 1
  now=$(date +%s)
  cutoff=$(date -u -r $((now - 60)) +%FT%TZ 2>/dev/null || date -u -d "@$((now - 60))" +%FT%TZ 2>/dev/null) || return 1
  tail -n 3000 "$OPS/run-slot.runs.log" 2>/dev/null | CUTOFF=$cutoff awk '
    $2 == "start" && $5 ~ /^run-slot(-[234]|-clone)?$/ { run[$3 " " $4] = 1; if ($1 > ENVIRON["CUTOFF"]) n++ }
    $2 == "end" && run[$3 " " $4] { delete run[$3 " " $4]; if ($1 > ENVIRON["CUTOFF"]) n-- }
    END { if (n > 0) print n; exit !(n > 0) }'
}

# Load units: each held CPU slot's run counts the units on its holder line (2, a medium, for a line with none), and the slots the load rules open now, or a holder already has, give 2 units each. A quarter of them, at least 1, stays for small runs and the runs that gate a merge, so a big run never blocks a small one
held_units() {
  local s u total=0
  for s in run-slot run-slot-2 run-slot-3 run-slot-4; do
    reclaim "$OPS/$s"
    [ -d "$OPS/$s" ] || continue
    u=$(cut -d' ' -f4 "$OPS/$s.holder" 2>/dev/null)
    case "$u" in 1|2|3) ;; *) u=2 ;; esac
    total=$((total + u))
  done
  echo $((total + $(peer_units)))
}
# a held commit or clone lane's 2 units, which count only against a run that leaves the reserve, so a medium or big run waits beside a commit's build and a clone while a small run and one that gates a merge start beside them as before (3 Nov, 06:41Z: a next build ran on the commit lane beside a clone with no units held, and load1 reached 56)
lane_units() {
  local s total=0
  for s in run-slot-commit run-slot-clone; do
    reclaim "$OPS/$s"
    [ -d "$OPS/$s" ] && total=$((total + 2))
  done
  echo "$total"
}
# the units held against a run that must leave $1 free: the CPU slots' and peers' (held_units's $2 when given), plus the lanes' when $1 is over 0
held_for() {
  local h=${2:-$(held_units)}
  [ "$1" -gt 0 ] && h=$((h + $(lane_units)))
  echo "$h"
}
# each live holder of another factory's run slots (slots.peers) counts its units here, read only, since that folder is theirs (ops, 31 Oct: the two pools took load1 to 77)
peer_units() {
  local d s line u total=0
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    for s in run-slot run-slot-2 run-slot-3 run-slot-4; do
      [ -d "$d/$s" ] || continue
      line=$(cat "$d/$s.holder" 2>/dev/null)
      stale "$d/$s" "$line" && continue
      u=$(printf '%s' "$line" | cut -d' ' -f4)
      case "$u" in 1|2|3) ;; *) u=2 ;; esac
      total=$((total + u))
    done
  done <<< "$PEERS"
  echo "$total"
}
# lanes_open, once per capacity() count: its slot checks share the first one's verdict, since a reading per slot counted slot 2 shut on a stale reading and slots 3 and 4 open on one that landed between them; outside a count LANES is unset, so each check reads afresh and a waiter still reads the gauges on every poll
lanes_now() {
  case "${LANES-}" in
    open) return 0 ;;
    shut) return 1 ;;
    unread) if lanes_open; then LANES=open; else LANES=shut; return 1; fi ;;
    *) lanes_open ;;
  esac
}
capacity() {
  local s n=0 LANES=unread
  for s in run-slot run-slot-2 run-slot-3 run-slot-4; do
    { [ -d "$OPS/$s" ] || slot_open "$s"; } && n=$((n + 1))
  done
  echo $((2 * n))
}
# whether a run of $2 units fits beside $1 held within a limit of $3; any run fits while no slot is held, so a big run still starts on a quiet machine
fits() { [ "$1" -eq 0 ] || [ $(($1 + $2)) -le "$3" ]; }
reserve() { local r=$(($1 / 4)); [ "$r" -ge 1 ] && echo "$r" || echo 1; }
# the units a run must leave free: none for a small run, one that gates a merge (rank 0x), an org's run (1x) or the run-slot.priority pick, else the reserve
may_reserve() {
  case "$2" in small) echo 0; return ;; esac
  case "$1" in 0?|1?) echo 0; return ;; esac
  [ -n "$3" ] && prio_for "$3" && { echo 0; return; }
  echo "$4"
}

# the load averages as `{ <1m> <5m> <15m> }`: from sysctl, else from uptime, since Claude Code's sandbox refuses the sysctl command's name lookup
loadavg() { sysctl -n vm.loadavg 2>/dev/null || LC_ALL=C uptime 2>/dev/null | sed -nE 's/.*load averages?: *([^ ,]+),? +([^ ,]+),? +([^ ,]+).*/{ \1 \2 \3 }/p'; }
load1() { loadavg | awk '{print int($2)}'; }
load5() { loadavg | awk '{print int($3)}'; }
# the swap-ins over vm_stat -c 2 1's one second: its second row under the header, never the first, which counts since boot; nothing when either row is missing
swapin_rate() {
  vm_stat -c 2 1 2>/dev/null | awk '!c { for (i = 1; i <= NF; i++) if ($i == "swapins") c = i; next } { n++; v = $c } END { if (n == 2 && v ~ /^[0-9]+$/) print v }'
}
# disk0's `<transfers/s> <MB/s>` over iostat -d -c 2 -w 1 disk0's one second: its second row, never the first, which counts since boot; nothing when either row is missing
disk_rate() {
  iostat -d -c 2 -w 1 disk0 2>/dev/null | awk 'NF == 3 && $2 ~ /^[0-9]+$/ { n++; t = $2; m = $3 } END { if (n == 2) print t, m }'
}
# the swap-ins a second at which memory has no room for another heavy run: spawn.sh's line for a GLM start, the gates.glmSwapinsMax setting's default (packages/settings/src/gates.ts): change both together
SWAPINS_MAX=100
# what a look says once a run while another takes the first reading of the gauges
BUSY_TOLD="run-slot.sh: another look is reading the CPU's idle share and the swap-ins, so slots 2 to 4 stay shut until it lands"
# `<idle> <swapins> <disk0 transfers/s> <disk0 MB/s> <the last reading's swapins>`: the CPU's idle share in top's second sample (top -l 2 -n 0), the swap-ins a second in
# vm_stat -c 2 1's last row (as spawn.sh's swapins() reads them) and disk_rate's two figures, which lanes lines log and no verdict reads (a bound on disk load waits on a day of them), each - when unread; every look shares one reading through run-slot.gauges
# (`<epoch> <idle> <swapins> <tps> <MB/s> <last swapins>`) for 10 s, since a top takes a second and about 0.7 s of system CPU, and some 27 waiters each look every 15 s;
# one look refreshes it, under gauges_lock, while the rest keep the reading they have, or `busy busy` when there is none yet, since without the
# lock every look that found it stale ran its own top (3 Nov, 10:53Z: 16 to 23 tops at once from 26 waiters, and load1 56.8); the refresher
# removes the lock only while it still carries the mtime it took, so a refresher that ran past a takeover leaves the new holder's lock
gauges() {
  local now cached= idle= swap= tps= mbs= last= took lock="$OPS/run-slot.gauges.lock"
  now=$(date +%s)
  { read -r cached idle swap tps mbs last < "$OPS/run-slot.gauges"; } 2>/dev/null
  case "$cached" in ''|*[!0-9]*) cached=0 ;; esac
  if [ $((now - cached)) -ge 10 ]; then
    if took=$(gauges_lock "$now"); then
      idle=$(top -l 2 -n 0 2>/dev/null | sed -nE 's/^CPU usage:.* ([0-9.]+)% idle.*/\1/p' | awk 'END { if (NR == 2) print }')
      last=$swap
      swap=$(swapin_rate)
      read -r tps mbs <<< "$(disk_rate)"
      printf '%s %s %s %s %s %s\n' "$now" "${idle:--}" "${swap:--}" "${tps:--}" "${mbs:--}" "${last:--}" > "$OPS/run-slot.gauges.$$" 2>/dev/null && mv -f "$OPS/run-slot.gauges.$$" "$OPS/run-slot.gauges" 2>/dev/null
      [ "$(mtime "$lock")" = "$took" ] && rmdir "$lock" 2>/dev/null
    elif [ "$cached" -eq 0 ]; then
      idle=busy swap=busy
    fi
  fi
  echo "${idle:--} ${swap:--} ${tps:--} ${mbs:--} ${last:--}"
}
# takes the gauges' refresh lock at epoch $1, or one aged 30 s or more by its mtime, which a refresher killed mid-refresh left (a refresh
# takes about 2 s), and prints the mtime it took the lock at (scripts/ops/README.md says why two takeovers together are harmless)
gauges_lock() {
  local now=$1 lock="$OPS/run-slot.gauges.lock" born
  if ! mkdir "$lock" 2>/dev/null; then
    born=$(mtime "$lock") || return
    [ $((now - born)) -ge 30 ] && rmdir "$lock" 2>/dev/null && mkdir "$lock" 2>/dev/null || return
  fi
  mtime "$lock"
}
# macOS's memory reading $1: level (the free share) or vm_pressure_level (1 normal, 2 warn, 4 critical)
memstat() { sysctl -n "kern.memorystatus_$1" 2>/dev/null | tr -cd 0-9; }
# memory room for a second suite: macOS's free share at 40% or more, its pressure level normal (1; 2 is warn, 4 critical) and swap-ins under SWAPINS_MAX a
# second in this reading or the last, since a one-second sample spikes and falls back (5 Nov, 06:19 to 07:45Z: 17 of the 24 memory shuts came at pressure 1
# with 70 to 80% free, from readings such as 128, 242 and 1116 between 0, 8, 20 and 44); an unread reading (Claude Code's sandbox refuses the first two) leaves no room, said once a run on stderr
MEM_TOLD="${TMPDIR:-/tmp}/run-slot-mem-told.$$"
# says line $2 once a run on stderr, a file per kind ($1) marking it, since a look reads the gauges in a subshell
told() { [ -e "$MEM_TOLD-$1" ] || { echo "$2" >&2; : > "$MEM_TOLD-$1"; }; }
mem_unread() { told "$1" "run-slot.sh: cannot read the memory (sysctl kern.memorystatus_*), so $2"; }
mem_ok() {
  local free level swap last
  free=$(memstat level); level=$(memstat vm_pressure_level)
  if [ -z "$free" ] || [ -z "$level" ]; then
    mem_unread suite "no second suite runs beside this one"
    return 1
  fi
  read -r _ swap _ _ last <<< "$(gauges)"
  case "$swap" in
    -) told swap "run-slot.sh: cannot read the swap-ins (vm_stat -c 2 1), so no second suite runs beside this one"; return 1 ;;
    busy) told busy "$BUSY_TOLD"; return 1 ;;
  esac
  [ "$free" -ge 40 ] && [ "$level" -eq 1 ] && { [ "$swap" -lt "$SWAPINS_MAX" ] || ! [ "$last" -ge "$SWAPINS_MAX" ] 2>/dev/null; }
}

# Dictation misses come from input delay under load, so every command runs under nice 10, and the
# factory's CPU-heavy work yields to the owner's foreground apps; the live dashboard's own runs (ops-dashboard) keep normal priority
if [ "$WHO" = ops-dashboard ]; then export RUN_SLOT_NICE=0; else export RUN_SLOT_NICE="${RUN_SLOT_NICE:-10}"; fi
# the model-bound cap: slots.modelBound by setting(), and 2 when the reader cannot answer
model_cap() {
  local cap
  cap=$(setting slots.modelBound)
  case "$cap" in [1-9]|1[0-6]) echo "$cap" ;; *) echo 2 ;; esac
}
if [ -n "$MODEL_BOUND" ]; then
  CAP=$(model_cap)
  waited=0
  while :; do
    for n in $(seq 1 "$CAP"); do
      mkdir "$OPS/run-slot-model-$n" 2>/dev/null && { SLOT="$OPS/run-slot-model-$n"; break 2; }
      reclaim "$OPS/run-slot-model-$n"
    done
    reread
    [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for one of the $CAP model-bound slots" >&2
    sleep "$POLL"
    waited=$((waited + 15))
  done
  echo "$WHO $$ $(date -u +%FT%TZ) 0 model" > "$SLOT.holder"
  echo "run-slot.sh: $WHO holds $(basename "$SLOT")" >&2
  TOOK=$(date +%s); rlog start "$(basename "$SLOT") waited=$((TOOK - ASKED))s"
  run_command "$@"
fi
# One docker build at a time on the machine, since each fills the Docker VM the live dashboard's Postgres shares (6 Nov 00:38Z: a parallel compose build got it killed): run-slot-docker is taken before the ticket, so a waiting build holds no place in the queue, and reclaimed only once its holder's pid has gone
if [ -n "$DOCKER" ]; then
  [ -n "$TICKET" ] && rm -f "$TICKET" && TICKET=""
  waited=0
  until mkdir "$OPS/run-slot-docker" 2>/dev/null; do
    reclaim "$OPS/run-slot-docker"
    reread
    [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for run-slot-docker, one docker build at a time ($(cat "$OPS/run-slot-docker.holder" 2>/dev/null))" >&2
    sleep "$CLONE_POLL"
    waited=$((waited + CLONE_POLL))
  done
  DOCKER_SLOT="$OPS/run-slot-docker"
  echo "$WHO $$ $(date -u +%FT%TZ)" > "$DOCKER_SLOT.holder"
  ticket
fi
KIND=$(quick_kind "$@")
# the merge train's quick run starts at once, past the quick slot's race: only pr:merge's types gate runs as ops-merge-train, inside the merge lock, which keeps it to one run at a time (PG-796, 3 Nov: its 1 s metrics step waited 263 s for the slot, and its cached build ran past the gate's 600 s twice)
if [ "$KIND" = quick ] && [ "$WHO" = ops-merge-train ]; then
  [ -n "$TICKET" ] && rm -f "$TICKET" && TICKET=""
  TOOK=$(date +%s); rlog start "bare waited=$((TOOK - ASKED))s"
  run_command "$@"
fi
if [ -n "$KIND" ]; then
  [ -n "$TICKET" ] && rm -f "$TICKET" && TICKET=""
  waited=0
  # run-slot.clone-off holds every clone while it exists (dispatcher, 18 Oct, with run-slot.3-off)
  # run-slot.clone-allow holds, one a line, grep patterns for the clones a lead lets through while clone-off stands (builder, 18 Oct: priority clones in order; every checker by default, finish-first)
  # clone-off lets a clone through while load1 and load5 are under 30 and memory passes spawn.sh's gate, pressure level 1 or 2 with 8% or more free (dispatcher, 19 Oct 01:18Z;
  # builder, 19 Oct); spawn.sh keeps its 8 inside its own Python, so the number is written twice until one home holds it
  # load1 counts since load5 lags a fresh spike (optimizer, 19 Oct 03:42Z: a clone let through at load5 under 30 took load1 to 73)
  # an unread memory reading (Claude Code's sandbox refuses it) holds the clone, said once a run
  clone_held() {
    [ "$KIND" = clone ] && switch_on run-slot.clone-off && ! printf "%s\n" "$WHO" | grep -qxf "$OPS/run-slot.clone-allow" 2>/dev/null || return 1
    [ -n "$(memstat level)" ] || { mem_unread clone "run-slot.clone-off holds this clone until it expires or run-slot.clone-allow names $WHO"; return 0; }
    ! { case "$(memstat vm_pressure_level)" in 1|2) true ;; *) false ;; esac && [ "$(memstat level)" -ge 8 ] 2>/dev/null && [ "$(load5)" -lt 30 ] && [ "$(load1)" -lt 30 ]; }
  }
  while clone_held; do reread; sleep "$CLONE_POLL"; done
  # a commit's build, a merge or a clone is heavy, so it waits under focus; the quick slot's short runs go on
  while [ "$KIND" != quick ] && focus_holds; do reread; focus_wait; done
  # bash 5.2 can fail to parse the TERM trap while it expands a "$(...)" and then drop the loop it was in (measured on the runner host:
  # the waiter ran its command with no slot), so each wait checks it ended as it should, and the waiter stops when it did not
  clone_held && { echo "run-slot.sh: run-slot.clone-off holds this clone, so $WHO stops" >&2; exit 143; }
  # the quick slot takes no load wait: its load comes mostly from outside run-slot and one slot adds about a core at most, so a hold kept 44 quick runs waiting 201 min for 8 min of work (issue 547); ran_long sends a line that runs long to the queue
  GOT=
  while :; do
    mkdir "$OPS/run-slot-$KIND" 2>/dev/null && { GOT=1; break; }
    reclaim "$OPS/run-slot-$KIND"
    reread
    [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for the $KIND slot ($(cat "$OPS/run-slot-$KIND.holder" 2>/dev/null))" >&2
    sleep 5
    waited=$((waited + 5))
  done
  [ -n "$GOT" ] || exit 143
  SLOT="$OPS/run-slot-$KIND"
  ends=""
  [ "$KIND" = clone ] && ends=$(clone_ends "$@")
  echo "$WHO $$ $(date -u +%FT%TZ)$ends" > "$SLOT.holder"
  echo "run-slot.sh: $WHO holds run-slot-$KIND" >&2
  TOOK=$(date +%s); rlog start "run-slot-$KIND waited=$((TOOK - ASKED))s"
  run_command "$@"
fi

# slots.peers, one folder a line, read once here since held_units runs in a subshell; a reader that cannot answer counts no peer
PEERS=$(setting slots.peers 2>/dev/null | python3 -I -c 'import json, sys; [print(p) for p in json.load(sys.stdin) if isinstance(p, str)]' 2>/dev/null)
[ -n "$HEAD_ONLY" ] && { first_waiter; exit 0; }
[ -n "$SLOTS_ONLY" ] && { echo $(($(capacity) / 2)); exit 0; }
if [ -n "$ROOM_ONLY" ]; then
  held=0
  for s in run-slot run-slot-2 run-slot-3 run-slot-4; do
    reclaim "$OPS/$s"
    [ -d "$OPS/$s" ] && held=$((held + 1))
  done
  c=$(capacity)
  free=0
  r=$(reserve "$c")
  fits "$(held_for "$r")" 2 $((c - r)) && free=$((c / 2 - held))
  echo "$((c / 2)) $held $free $(ordered_waiters | grep -c .)"
  exit 0
fi

if [ -n "$CAN_TAKE" ]; then
  reclaim "$OPS/$CAN_TAKE"
  [ ! -d "$OPS/$CAN_TAKE" ] && slot_open "$CAN_TAKE" && ! burst_held > /dev/null || exit 1
  c=$(capacity); m=$(may_reserve "$CLASS$UNITS" "$SIZE" "$WHO" "$(reserve "$c")")
  fits "$(held_for "$m")" "$UNITS" $((c - m))
  exit
fi

waited=0
while :; do
  reread
  # HEAD: first in the queue (any slot); S2: first among waiters that can take run-slot-2, so an older copy at the head cannot idle it
  HEAD=1; S2=1
  if [ -n "$TICKET" ] && prio_for "$WHO"; then
    [ "$(prio_first)" = "$(basename "$TICKET")" ] || { HEAD=0; S2=0; }
  elif [ -n "$TICKET" ]; then
    [ "$(first_waiter)" = "$(basename "$TICKET")" ] || HEAD=0
    [ "$(first_waiter s2)" = "$(basename "$TICKET")" ] || S2=0
  fi
  if [ "$HEAD" = 0 ] && [ "$S2" = 0 ]; then
    if [ $((waited % 300)) -eq 0 ]; then
      pos=$(ordered_waiters | cut -d' ' -f2 | grep -nxF "$(basename "$TICKET")" | cut -d: -f1)
      echo "run-slot.sh: queued behind $(( ${pos:-1} - 1 )) waiter(s) ahead of it in the queue's order" >&2
    fi
    sleep "$POLL"
    waited=$((waited + 15))
    continue
  fi
  # under focus a run keeps its place in the queue and takes no slot
  if focus_holds; then
    focus_wait
    continue
  fi
  # this run's own units must fit beside what the slots hold now (the queue's order checked them for a waiter at its head)
  c=$(capacity); m=$(may_reserve "$CLASS$UNITS" "$SIZE" "$WHO" "$(reserve "$c")")
  if ! fits "$(held_for "$m")" "$UNITS" $((c - m)); then
    [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for $UNITS free load units ($SIZE; $(held_for "$m") of $c held)" >&2
    sleep "$POLL"
    waited=$((waited + 15))
    continue
  fi
  if added=$(burst_held); then
    [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for the load to show the $added run(s) the last minute added" >&2
    sleep "$POLL"
    waited=$((waited + 15))
    continue
  fi
  for s in run-slot run-slot-2 run-slot-3 run-slot-4; do
    # a waiter that is not the queue's head may take run-slot-2 alone
    if [ "$HEAD" = 0 ] && [ "$s" != run-slot-2 ]; then
      continue
    fi
    slot_open "$s" || continue
    # run-slot.priority names the one session that takes run-slot next (a lead sets it, as for the owner's SDK demo); everyone else leaves
    # run-slot to it while the file is under an hour old
    if [ "$s" = run-slot ] && [ -n "$(prio_holder)" ] && ! prio_for "$WHO" && prio_waiting; then
      continue
    fi
    if mkdir "$OPS/$s" 2>/dev/null; then
      SLOT="$OPS/$s"
      echo "$WHO $$ $(date -u +%FT%TZ) $UNITS $SIZE" > "$SLOT.holder"
      [ -n "$TICKET" ] && rm -f "$TICKET" && TICKET=""
      break 2
    fi
    reclaim "$OPS/$s"
  done
  if [ $((waited % 300)) -eq 0 ]; then
    echo "run-slot.sh: waiting for a run slot ($(cat "$OPS/run-slot.holder" 2>/dev/null))" >&2
  fi
  sleep "$POLL"
  waited=$((waited + 15))
done

[ -n "$SLOT" ] || exit 143
echo "run-slot.sh: $WHO holds $(basename "$SLOT")" >&2
TOOK=$(date +%s); rlog start "$(basename "$SLOT") waited=$((TOOK - ASKED))s"
run_command "$@"
