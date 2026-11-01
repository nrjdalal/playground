#!/bin/bash
# setup.sh: makes a clean Ubuntu or Debian VPS the factory's self-hosted Actions runner. Run it as root through
# host.sh setup <ip>, which runs survey.sh first and hands this script the repository as owner/name on argv and a fresh
# registration token on stdin, never on argv.
# Every step checks before it acts, so a second run changes nothing.
set -euo pipefail

[[ "${1:-}" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || { echo "setup.sh: give the repository as owner/name" >&2; exit 2; }
REPO_URL=https://github.com/$1
LABELS=playground
BUN_VERSION=1.4.4
HOME_DIR=/home/runner
# sized from the host itself: a runner per 2 cores and 6 GB, so 4 cores and 16 GB run two PRs' gates at once (dispatcher, 18 Oct)
CORES=$(nproc)
RAM_GB=$(awk '/^MemTotal:/ {print int($2 / 1048576)}' /proc/meminfo)
RUNNERS=$((CORES / 2 < RAM_GB / 6 ? CORES / 2 : RAM_GB / 6))
[ "$RUNNERS" -ge 1 ] || RUNNERS=1
SWAP=$([ "$RAM_GB" -ge 8 ] && echo 2G || echo 4G)

say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { say "setup.sh: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run it as root"
. /etc/os-release
case "${ID:-}" in ubuntu | debian) ;; *) die "only Ubuntu or Debian, not ${ID:-unknown}" ;; esac
# the token is read before anything changes, so a missing one stops the run with nothing done
TOKEN=""
read -r TOKEN || true
registered=1
for i in $(seq 1 "$RUNNERS"); do [ -f "$HOME_DIR/runner-$i/.runner" ] || registered=0; done
[ -n "$TOKEN" ] || [ "$registered" = 1 ] || die "no registration token on stdin"
say "sizing: $CORES cores and $RAM_GB GB give $RUNNERS runners and $SWAP of swap"

export DEBIAN_FRONTEND=noninteractive
say "packages"
apt-get update -q
apt-get install -yq ca-certificates curl docker.io git golang-go jq ruby tar ufw unattended-upgrades unzip zsh

say "swap"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -e /swapfile ] || { fallocate -l "$SWAP" /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

say "the runner user"
id runner > /dev/null 2>&1 || useradd -m -s /bin/bash runner
# a name, so git has an identity where a test gives it none, as a Mac's account has
usermod -c "playground ci" runner
usermod -aG docker runner
for g in sudo admin wheel; do gpasswd -d runner "$g" > /dev/null 2>&1 || true; done
rm -f /etc/sudoers.d/runner
systemctl enable --now docker

say "bun $BUN_VERSION"
[ "$(su - runner -c '~/.bun/bin/bun --version' 2>/dev/null)" = "$BUN_VERSION" ] ||
  su - runner -c "curl -fsSL https://bun.sh/install | bash -s bun-v$BUN_VERSION"
# node is bun, as `bun run` makes it for a script, so a tool whose shebang asks for node (turbo) runs outside a script too
su - runner -c 'mkdir -p ~/.local/bin && ln -sfn ~/.bun/bin/bun ~/.local/bin/node'
# uv runs test:skills' Python steps under 3.13, as local CI does on the Mac
say "uv"
su - runner -c 'command -v ~/.local/bin/uv > /dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'

say "the actions runners"
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64 | arm64) ARCH=arm64 ;; *) die "no runner for $(uname -m)" ;; esac
VERSION=""
for i in $(seq 1 "$RUNNERS"); do
  DIR=$HOME_DIR/runner-$i
  if [ ! -x "$DIR/config.sh" ]; then
    if [ -z "$VERSION" ]; then
      VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name)
      VERSION=${VERSION#v}
      [ -n "$VERSION" ] && [ "$VERSION" != null ] || die "could not read the runner's latest version"
    fi
    su - runner -c "mkdir -p $DIR && curl -fsSL https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-$ARCH-$VERSION.tar.gz | tar -xz -C $DIR"
    "$DIR/bin/installdependencies.sh"
  fi
  if [ ! -f "$DIR/.runner" ]; then
    # the token goes through a 0600 file the runner user reads into the config's environment, so no process lists it
    (umask 077 && printf '%s' "$TOKEN" > "$HOME_DIR/.runner-token")
    chown runner: "$HOME_DIR/.runner-token"
    su - runner -c "cd $DIR && ACTIONS_RUNNER_INPUT_TOKEN=\$(cat ~/.runner-token) ./config.sh --unattended --url $REPO_URL --labels $LABELS --name \$(hostname)-runner-$i --replace" ||
      { rm -f "$HOME_DIR/.runner-token"; die "runner-$i did not register"; }
    rm -f "$HOME_DIR/.runner-token"
  fi
  # svc.sh install writes the unit's name into .service, so the file says whether it is installed
  [ -f "$DIR/.service" ] || (cd "$DIR" && ./svc.sh install runner)
  systemctl enable --now "$(cat "$DIR/.service")"
done

say "ssh: keys alone"
[ -s /root/.ssh/authorized_keys ] || die "root has no authorized key, so key-only ssh would lock everyone out"
cat > /etc/ssh/sshd_config.d/10-playground.conf << 'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh 2> /dev/null || systemctl reload sshd

say "firewall: ssh alone"
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow OpenSSH > /dev/null
ufw --force enable > /dev/null

say "unattended upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

for i in $(seq 1 "$RUNNERS"); do say "runner-$i: $(systemctl is-active "$(cat "$HOME_DIR/runner-$i/.service")")"; done
# what ci.sh's runs need, as the runner user sees it: tools.sh names each one missing and exits 1
bash "$(dirname "$0")/tools.sh" || die "a tool the suite needs is missing"

