#!/bin/bash
# hc's trial world's wrapper: spawn.sh's probe start copies it to <data>/hc-trial/hc, the one path no-raw-spawn lets an hc call run by.
# It runs the world's herdr-core only while it hashes to the pin the world's build wrote, in the world's own folders and session word, with the shell basics of its caller's environment alone.
set -u
world=$(cd -P "$(dirname "$0")" && pwd -P) || exit 1
bin=$world/bin/herdr-core
pin=$(cat "$world/pin" 2>/dev/null)
found=$(shasum -a 256 "$bin" 2>/dev/null)
found=${found%% *}
if [ -z "$pin" ] || [ "$found" != "$pin" ]; then
  echo "hc-trial: refusing: $bin hashes to ${found:-nothing}, not its pin ${pin:-(none in $world/pin)}, so it is not the checked copy; remove $world with playground rm, and spawn.sh probe <name> <reports-to> <brief> --runtime hc builds it again" >&2
  exit 1
fi
# A start, an update and another machine run only for spawn.sh's probe start, which writes a one-time word to <world>/start and passes it as HC_TRIAL_START; every other route to them, however no-raw-spawn read it, stops here.
verb=
for word in "$@"; do
  case "$word" in --on | --on=*) verb=--on ;; -*) ;; *) [ -n "$verb" ] || verb=$word ;; esac
  [ "$verb" = --on ] && break
done
case "$verb" in
  connect | machine | run | update | --on)
    start=$(cat "$world/start" 2>/dev/null)
    rm -f -- "$world/start"
    if [ -z "$start" ] || [ "$start" != "${HC_TRIAL_START:-}" ]; then
      echo "hc-trial: refusing: hc $verb starts, updates or reaches past the trial world, so only spawn.sh probe <name> <reports-to> <brief> --runtime hc runs it" >&2
      exit 1
    fi
    ;;
esac
# The core's socket sits in XDG_RUNTIME_DIR, whose path a socket's length cap keeps short, so it is a folder of its own in the user's temp folder, made again when that folder is gone.
runtime=$(cat "$world/runtime-dir" 2>/dev/null)
if [ ! -d "$runtime" ]; then
  temp=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null) || temp=${TMPDIR:-/tmp}/
  runtime=$(mktemp -d "${temp%/}/pghc.XXXXXX") && printf '%s\n' "$runtime" > "$world/runtime-dir" ||
    { echo "hc-trial: refusing: it cannot make the world's socket folder in $temp" >&2; exit 1; }
fi
# The core a call starts, and every terminal it runs, take this environment, so it holds the shell basics alone, as a herdr pane's does: no token, session or factory variable of the caller's reaches them.
# SSH_CONNECTION starts the core directly, never as a launchd job: herdr-core's macos_launchd.rs reads it (prepare_core, de97ea5).
exec env -i HOME="${HOME:-}" LANG="${LANG:-en_US.UTF-8}" LOGNAME="${LOGNAME:-}" PATH="${PATH:-/usr/bin:/bin}" \
  SHELL="${SHELL:-/bin/bash}" TERM="${TERM:-xterm-256color}" USER="${USER:-}" \
  HC_SESSION=pgtrial SSH_CONNECTION="127.0.0.1 1 127.0.0.1 22" \
  XDG_CONFIG_HOME="$world/config" XDG_RUNTIME_DIR="$runtime" XDG_STATE_HOME="$world/state" \
  "$bin" "$@"
