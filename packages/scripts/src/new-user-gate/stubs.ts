// The stand-ins a gate box puts first on PATH, so a new user's install runs end to end with no real claude, gh, cmux, brew, launchctl, Keychain, sudo or GUI call; every call is logged to calls.log, and gh's repos are bare repos under the box's remote folder. docker is the real one, and bunx is real but for pglaunch, whose stand-in starts a container published on loopback alone.

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
  claude: `${logged(box, "claude")}[ "$1" = setup-token ] && exec bun "${box}/h/playground/api/hono/src/fixtures/setup-token.ts" setup-token
[ "$1 $2" = "auth status" ] && echo '{"loggedIn": true}'
exit 0
`,
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
  // the Keychain as a file in the box, one service, account and secret per line; only the subcommand is logged, never a secret
  security: `#!/bin/bash
echo "security $1" >> "${box}/calls.log"
store="${box}/keychain"
touch "$store"
handle() {
  local sub=$1 svc= acct= secret= want= line
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      -s) svc=$2; shift 2 ;;
      -a) acct=$2; shift 2 ;;
      -w) if [ $# -gt 1 ] && [ "\${2#-}" = "$2" ]; then secret=$2; shift 2; else want=1; shift; fi ;;
      *) shift ;;
    esac
  done
  case "$sub" in
    add-generic-password) { grep -v "^$svc\t$acct\t" "$store"; printf '%s\t%s\t%s\n' "$svc" "$acct" "$secret"; } > "$store.new"; mv "$store.new" "$store" ;;
    delete-generic-password) grep -v "^$svc\t$acct\t" "$store" > "$store.new"; mv "$store.new" "$store" ;;
    find-generic-password)
      line=$(grep "^$svc\t\${acct:+$acct\t}" "$store" | head -1)
      [ -n "$line" ] || return 44
      [ -n "$want" ] && printf '%s\n' "\${line##*$'\t'}"
      return 0 ;;
    *) return 1 ;;
  esac
}
if [ "$1" = -i ]; then
  while IFS= read -r command; do eval "set -- $command"; handle "$@" || exit $?; done
  exit 0
fi
handle "$@"
`,
  sudo: `${logged(box, "sudo")}exit 1\n`,
})
