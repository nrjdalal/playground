// The stand-ins a gate box puts first on PATH, so a new user's install runs end to end with no real claude, gh, cmux, brew, launchctl, sudo or GUI call; every call is logged to calls.log, and gh's repos are bare repos under the box's remote folder. docker is the real one, and bunx is real but for pglaunch, whose stand-in starts a container published on loopback alone.

// The suffix the pglaunch stand-in gives its container, 4 letters as pglaunch's own, so the live dashboard's name rule reads it as first run's.
export const GATE_SUFFIX = "gate"

// The label on every container the gate starts, which its clean-up removes by name.
export const GATE_LABEL = "playground-gate=1"

const logged = (box: string, name: string) =>
  `#!/bin/bash\necho "${name} $*" >> "${box}/calls.log"\n`

// Pure: each stand-in's file name and script for a box at box, with bunx execing realBunx for anything but pglaunch.
export const stubs = (box: string, realBunx: string): Record<string, string> => ({
  brew: `${logged(box, "brew")}exit 1\n`,
  bunx: `${logged(box, "bunx")}pg=; name=; prev=
for a in "$@"; do case "$a" in pglaunch@*) pg=1 ;; esac; [ "$prev" = -n ] && name=$a; prev=$a; done
[ -n "$pg" ] || exec "${realBunx}" "$@"
c="$name-${GATE_SUFFIX}"
docker inspect "$c" >/dev/null 2>&1 || docker run -d --name "$c" --label ${GATE_LABEL} -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 postgres:alpine >/dev/null || exit 1
docker start "$c" >/dev/null 2>&1
port=$(docker port "$c" 5432 | head -1 | sed 's/.*://')
echo "name \\"$c :$port\\" started"
echo "postgres://postgres:postgres@localhost:$port/postgres"
`,
  claude: `${logged(box, "claude")}[ "$1 $2" = "auth status" ] && echo '{"loggedIn": true}'\nexit 0\n`,
  cmux: `${logged(box, "cmux")}exit 1\n`,
  gh: `${logged(box, "gh")}case "$1 $2" in
  "api user") echo gate-user ;;
  "auth status") exit 0 ;;
  "pr create") echo "https://github.com/gate-user/extension/pull/1" ;;
  "repo create") git init -q --bare "${box}/remote/$3.git" ;;
  "repo edit") exit 0 ;;
  "repo view") [ -d "${box}/remote/$3.git" ] || exit 1; [ "$4" = --json ] && echo "PRIVATE ${box}/remote/$3.git"; exit 0 ;;
  *) exit 1 ;;
esac
`,
  herdr: `${logged(box, "herdr")}exit 1\n`,
  launchctl: `${logged(box, "launchctl")}exit 1\n`,
  open: `${logged(box, "open")}exit 1\n`,
  osascript: `${logged(box, "osascript")}exit 1\n`,
  sudo: `${logged(box, "sudo")}exit 1\n`,
})
