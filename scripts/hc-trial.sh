#!/bin/bash
# hc's trial world's wrapper: spawn.sh's probe start copies it to <data>/hc-trial/hc, the one path no-raw-spawn lets an hc call run by.
# It runs the world's herdr-core only while it hashes to the pin the world's build wrote, in the world's own folders and session word, with no herdr or hc variable of its caller's.
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
# The core's socket sits in XDG_RUNTIME_DIR, whose path a socket's length cap keeps short, so it is a folder of its own in the user's temp folder, made again when that folder is gone.
runtime=$(cat "$world/runtime-dir" 2>/dev/null)
if [ ! -d "$runtime" ]; then
  temp=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null) || temp=${TMPDIR:-/tmp}/
  runtime=$(mktemp -d "${temp%/}/pghc.XXXXXX") && printf '%s\n' "$runtime" > "$world/runtime-dir" ||
    { echo "hc-trial: refusing: it cannot make the world's socket folder in $temp" >&2; exit 1; }
fi
# SSH_CONNECTION starts the core directly, never as a launchd job: herdr-core's macos_launchd.rs reads it (prepare_core, de97ea5).
exec env -u HERDR_BIN_PATH -u HERDR_PANE_ID -u HERDR_RELEASES_URL -u HERDR_SESSION -u HERDR_SOCKET_PATH \
  -u HC_RUNTIME -u HC_SCOPE -u HC_SOCKET -u HC_SSH -u HC_TERMINAL_ID -u HC_TERMINAL_SOCKET \
  HC_SESSION=pgtrial SSH_CONNECTION="127.0.0.1 1 127.0.0.1 22" \
  XDG_CONFIG_HOME="$world/config" XDG_RUNTIME_DIR="$runtime" XDG_STATE_HOME="$world/state" \
  "$bin" "$@"
