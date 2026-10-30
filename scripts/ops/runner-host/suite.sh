#!/bin/bash
# suite.sh <run>: runs local CI's steps on the runner host, so a suite takes no slot on the Mac (dispatcher, 18 Oct). ci.sh uploads a
# `git archive` to /srv/ci/<run>.tar and starts this as root in a systemd unit of its own, so a dropped ssh never ends the run; it unpacks
# the archive into /srv/ci/.claude/worktrees/<run> and runs every step as the runner user beside a Postgres container of its own on loopback. The box gets
# the code alone: .env comes from .env.example with a secret made here, and no token or key of the Mac's reaches it. Prints one line per
# step, `ok <step> <s>s` or `fail <step> <s>s: <tail>`, then `done <s>s`, and exits 1 when any step failed.
set -uo pipefail

RUN=${1:-}
MODE=${2:-suite}
[ "$MODE" = suite ] || [ "$MODE" = exec ] || [ "$MODE" = web ] || [ "$MODE" = stop ] || { echo "suite.sh: the mode is suite, exec, web or stop" >&2; exit 2; }
[[ "$RUN" =~ ^[0-9a-f]{12}-[0-9a-z]{6}$ ]] || { echo "suite.sh: <run> is <tree id's first 12>-<6 letters>" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "suite.sh: run it as root" >&2; exit 2; }
# the run's files are /srv/ci/<run>.*, and its tree sits under .claude/worktrees/, as a Mac worktree does, since some tests read their
# own checkout's path (dashboardSource's rule 4)
F=/srv/ci/$RUN
DIR=/srv/ci/.claude/worktrees/$RUN
# gone <run>: removes, volumes too, the run's own container and every container its steps started, which the docker shim below labels
# with the run, since the tests start theirs with no name (round 12)
gone() {
  timeout 60 docker rm -fv "ci-$1" > /dev/null 2>&1
  for c in $(timeout 60 docker ps -aq --filter "label=playground.ci.run=$1"); do timeout 60 docker rm -fv "$c" > /dev/null; done
}
# stop: the unit's ExecStopPost, which systemd runs however the unit ends, a stop from outside included, so nothing the run started stays
if [ "$MODE" = stop ]; then
  gone "$RUN"
  rm -rf "${DIR:?}" "$F.tar" "$F.test" "$F.cmd" "$F.base" "$F.beat"
  exit 0
fi
# ci.sh touches the run's heartbeat on every poll, and gives up on a box it cannot read for 10 minutes, so a heartbeat 11 minutes old
# means no ci.sh waits on the run (a SIGKILL, a restart, a tool's timeout) and it stops itself, queued or running; a run started
# by a ci.sh before the heartbeat has none and is never watched. systemd ends this watch with the unit
watch_beat() {
  while sleep 30; do
    [ -f "$F.beat" ] || return 0
    [ -n "$(find "$F.beat" -mmin +11 2> /dev/null)" ] || continue
    echo "fail run: no ci.sh has polled ci-$RUN for 11 minutes, so the run stopped itself"
    systemctl stop --no-block "ci-$RUN"
    return 0
  done
}
[ -f "$F.beat" ] && watch_beat &
install -d -o runner -g runner -m 0755 /srv/ci /srv/ci/.claude /srv/ci/.claude/worktrees
# runs wait for the box's slots, as many as /srv/ci/slots says (2 by default), each a lock its run holds to the end, first come
# first served: only the oldest live waiter tries a slot, since a bare retry let short runs starve a suite (22 min, 19 Oct)
SLOTS=$(cat /srv/ci/slots 2> /dev/null || echo 2)
[[ "$SLOTS" =~ ^[1-9][0-9]?$ ]] || SLOTS=2
# a suite peaks at about 4.5G (measured, 24 Oct); room() alone reads these, kept for the undo of one suite at a time
SUITE_PEAK_KB=$((4608 * 1024))
SUITE_MARGIN_KB=$((2048 * 1024))
Q=/srv/ci/queue
install -d -m 0755 "$Q"
TICKET=$Q/$(date +%s%N)-$RUN
: > "$TICKET"
trap 'rm -f "$TICKET"' EXIT
# an exec run takes one slot; a suite takes the suite lanes to itself, so one suite runs at a time and the next waits for it to end,
# and an exec run waits for every suite to end; an exec run of the whole suite (`bun run test` or `bun run test:file` with no file), any
# --cwd aside, takes its slots as a suite does, `bun run test:skills` (about 200s) takes one as any exec does, and a web image build,
# whose peak alone fills the box's memory, takes every slot alone, so it waits for the suites and they for it
TAKE=$MODE
if [ "$MODE" = exec ] && [ -f "$F.cmd" ]; then
  { IFS= read -r _; mapfile -d '' cmd; } < "$F.cmd"
  words=()
  skip=0
  for w in "${cmd[@]}"; do
    if [ "$skip" = 1 ]; then skip=0
    elif [ "$w" = --cwd ]; then skip=1
    elif [[ "$w" != --cwd=* ]]; then words+=("$w"); fi
  done
  case "${words[*]}" in "bun run test" | "bun run test:file") TAKE=suite ;; esac
fi
LOCKS=()
LANE=
release() {
  local fd
  for fd in "${LOCKS[@]}" $LANE; do eval "exec $fd>&-"; done
  LOCKS=()
  LANE=
}
# whether the box's free memory covers one more suite's peak and the margin
room() {
  local kb
  kb=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo 2> /dev/null)
  [ "${kb:-0}" -ge $((SUITE_PEAK_KB + SUITE_MARGIN_KB)) ]
}
take() {
  local i fd other how=(-n)
  [ "$TAKE" = suite ] && how=(-s -n)
  for i in $(seq "$SLOTS"); do
    # a fixed fd a slot, since bash 3.2 (a Mac's, where the tests run this block) has no {fd} redirect
    fd=$((9 + i))
    eval "exec $fd> \"/srv/ci/slot-$i.lock\""
    if flock "${how[@]}" "$fd"; then
      LOCKS+=("$fd")
      [ "$TAKE" = exec ] && return 0
    else
      eval "exec $fd>&-"
      [ "$TAKE" = exec ] || { release; return 1; }
    fi
  done
  [ "$TAKE" = exec ] && return 1
  [ "$TAKE" = suite ] || return 0
  for i in 1 2; do
    fd=$((110 + i))
    eval "exec $fd> \"/srv/ci/suite-$i.lock\""
    flock -n "$fd" && { LANE=$fd; break; }
    eval "exec $fd>&-"
  done
  [ -n "$LANE" ] || { release; return 1; }
  # the other lane free means this suite runs alone; held, it waits
  other=$((LANE == 111 ? 112 : 111))
  eval "exec $other> \"/srv/ci/suite-$((other - 110)).lock\""
  if flock -n "$other"; then
    eval "exec $other>&-"
    return 0
  fi
  eval "exec $other>&-"
  # one suite at a time (dispatcher, 24 Oct: side by side took 632s each against 316s alone, PG-1937); room() stays for the undo
  release
  return 1
}
while :; do
  ahead=0
  for t in "$Q"/*; do
    [ "$t" = "$TICKET" ] && break
    [ -e "$t" ] || continue
    systemctl is-active --quiet "ci-$(basename "$t" | cut -d- -f2-)" || { rm -f "$t"; continue; }
    ahead=$((ahead + 1))
  done
  [ "$ahead" = 0 ] && take && break
  sleep 5
done
rm -f "$TICKET"
# a run whose unit never reached its stop (a power cut) leaves its containers and tree; each container carries its run's name or label, so
# whatever no live unit holds is gone
for r in $({ timeout 60 docker ps -a --format '{{.Names}}' | sed -n 's/^ci-//p'; timeout 60 docker ps -a --filter label=playground.ci.run --format '{{.Label "playground.ci.run"}}'; } | sort -u); do
  systemctl is-active --quiet "ci-$r" || gone "$r"
done
# the first glob is where older runs kept their trees
for d in /srv/ci/*-*/ /srv/ci/.claude/worktrees/*-*/; do [ -d "$d" ] && ! systemctl is-active --quiet "ci-$(basename "$d")" && rm -rf "${d:?}"; done
# a stopped run's upload and test output too, once 10 minutes old, since ci.sh uploads a run's files a moment before it starts its unit
for f in $(find /srv/ci -maxdepth 1 -type f \( -name '*-*.tar' -o -name '*-*.test' -o -name '*-*.cmd' -o -name '*-*.base' -o -name '*-*.beat' \) -mmin +10); do systemctl is-active --quiet "ci-$(basename "${f%.*}")" || rm -f "$f"; done
rm -rf "${DIR:?}"
install -d -o runner -g runner -m 0700 "$DIR"
runuser -u runner -- tar -x -C "$DIR" -f "$F.tar" || { echo "suite.sh: the archive did not unpack" >&2; [ "$MODE" = suite ] || exit 255; exit 2; }
rm -f "$F.tar"
# the docker the run's steps find first on their PATH: it labels every container they start with the run, and passes any other call on
install -d -m 0755 /srv/ci/bin
cat > "/srv/ci/bin/.docker.$RUN" << 'SHIM'
#!/bin/bash
case "${1:-}" in
  run | create) exec /usr/bin/docker "$1" --label "playground.ci.run=${CI_RUN:-}" "${@:2}" ;;
  container) case "${2:-}" in run | create) exec /usr/bin/docker container "$2" --label "playground.ci.run=${CI_RUN:-}" "${@:3}" ;; esac ;;
esac
exec /usr/bin/docker "$@"
SHIM
chmod 0755 "/srv/ci/bin/.docker.$RUN" && mv "/srv/ci/bin/.docker.$RUN" /srv/ci/bin/docker

# the subshell closes the slot locks before the steps start, so a daemon a step leaves behind cannot keep a slot once this run ends
(
  release
  # past the box's slowest parallel pass (1830s measured, 27 Oct) and under the suite step's timeout 2400, so a stall ends naming its files
  exec runuser -u runner -- env -i CI_RUN="$RUN" HOME=/home/runner PATH=/srv/ci/bin:/home/runner/.bun/bin:/home/runner/.local/bin:/usr/bin:/bin TEST_PARALLEL_DEADLINE_MS=2100000 RUN="$RUN" DIR="$DIR" F="$F" MODE="$MODE" bash -s
) << 'EOF'
set -uo pipefail
cd "$DIR" || { [ "$MODE" = suite ] || exit 255; exit 2; }
DB=ci-$RUN
LOG=$F.log
: > "$LOG"
# a run that cannot reach Docker never reads green: a test that skips itself without Docker would pass with nothing run
timeout 30 docker info > /dev/null 2>&1 || { echo "fail docker: Docker does not answer for the runner user"; [ "$MODE" = suite ] || exit 255; exit 1; }
# web: ci.sh web's build of the web image, here since on the Mac its peak takes the Docker VM's out-of-memory killer to the live dashboard's
# Postgres; .env is the docker-test skill's smoke one, the image gets that skill's single-libc check, and it goes once checked
if [ "$MODE" = web ]; then
  sed -e 's|^BETTER_AUTH_SECRET=$|BETTER_AUTH_SECRET=dummy|' \
    -e 's|^POSTGRES_URL=$|POSTGRES_URL=postgres://dummy:dummy@localhost:5432/dummy|' \
    -e 's|^AGENT_SIGNIN_ENABLED=$|AGENT_SIGNIN_ENABLED=true|' .env.example > .env
  chmod 600 .env
  timeout 3600 docker compose build --no-cache web < /dev/null 2>&1
  code=$?
  if [ "$code" = 0 ]; then
    timeout 300 docker run --rm --entrypoint sh "$RUN-web" -c \
      'find /app/node_modules \( -name "*linux-*-gnu*" -o -name "*sharp-linux-*" -o -name "*libvips-linux-*" \) ! -type l | grep . && echo "FAIL: glibc stack shipped" && exit 1; echo "ok single-libc"' < /dev/null 2>&1
    code=$?
  fi
  timeout 300 docker compose down --rmi local < /dev/null > /dev/null 2>&1
  exit "$code"
fi
trap 'docker rm -fv "$DB" > /dev/null 2>&1' EXIT
trap 'exit 143' TERM INT
START=$(date +%s)
failed=0
step() {
  local name=$1 timeout=$2 t0 code
  shift 2
  t0=$(date +%s)
  printf '\n== %s: %s\n' "$name" "$*" >> "$LOG"
  # stdin is this script, so a step reads nothing from it
  timeout "$timeout" "$@" >> "$LOG" 2>&1 < /dev/null
  code=$?
  if [ "$code" = 0 ]; then
    echo "ok $name $(($(date +%s) - t0))s"
  else
    echo "fail $name $(($(date +%s) - t0))s: exit $code: $(tail -n 3 "$LOG" | tr '\n' ' ' | cut -c1-300)"
    failed=1
  fi
}
# the suite, with Checks' rule for load flakes: each failing file again alone, then the whole suite once more, every re-run named
test_step() {
  local t0 code out=$F.test files f alone="" ok=1
  t0=$(date +%s)
  printf '\n== test: bun run test\n' >> "$LOG"
  timeout 2400 bun run test > "$out" 2>&1 < /dev/null
  code=$?
  cat "$out" >> "$LOG"
  if [ "$code" = 0 ] && sandbox_ok "$out"; then
    echo "ok test $(($(date +%s) - t0))s: $(summary "$out")"
    return
  fi
  local first fails
  files=$(failing_files "$out")
  first=$(summary "$out")
  fails=$(failing_names "$out")
  for f in $files; do
    if timeout 600 bun run test:file "$f" >> "$LOG" 2>&1 < /dev/null; then alone="$alone $f pass,"; else alone="$alone $f fail,"; ok=0; fi
  done
  if [ -n "$files" ] && [ "$ok" = 1 ]; then
    printf '\n== test again: bun run test\n' >> "$LOG"
    timeout 2400 bun run test > "$out" 2>&1 < /dev/null
    code=$?
    cat "$out" >> "$LOG"
    if [ "$code" = 0 ] && sandbox_ok "$out"; then
      echo "ok test $(($(date +%s) - t0))s: $(summary "$out"); the first run had $first, its files each passed alone:${alone%,}, and the full suite passed again"
      return
    fi
    # the lines below come from this second run alone, so the Mac re-runs the files that failed in it
    files=$(failing_files "$out")
    fails=$(failing_names "$out")
    first="$first, then the full suite again had $(summary "$out")"
  fi
  # the failing tests by name and their files, so the Mac can re-run a test known to fail on Linux alone
  grep '^(fail)' "$out" | sed -e 's/^(fail) //' -e 's/ \[[0-9.]*m*s\]$//' | sort -u | sed 's/^/failed test /'
  [ -n "$files" ] && echo "files test" $files
  # the failures and the errors outside a test the run counted, so the Mac never re-runs a run whose failures the names do not cover
  echo "tally test $(sed -n 's/^ *\([0-9]*\) fail$/\1/p' "$out" | awk '{ s += $1 } END { print s + 0 }') $(sed -n 's/^ *\([0-9]*\) errors\{0,1\}$/\1/p' "$out" | awk '{ s += $1 } END { print s + 0 }')"
  echo "fail test $(($(date +%s) - t0))s: exit $code: ${first:-no summary}; failing: ${fails:-$(tail -n 3 "$out" | tr '\n' ' ' | cut -c1-200)}${alone:+; re-run alone:${alone%,}}"
  failed=1
}
# bun's closing `N tests failed:` list repeats every (fail) line after the last file header, so a file is read only above it
failing_files() { awk '/^tests\/.*\.test\.tsx?:$/ { f = $0; sub(/:$/, "", f) } /^[0-9]+ tests? failed:$/ { f = "" } /^\(fail\)/ && f { print f }' "$1" | sort -u | head -8; }
failing_names() { grep '^(fail)' "$1" | sort -u | head -5 | cut -c8-110 | paste -sd ';' -; }
# the parallel pass and the serial pass each print their own counts, summed here
summary() { awk '/^ *[0-9]+ (pass|fail|errors?)$/ { n[$2 ~ /^error/ ? "errors" : $2] += $1 } END { s = (n["pass"] + 0) " pass, " (n["fail"] + 0) " fail"; if (n["errors"]) s = s ", " n["errors"] " errors"; print s }' "$1"; }
# the last test-sandbox: line says how both passes went; an older tree prints none, and its exit alone decides
sandbox_ok() {
  local last
  last=$(grep '^test-sandbox: parallel pass' "$1" | tail -1)
  [ -z "$last" ] || [ "$last" = "test-sandbox: parallel pass passed, serial pass passed" ]
}
# a repository of one commit, since some tests run git; EMAIL gives git an identity, since this host's name has no domain
export EMAIL=ci@localhost
git init -q && git add -A && git -c user.name=ci commit -qm ci > /dev/null
PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
timeout 600 docker run -d --name "$DB" -e POSTGRES_PASSWORD="$PW" -p 127.0.0.1::5432 postgres:alpine > /dev/null 2>&1 || { echo "fail db: the container did not start"; [ "$MODE" = exec ] && exit 255; exit 1; }
PORT=$(timeout 30 docker port "$DB" 5432 | head -1 | sed 's/.*://')
# over TCP: postgres:alpine's first start answers on its Unix socket from a temporary initdb server it then stops, and that takes no TCP
for _ in $(seq 60); do timeout 10 docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1 && break; sleep 1; done
timeout 10 docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1 || { echo "fail db: Postgres did not answer in 60s"; [ "$MODE" = exec ] && exit 255; exit 1; }
sed -e "s|^POSTGRES_URL=.*|POSTGRES_URL=postgresql://postgres:$PW@127.0.0.1:$PORT/postgres|" \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')|" .env.example > .env
chmod 600 .env
# exec: the one command ci.sh exec sent, in the folder it ran from, after the install, the shared packages' build and the migration a
# Mac worktree already has; its output and its exit code are the run's, and 255 means the box could not prepare it
if [ "$MODE" = exec ]; then
  export TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
  # each with the suite path's time limit, so a hang ends the run and it goes back to the Mac
  { timeout 900 bun install --ignore-scripts --frozen-lockfile && timeout 1800 node_modules/.bin/turbo run build --filter='./packages/*' &&
    timeout 600 env -u NODE_ENV -u SKIP_ENV_VALIDATION bun run db:migrate; } >> "$LOG" 2>&1 < /dev/null ||
    { echo "suite.sh: the box could not prepare $RUN (its log is $LOG)"; exit 255; }
  { IFS= read -r rel; mapfile -d '' args; } < "$F.cmd"
  # a test run gets the generated file the root test script writes before its tests, as a Mac worktree has it
  case " ${args[*]} " in
    *" test "* | *" test:file "*) timeout 300 bun packages/scripts/src/data-table-metrics.ts >> "$LOG" 2>&1 < /dev/null ||
      { echo "suite.sh: the box could not prepare $RUN (its log is $LOG)"; exit 255; } ;;
  esac
  cd "$DIR$rel" || exit 255
  timeout 3600 "${args[@]}" < /dev/null 2>&1
  exit $?
fi
# as local CI runs them: every step in production mode with env checks off, but the migration
export NODE_ENV=production SKIP_ENV_VALIDATION=true TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
step install 900 bun install --ignore-scripts --frozen-lockfile
# audit.ts retries a hang or 5xx inside this step's 300s, and with ci.sh's base lockfile fails only on what the head adds
over=()
[ -f "$F.base" ] && over=(--new-over "$F.base")
# GHSA-vfj7-8cjw-p6xm: braces has no patched release, and only dev tooling (shadcn, globby) reaches it
step audit 300 bun packages/scripts/src/audit.ts --audit-level high --ignore GHSA-vfj7-8cjw-p6xm "${over[@]}"
step format:check 600 bun run format:check
step lint 600 bun run lint
step check-types 1200 bun run check-types
step db:migrate 600 env -u NODE_ENV -u SKIP_ENV_VALIDATION bun run db:migrate
test_step
step build 1800 bun run build
step test:skills 1800 bun run test:skills
echo "done $(($(date +%s) - START))s"
exit "$failed"
EOF
code=$?
# the log stays a week for a look; the tree and its node_modules go, since every run unpacks a fresh one
rm -rf "${DIR:?}" "$F.test" "$F.cmd" "$F.base"
find /srv/ci -maxdepth 1 -type f \( -name '*.log' -o -name '*.out' \) -mtime +7 -delete
exit "$code"
