#!/bin/bash
# run-slot.sh <who> [--model-bound] -- <command> [args...]: run one heavy run (a suite, a type check, Checks, a build) holding one of the machine's run slots.
# A --model-bound run (one that mostly waits on a model, such as a parity replay) takes run-slot-model-<n> instead, at most slots.modelBound at once (model_cap, below), counted apart from the CPU slots and their queue.
# It takes ops/run-slot, run-slot-2, run-slot-3 or run-slot-4 by mkdir, as the load opens them and its size's load units fit, waiting and
# retrying while none does; writes "<who> <its own pid> <iso> <units> <size>" to the slot's .holder file beside it; runs the command as its
# child, in a new session and process group; and gives the slot back (rmdir) however it ends: success, failure or a signal. A holder whose
# pid has died is reclaimed; a slot whose holder line has no pid, or has no holder line, is held until it is 2 hours old. It prints the slot
# it took to stderr and exits with the command's code.
set -u
OPS=${RUN_SLOT_OPS:-${PLAYGROUND_DATA_DIR:-$HOME/.playground}/ops}
# this copy's path and arguments, so a waiter can run a newer copy in its place (reread, below)
SELF=$0
ARGS=("$@")
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
# (run-slot.sh set, below) and drops itself past its expiry; a file with no such line counts as set at its mtime with the default 4 hours
SWITCHES="run-slot.3-off run-slot.4-off run-slot.clone-off run-slot.load5-cap run-slot.single runner-host/off runner-host/slot-off"
# whether switch $1 (a path under ops) is on; one past its expiry is moved to <name>.expired-<ts> and logged in run-slot.runs.log
switch_on() {
  local f="$OPS/$1" line ends now
  [ -e "$f" ] || return 1
  line=$(head -n 1 "$f" 2>/dev/null)
  ends=$(printf '%s\n' "$line" | grep -E '^[^ ]+ [0-9-]{10}T[0-9:]{8}Z [0-9-]{10}T[0-9:]{8}Z ' | cut -d' ' -f3)
  now=$(date -u +%FT%TZ)
  if [ -n "$ends" ]; then
    [[ "$now" < "$ends" ]] && return 0
  else
    [ $(( $(date +%s) - $(mtime "$f" || date +%s) )) -lt 14400 ] && return 0
  fi
  mv "$f" "$f.expired-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null && echo "$now expire ${WHO:-run-slot} $$ $1 $line" >> "$OPS/run-slot.runs.log"
  return 1
}
# whether slot directory $1, whose holder line is $2, is stale: its pid has died, or a line with no pid (or no line, read by the directory's
# own mtime) has aged 2 hours; a run killed between free()'s rm of its holder and its rmdir leaves a directory with no line
stale() {
  local pid
  pid=$(printf '%s' "$2" | cut -d' ' -f2)
  if printf '%s' "$pid" | grep -Eq '^[0-9]+$'; then
    ! kill -0 "$pid" 2>/dev/null && ! ps -p "$pid" >/dev/null 2>&1
  else
    [ $(( $(date +%s) - $(mtime "$1.holder" || mtime "$1" || date +%s) )) -ge 7200 ]
  fi
}
# a setting's value as JSON, as the settings reader in this script's checkout prints it, its default on a machine with no extensions; a reader that cannot answer says why on stderr
setting() {
  local root
  root=$(python3 -I -c 'import os, sys; print(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(sys.argv[1])))))' "$SELF")
  "$(command -v bun || echo "$HOME/.bun/bin/bun")" "$root/packages/scripts/src/playground/setting.ts" "$1" </dev/null
}
# The item size a session's runs and starts count, and its load units (load is split by item so a big plan never
# blocks small ones; small:medium:big weigh 1:2:3): RUN_SLOT_SIZE, else small for commit-<worktree>, a pre-commit build that runs in
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
    if printf '%s' "$pid" | grep -Eq '^[0-9]+$' && { kill -0 "$pid" 2>/dev/null || ps -p "$pid" >/dev/null 2>&1; }; then
      [ -d "$OPS/$s" ] && { echo "$s: held by $(cut -d' ' -f1 "$h") (pid $pid, alive); left alone"; continue; }
    fi
    line=$(cat "$h" 2>/dev/null)
    [ -d "$OPS/$s" ] && rmdir "$OPS/$s" 2>/dev/null
    rm -f "$h" && echo "$s: cleared a stale holder ($line)"
  done
  exit 0
fi
# run-slot.sh size <who>: print the size and units size_of reads for that session (spawn.sh's load gate counts a start by it)
if [ "${1:-}" = size ]; then
  [ $# -eq 2 ] || { echo "usage: run-slot.sh size <who>" >&2; exit 2; }
  size_of "$2"
  exit
fi
# run-slot.sh set <who> <switch> [<value>] --reason "<why>" [--for <n>m|<n>h]: turn on switch 3-off, 4-off, clone-off, load5-cap, single,
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
    3-off|4-off|clone-off|load5-cap|single) path=run-slot.$name ;;
    *) echo "run-slot.sh: no switch $name (3-off, 4-off, clone-off, load5-cap, single, off, slot-off)" >&2; exit 2 ;;
  esac
  [ -n "$reason" ] || { echo "run-slot.sh: a set takes --reason \"<why>\", so whoever finds the switch on knows why it stands" >&2; exit 2; }
  case "$span" in [0-9]*m) unit=60 ;; [0-9]*h) unit=3600 ;; *) unit= ;; esac
  n=${span%[mh]}
  case "$n" in ""|*[!0-9]*|0*) unit= ;; esac
  [ -n "$unit" ] || { echo "run-slot.sh: --for takes a count of minutes or hours above 0, such as 30m or 4h" >&2; exit 2; }
  iso() { date -u -d "@$1" +%FT%TZ 2>/dev/null || date -u -r "$1" +%FT%TZ; }
  at=$(date +%s)
  ends=$(iso $((at + n * unit)))
  mkdir -p "$(dirname "$OPS/$path")"
  { echo "$who $(iso "$at") $ends $(printf '%s' "$reason" | tr '\n' ' ')"; [ -z "$value" ] || echo "$value"; } > "$OPS/$path.set-$$" && mv "$OPS/$path.set-$$" "$OPS/$path" || exit 1
  echo "run-slot.sh: $path is on until $ends"
  exit 0
fi
# run-slot.sh can-take <slot> <who>: exit 0 when that slot is free, its off-switches and load rules open it, and the load units (with that
# session's reserve) fit, else 1, so a script that takes its slot itself reads them as every run here does (ops-unstick does; localci and
# the merge train still take theirs by their own mkdir for now); it reads neither the queue nor run-slot.priority
CAN_TAKE=
if [ "${1:-}" = can-take ]; then
  [ $# -eq 3 ] || { echo "usage: run-slot.sh can-take <slot> <who>" >&2; exit 2; }
  case "$2" in run-slot|run-slot-2|run-slot-3|run-slot-4) CAN_TAKE=$2 ;; *) echo "run-slot.sh: no slot $2" >&2; exit 2 ;; esac
  set -- "$3" -- true
fi
MODEL_BOUND=
[ -z "$CAN_TAKE" ] && [ "${2:-}" = --model-bound ] && { MODEL_BOUND=1; set -- "$1" "${@:3}"; }
if [ $# -lt 3 ] || [ "$2" != "--" ]; then
  echo "usage: run-slot.sh <who> [--model-bound] -- <command> [args...]" >&2
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
CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 8)
# one line when a Mac run asks, takes its slot and ends, so a run's wait sits beside its run time (optimizer, 19 Oct)
rlog() { echo "$(date -u +%FT%TZ) $1 $WHO $$ $2" >> "$OPS/run-slot.runs.log" 2>/dev/null; }
[ -n "$CAN_TAKE" ] || [ -n "$REREAD" ] || rlog ask "$*"
read -r SIZE UNITS <<EOF
$(size_of "$WHO")
EOF
case "$UNITS" in 1|2|3) ;; *) SIZE=medium UNITS=2 ;; esac
# Merging keeps going: a run that gates a merge (Checks, local CI, the merge train, the dashboard's build) goes before the
# rest and may use the small reserve, as may an org's run (below) and the run-slot.priority pick. A checker's run is ranked by its worker's size (size_of), and
# the rest keep class 2 so an older copy's ticket still ranks.
case "$WHO" in ops-checks-*|ops-localci|ops-merge-train|ops-dashboard) CLASS=0 ;; *) CLASS=2 ;; esac
# A company's runs go ahead of every other waiter (the owner's priority): class 1, for a session whose roster
# entry, or its worker's (a checker's), has a pr or repo under a GitHub org ext.links guards
[ "$CLASS" = 2 ] && python3 -I - "$WHO" "$SELF" <<'PY' && CLASS=1
import json, os, re, shutil, subprocess, sys

data = os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground"))
try:
    with open(os.path.join(data, "roster.json")) as f:
        by = {a["name"]: a for a in json.load(f)["agents"] if isinstance(a, dict) and isinstance(a.get("name"), str)}
except (OSError, ValueError, KeyError, TypeError):
    sys.exit(1)
entry = by.get(sys.argv[1]) or {}
chain = [entry, by.get(str(entry.get("worker"))) or {}]
values = [str(e.get(k, "")).lower() for e in chain for k in ("pr", "repo") if e.get(k)]
if not values:
    sys.exit(1)
# the guarded orgs as the settings reader in this script's checkout prints them, read only for a session with a pr or repo
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(sys.argv[2]))))
bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
try:
    r = subprocess.run([bun, os.path.join(root, "packages", "scripts", "src", "playground", "setting.ts"), "--guarded-orgs"], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    orgs = json.loads(r.stdout) if r.returncode == 0 else []
except (OSError, ValueError, TypeError, subprocess.SubprocessError):
    sys.exit(1)
sys.exit(0 if any(re.search(rf"(?:^|/){re.escape(o)}/", v) for o in orgs for v in values) else 1)
PY
# Caps pytest-xdist's `-n auto` at 4 workers (a 15-worker round pushed load5 to 26).
export PYTEST_XDIST_AUTO_NUM_WORKERS=4
SLOT=""
CHILD=""
# seconds between a waiter's looks, and a held clone's (the tests shorten both)
POLL=${RUN_SLOT_POLL:-15}
CLONE_POLL=${RUN_SLOT_POLL:-5}

# Waiters take slots oldest first (builder, 12 Oct: a request queued at 13:28Z lost three slots in a row to later ones): each waiter leaves a
# ticket, run-slot.waiters/<ns>-<pid>-<who>, and only the oldest ticket whose pid is alive may take a slot; a ticket goes once its slot is taken
# or its waiter ends. The dashboard's own build and the merge train take run-slot-2 outside the queue, as in single-slot mode.
QUEUE="$OPS/run-slot.waiters"
TICKET=""
if [ "$WHO" != ops-dashboard ] && [ "$WHO" != ops-merge-train ] && [ -z "$CAN_TAKE" ] && [ -z "$MODEL_BOUND" ]; then
  mkdir -p "$QUEUE"
  TICKET="$QUEUE/$(python3 -I -c 'import time; print(time.time_ns())')-$$-$WHO"
  # "s2" marks a waiter that can take run-slot-2 in single-slot mode (#i162); an empty ticket is an older copy that takes run-slot only.
  # Then its rank (class and units, 01 to 23), units and size, which order the queue
  echo "s2 $CLASS$UNITS $UNITS $SIZE" > "$TICKET"
fi
# A pinned ticket keeps its place by age, so no newer ticket passes it: one with no rank, from an older copy or local CI (plain "s2", or
# empty), since those take a slot only while theirs is the oldest live ticket and any other order deadlocks them (a review's round 1), and
# one that has waited AGED seconds, 20 minutes, so the slots drain and a run too big for the free units still starts
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
  # the live tickets in the order they take slots, one "<pinned 0|1> <ticket>" a line: between pinned tickets, an org's, then Checks for a
  # PR in the ready line by its place there, then those that gate a merge, then the rest, each small before medium
  # before big, oldest first. A dead waiter's goes on the way
  local t pid rank m p seg=0 now ready
  now=$(date +%s)
  ready=$(ready_line)
  for t in $(ls "$QUEUE" 2>/dev/null | sort -t- -k1,1n); do
    pid=$(printf '%s' "$t" | cut -d- -f2)
    if ! kill -0 "$pid" 2>/dev/null && ! ps -p "$pid" >/dev/null 2>&1; then rm -f "${QUEUE:?}/${t:?}"; continue; fi
    m=$(mtime "$QUEUE/$t") || continue
    rank=$(cut -d' ' -f2 "$QUEUE/$t" 2>/dev/null)
    case "$rank" in [0-2][1-3]) [ $((now - m)) -lt "$AGED" ] && {
      case "$rank" in
        1?) rank=0$rank ;;
        *) p=$(ready_place "${t#*-*-}" "$ready"); if [ -n "$p" ]; then rank=1$(printf '%04d' "$p"); else rank=2$rank; fi ;;
      esac
      echo "$seg $rank 0 $t"
      continue
    } ;; esac
    echo "$((seg + 1)) 00 1 $t"
    seg=$((seg + 2))
  done | sort -s -k1,1n -k2,2 | cut -d' ' -f3,4
}
first_waiter() {
  # the first waiter in that order whose run fits the units free now, so a run too big for them never holds back a smaller one behind it,
  # or the first pinned one, fitting or not; with s2, only among the waiters that can take run-slot-2 (builder, 12 Oct: older copies at
  # the head left slot 2 idle)
  local p t f c r held list mode=${1:-}
  c=$(capacity); r=$(reserve "$c"); held=$(held_units)
  list=$(ordered_waiters)
  while read -r p t; do
    [ -n "$t" ] || continue
    f=$(cat "$QUEUE/$t" 2>/dev/null)
    [ "$mode" = s2 ] && [ -z "$f" ] && continue
    set -- $f
    if [ "$p" = 1 ] || fits "$held" "${3:-2}" $((c - $(may_reserve "${2:-22}" "${4:-medium}" "${t#*-*-}" "$r"))); then echo "$t"; return; fi
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
  [ -f "$OPS/run-slot.priority" ] && [ $(( $(date +%s) - $(mtime "$OPS/run-slot.priority") )) -lt 3600 ] && cut -d' ' -f1 "$OPS/run-slot.priority"
}
prio_waiting() {
  # true while the priority holder has a ticket whose waiter still runs
  local h t pid
  h=$(prio_holder) || return 1
  [ -n "$h" ] || return 1
  for t in $(ls "$QUEUE" 2>/dev/null | grep -- "-$h\$"); do
    pid=$(printf '%s' "$t" | cut -d- -f2)
    { kill -0 "$pid" 2>/dev/null || ps -p "$pid" >/dev/null 2>&1; } && return 0
  done
  return 1
}

free() {
  # give the slot back only while its holder line is still ours
  if [ -n "$SLOT" ] && [ "$(cut -d' ' -f2 "$SLOT.holder" 2>/dev/null)" = "$$" ]; then
    # the holder line goes first, so a waiter whose mkdir loses to the next taker never reads our dead pid and reclaims that taker's slot (reviewer-ops-load-units, 19 Oct)
    rm -f "$SLOT.holder"
    rmdir "$SLOT" 2>/dev/null
  fi
  SLOT=""
  [ -n "$TICKET" ] && rm -f "$TICKET"
}
trap 'free' EXIT
trap '[ -n "$CHILD" ] && kill -TERM -- "-$CHILD" 2>/dev/null; wait "$CHILD" 2>/dev/null; exit 143' TERM INT HUP

reclaim() {
  # $1 is a slot directory that mkdir found taken: free it when its holder line ($2 of stale) has gone stale; the line and the directory are
  # read again just before the rmdir, so a waiter that freed and took the slot meanwhile keeps it
  local line dir
  line=$(cat "$1.holder" 2>/dev/null); dir=$(stamp "$1")
  stale "$1" "$line" || return 0
  [ "$(cat "$1.holder" 2>/dev/null)" = "$line" ] && [ "$(stamp "$1")" = "$dir" ] && rmdir "$1" 2>/dev/null
}

# whether the load rules open slot $1 to this run now
slot_open() {
  local s=$1 cap
  # run-slot.single (builder, 9 Oct: heavy suites one at a time) closes slots 2 and 3 to new holders while it exists
  # ...except for the dashboard's own build and the merge train (12 Oct: single-slot mode left both waiting an hour behind testers' runs)
  # #i162: in single-slot mode run-slot-2 still opens for a second suite; since 13 Oct (dispatcher, so work runs while the
  # machine allows) it opens on memory: free share 40% or more (ops, 19 Oct 01:16Z, from the optimizer: 9 Mac-only waiters at
  # pressure 1 with 43% free), pressure normal, and the 5-minute load under 22 as a backstop
  if [ "$s" != run-slot ] && switch_on run-slot.single && [ "$WHO" != ops-dashboard ] && [ "$WHO" != ops-merge-train ]; then
    # run-slot.load5-cap lowers the load line for a while (builder, 12 Oct: 12 while the live dashboard's cmux reads time out); 22 at most
    # its cap is the file's last line, the one a set writes below its reason or an old-shape file's only one
    cap=$(switch_on run-slot.load5-cap && tail -n 1 "$OPS/run-slot.load5-cap" | grep -xE '[0-9]{1,3}'); [ -n "$cap" ] || cap=22; [ "$cap" -le 22 ] || cap=22
    if [ "$s" = run-slot-2 ] && [ "$(load5)" -lt "$cap" ] && mem_ok; then :; else return 1; fi
  elif [ "$s" = run-slot-2 ] && [ "$(load1)" -ge "$CORES" ]; then
    return 1
  fi
  # a third slot, approved by dispatcher (8 Oct), opens only while the 1-minute load is under 12; a holder that took it finishes either way
  # run-slot.3-off closes it too (dispatcher, 18 Oct: the owner's machine loud at load1 29.6; two slots until load5 holds under 12 for 10 minutes)
  if [ "$s" = run-slot-3 ] && { [ "$(load1)" -ge 12 ] || switch_on run-slot.3-off; }; then
    return 1
  fi
  # a fourth slot, dispatcher's factory call (18 Oct, a two-way door: 14 waiters at 12:40Z, 5/5 PRs to merge within 30 minutes): it opens
  # only while the 1-minute load is under 12 and run-slot.4-off is absent; Ops creates run-slot.4-off when load5 holds over 25 for
  # 10 minutes or the owner's dictation shows a delay
  if [ "$s" = run-slot-4 ] && { [ "$(load1)" -ge 12 ] || switch_on run-slot.4-off; }; then
    return 1
  fi
  return 0
}

# Load units: each held slot's run counts the units on its holder line (2, a medium, for a line with none), and the slots the load rules
# open now, or a holder already has, give 2 units each. A quarter of them, at least 1, stays for small runs and the runs that gate a
# merge, so a big run never blocks a small one
held_units() {
  local s u total=0
  for s in run-slot run-slot-2 run-slot-3 run-slot-4; do
    reclaim "$OPS/$s"
    [ -d "$OPS/$s" ] || continue
    u=$(cut -d' ' -f4 "$OPS/$s.holder" 2>/dev/null)
    case "$u" in 1|2|3) ;; *) u=2 ;; esac
    total=$((total + u))
  done
  echo "$total"
}
capacity() {
  local s n=0
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
  [ -n "$3" ] && [ "$(prio_holder)" = "$3" ] && { echo 0; return; }
  echo "$4"
}

load1() { sysctl -n vm.loadavg 2>/dev/null | awk '{print int($2)}'; }
load5() { sysctl -n vm.loadavg 2>/dev/null | awk '{print int($3)}'; }
# macOS's memory reading $1: level (the free share) or vm_pressure_level (1 normal, 2 warn, 4 critical)
memstat() { sysctl -n "kern.memorystatus_$1" 2>/dev/null | tr -cd 0-9; }
# memory room for a second suite: macOS's free share at 40% or more and its pressure level normal (1; 2 is warn, 4 critical)
mem_ok() {
  local free level
  free=$(memstat level); level=$(memstat vm_pressure_level)
  [ -n "$free" ] && [ -n "$level" ] && [ "$free" -ge 40 ] && [ "$level" -eq 1 ]
}

# Quick slots, outside the queue, one holder each: a plain git commit (its pre-commit build, about 17s) takes run-slot-commit (builder,
# 13 Oct: five commits waited in a fifteen-deep queue; a commit with a longer hook goes through the queue as <who> -- bash -c '...'), and a
# node_modules clone (cp -cR <sibling>/node_modules <worktree>/) takes run-slot-clone (dispatcher, 13 Oct: three load spikes, 77 and 43
# among them, each with fseventsd near 100% while clones ran at once); a git merge or pull takes run-slot-commit too, and a short bun test,
# docs:wrap or format:check takes run-slot-quick
quick_kind() {
  local a first=""
  # the command's first word past env and VAR=x, as box_fits finds it (optimizer, 19 Oct: a commit run as env NODE_ENV=... git commit waited 14 min in the queue)
  for a in "$@"; do case "$a" in env|*=*) continue ;; esac; first=$a; break; done
  if [ "$(basename "$first")" = git ]; then
    # a merge or pull runs no pre-commit build (lefthook.yml has no merge hook), so it ends in seconds (optimizer, 20 Oct: a 1s git merge waited 26.6 min behind suites)
    for a in "$@"; do case "$a" in commit|merge|pull) echo commit; return ;; esac; done
  elif [ "$(basename "$first")" = cp ]; then
    for a in "$@"; do a=${a%/.}; case "${a%/}" in node_modules|*/node_modules) echo clone; return ;; esac; done
  elif [ "$(basename "$first")" = bun ]; then
    # a bun test or bun run test:file naming 1 to 3 test files, nothing else, takes run-slot-quick, with --cwd=<p> anywhere or a bare --cwd after run or test, since bun misreads one before the subcommand (scripts/hooks/README.md's no-false-green; ops, 20 Oct: with slot-off, a 5-file run that ran 1s waited 52 min behind suites; PG-2158)
    # bun run docs:wrap and format:check never run past seconds (run-slot.runs.log, 20 Oct: max 2s and 9s), so they take run-slot-quick too
    for a in "$@"; do case "$a" in docs:wrap|format:check) echo quick; return ;; esac; done
    local n=0 t="" skip=""
    for a in "$@"; do
      [ -n "$skip" ] && { skip=""; continue; }
      if [ "$a" = --cwd ]; then [ -n "$t" ] && skip=1 || return; continue; fi
      case "$a" in env|*=*|-*) continue ;; esac
      [ "$a" = "$first" ] && continue
      case "$a" in run|test|test:file) t="$t $a" ;; *.e2e.*) return ;; *.test.ts|*.test.tsx) n=$((n + 1)) ;; *) return ;; esac
    done
    case "$t" in " test" | " run test:file") [ "$n" -ge 1 ] && [ "$n" -le 3 ] && echo quick ;; esac
  fi
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
  python3 -I -c 'import os, sys; os.setsid(); os.nice(int(os.environ.get("RUN_SLOT_NICE", "10"))); os.execvp(sys.argv[1], sys.argv[1:])' "$@" <&3 3<&- &
  CHILD=$!
  wait "$CHILD"
  code=$?
  CHILD=""
  rlog end "rc=$code ran=$(($(date +%s) - TOOK))s"
  exit "$code"
fi
KIND=$(quick_kind "$@")
if [ -n "$KIND" ]; then
  [ -n "$TICKET" ] && rm -f "$TICKET" && TICKET=""
  waited=0
  # run-slot.clone-off holds every clone while it exists (dispatcher, 18 Oct, with run-slot.3-off)
  # run-slot.clone-allow holds, one a line, grep patterns for the clones a lead lets through while clone-off stands (builder, 18 Oct: priority clones in order; every checker by default, finish-first)
  # clone-off lets a clone through while load1 and load5 are under 30 and memory passes spawn.sh's gate, pressure level 1 or 2 with 8% or more free (dispatcher, 19 Oct 01:18Z;
  # builder, 19 Oct); spawn.sh keeps its 8 inside its own Python, so the number is written twice until one home holds it
  # load1 counts since load5 lags a fresh spike (optimizer, 19 Oct 03:42Z: a clone let through at load5 under 30 took load1 to 73)
  clone_held() {
    [ "$KIND" = clone ] && switch_on run-slot.clone-off && ! printf "%s\n" "$WHO" | grep -qxf "$OPS/run-slot.clone-allow" 2>/dev/null &&
      ! { case "$(memstat vm_pressure_level)" in 1|2) true ;; *) false ;; esac && [ "$(memstat level)" -ge 8 ] 2>/dev/null && [ "$(load5)" -lt 30 ] && [ "$(load1)" -lt 30 ]; }
  }
  while clone_held; do reread; sleep "$CLONE_POLL"; done
  # bash 5.2 can fail to parse the TERM trap while it expands a "$(...)" and then drop the loop it was in (measured on the runner host:
  # the waiter ran its command with no slot), so each wait checks it ended as it should, and the waiter stops when it did not
  clone_held && { echo "run-slot.sh: run-slot.clone-off holds this clone, so $WHO stops" >&2; exit 143; }
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
  echo "$WHO $$ $(date -u +%FT%TZ)" > "$SLOT.holder"
  echo "run-slot.sh: $WHO holds run-slot-$KIND" >&2
  TOOK=$(date +%s); rlog start "run-slot-$KIND waited=$((TOOK - ASKED))s"
  python3 -I -c 'import os, sys; os.setsid(); os.nice(int(os.environ.get("RUN_SLOT_NICE", "10"))); os.execvp(sys.argv[1], sys.argv[1:])' "$@" <&3 3<&- &
  CHILD=$!
  wait "$CHILD"
  code=$?
  CHILD=""
  rlog end "rc=$code ran=$(($(date +%s) - TOOK))s"
  exit "$code"
fi

if [ -n "$CAN_TAKE" ]; then
  reclaim "$OPS/$CAN_TAKE"
  [ ! -d "$OPS/$CAN_TAKE" ] && slot_open "$CAN_TAKE" || exit 1
  c=$(capacity)
  fits "$(held_units)" "$UNITS" $((c - $(may_reserve "$CLASS$UNITS" "$SIZE" "$WHO" "$(reserve "$c")")))
  exit
fi

waited=0
while :; do
  reread
  # HEAD: first in the queue (any slot); S2: first among waiters that can take run-slot-2, so an older copy at the head cannot idle it
  HEAD=1; S2=1
  if [ -n "$TICKET" ] && [ "$(prio_holder)" != "$WHO" ]; then
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
  # this run's own units must fit beside what the slots hold now (the queue's order checked them for a waiter at its head)
  c=$(capacity)
  if ! fits "$(held_units)" "$UNITS" $((c - $(may_reserve "$CLASS$UNITS" "$SIZE" "$WHO" "$(reserve "$c")"))); then
    [ $((waited % 300)) -eq 0 ] && echo "run-slot.sh: waiting for $UNITS free load units ($SIZE; $(held_units) of $c held)" >&2
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
    if [ "$s" = run-slot ] && [ -n "$(prio_holder)" ] && [ "$(prio_holder)" != "$WHO" ] && prio_waiting; then
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
# the command leads a process group of its own (macOS has no setsid(1)), so a dev stack it starts can be stopped by bun run dev:stop
python3 -I -c 'import os, sys; os.setsid(); os.nice(int(os.environ.get("RUN_SLOT_NICE", "10"))); os.execvp(sys.argv[1], sys.argv[1:])' "$@" <&3 3<&- &
CHILD=$!
wait "$CHILD"
code=$?
CHILD=""
rlog end "rc=$code ran=$(($(date +%s) - TOOK))s"
exit "$code"
