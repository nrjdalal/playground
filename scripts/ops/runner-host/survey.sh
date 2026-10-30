#!/bin/bash
# survey.sh: reads a fresh VPS before setup.sh touches it, and changes nothing. Run it as root over ssh: host.sh survey <ip>.
# It prints the OS, RAM, disk, listening ports, services and Docker containers, then exits 3 when anything live runs there: a
# listener off loopback other than ssh, or a running container, and 4 when it cannot read the listeners or the containers. Setup goes
# ahead only on exit 0.
set -u
unread=""

section() { printf '\n== %s\n' "$1"; }

section os
if [ -r /etc/os-release ]; then . /etc/os-release && echo "${PRETTY_NAME:-unknown}"; else echo unknown; fi
uname -srm

section size
echo "cores $(nproc 2>/dev/null || echo unknown)"
echo "ram_mb $(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null)"

section memory
free -m 2>/dev/null || echo "free: not found"
swapon --show 2>/dev/null

section disk
df -h / 2>/dev/null

section listeners
if listeners=$(ss -Hltnu 2>/dev/null); then echo "${listeners:-none}"; else echo "ss: cannot read"; unread="the listeners (ss)"; fi

section services
systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1}'

section containers
containers=""
if command -v docker >/dev/null 2>&1; then
  if containers=$(docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null); then
    echo "${containers:-none}"
  else
    echo "docker ps: failed"
    unread="${unread:+$unread and }the containers (docker ps)"
  fi
else
  echo "docker: not installed"
fi

# A listener is live when its local address is off loopback and it is not ssh's or a DHCP client's (udp 68, 546).
live=$(printf '%s\n' "$listeners" | awk 'NF >= 5 {
  addr = $5; port = addr; sub(/.*:/, "", port); host = addr; sub(/:[^:]*$/, "", host); gsub(/[][]/, "", host); sub(/%.*/, "", host)
  if (port == "22" || ($1 == "udp" && (port == "68" || port == "546")) || host ~ /^127\./ || host == "::1") next
  print $1 " " addr
}')

section verdict
if [ -n "$live" ] || [ -n "$containers" ]; then
  [ -n "$live" ] && printf '%s\n' "$live" | sed 's/^/live listener: /'
  [ -n "$containers" ] && printf '%s\n' "$containers" | sed 's/^/running container: /'
  echo "live: something runs here, so setup.sh stops"
  exit 3
fi
if [ -n "$unread" ]; then
  echo "unread: could not read $unread, so setup.sh stops"
  exit 4
fi
echo "clean: nothing but ssh listens off loopback, and no container runs"
