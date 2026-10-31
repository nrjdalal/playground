#!/bin/bash
# host.sh: drives the self-hosted runner's VPS from this Mac, as root over ssh with ~/.ssh/playground_runner.
#   host.sh survey <ip>   reads the host and changes nothing (survey.sh); exits 3 when something live runs there, 4 when it cannot read
#   host.sh setup <ip>    surveys again, then runs setup.sh for factory.repo with a fresh registration token on its stdin
#   host.sh status <ip>   the runner service's state, what the suite needs there (tools.sh) and GitHub's view of the runner
#   host.sh drift [ref]   whether the live ci.sh and suite.sh every caller runs match <ref>'s (origin/canary); exits 1 when one differs
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# the repository the runner serves: factory.repo as the settings reader in this checkout prints it, the checkout's origin when unset
repo() {
  REPO=$("$(command -v bun || echo "$HOME/.bun/bin/bun")" "$HERE/../../../packages/scripts/src/playground/setting.ts" factory.repo </dev/null | tr -d '"')
  [ -n "$REPO" ] || { echo "host.sh: no factory.repo and no origin to read the repository from" >&2; exit 2; }
}
KEY=${RUNNER_HOST_KEY:-$HOME/.ssh/playground_runner}

usage() { sed -n '2,/^[^#]/{/^#/p;}' "$0" >&2; exit 2; }
if [ "${1:-}" = drift ] && [ $# -le 2 ]; then
  LIVE=${PLAYGROUND_DATA_DIR:-$HOME/.playground}/ops/runner-host
  differs=0
  for f in ci.sh suite.sh; do
    if git -C "$HERE" show "${2:-origin/canary}:scripts/ops/runner-host/$f" | cmp -s - "$LIVE/$f"; then
      echo "same $f"
    else
      echo "differs $f: copy it to a dot-file in $LIVE, then mv it over $f"
      differs=1
    fi
  done
  exit "$differs"
fi
[ $# -eq 2 ] || usage
CMD=$1 IP=$2
[[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "host.sh: $IP is not an IPv4 address" >&2; exit 2; }
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes "root@$IP")

case "$CMD" in
  survey) "${SSH[@]}" bash -s < "$HERE/survey.sh" ;;
  setup)
    repo
    "${SSH[@]}" bash -s < "$HERE/survey.sh" || { echo "host.sh: the survey did not come back clean, so setup stops" >&2; exit 3; }
    "${SSH[@]}" 'mkdir -p /root/playground-runner && cat > /root/playground-runner/setup.sh' < "$HERE/setup.sh"
    "${SSH[@]}" 'cat > /root/playground-runner/tools.sh' < "$HERE/tools.sh"
    # the token goes from gh's stdout to the remote script's stdin, so it is on no argv here or there
    gh api -X POST "repos/$REPO/actions/runners/registration-token" -q .token | "${SSH[@]}" bash /root/playground-runner/setup.sh "$REPO"
    ;;
  status)
    repo
    "${SSH[@]}" 'systemctl --no-pager --lines=0 status "actions.runner.*"' || true
    "${SSH[@]}" bash -s < "$HERE/tools.sh" || true
    gh api "repos/$REPO/actions/runners" -q '.runners[] | "\(.name) \(.status) busy=\(.busy) labels=\([.labels[].name] | join(","))"'
    ;;
  *) usage ;;
esac
