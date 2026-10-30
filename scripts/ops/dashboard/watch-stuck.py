#!/usr/bin/env python3
"""Off-loopback Docker watcher: exits (waking ops-dashboard's run.sh) when a running Docker container publishes a port off loopback
(0.0.0.0, [::] or any non-loopback address), once per container and port set.

A stuck session's alert comes from its own session-state hook now (PG-2184, packages/scripts/src/stuck-alert.ts), so this watch no
longer reads sessions or cmux's Feed. Reads only `docker ps`. State (what was already alerted) persists in STATE across re-arms.
On exit it writes the alerts to ALERT and prints them. It never answers or types anything.
"""
import json, os, subprocess, sys, time
from datetime import datetime, timezone

STATE_DIR = os.path.join(os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground")), "ops", "dashboard")
STATE = os.path.join(STATE_DIR, "stuck-state.json")
ALERT = os.path.join(STATE_DIR, "stuck-alert.json")
LOG = os.path.join(STATE_DIR, "stuck-watch.log")
TICK = 60


def now():
    return time.time()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg):
    with open(LOG, "a") as f:
        f.write(f"{iso(now())} {msg}\n")


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(s):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, STATE)


LOOPBACK = {"127.0.0.1", "::1", "[::1]", "localhost"}


def exposed_ports(ports):
    """The published mappings in a `docker ps` Ports cell whose host address is not loopback."""
    out = []
    for m in (ports or "").split(", "):
        if "->" not in m:
            continue
        addr = m.split("->")[0].rsplit(":", 1)[0]
        if addr not in LOOPBACK and not addr.startswith("127."):
            out.append(m)
    return out


def containers():
    try:
        r = subprocess.run(["docker", "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Ports}}"],
                           capture_output=True, text=True, timeout=30)
    except Exception as e:
        log(f"docker ps failed: {e}")
        return None
    if r.returncode != 0:
        log(f"docker ps exited {r.returncode}: {r.stderr.strip()[:200]}")
        return None
    return [line.split("\t") + [""] * (3 - len(line.split("\t"))) for line in r.stdout.splitlines() if line]


def docker_alerts(state):
    rows = containers()
    if rows is None:
        return []
    alerts, seen = [], []
    for cid, name, ports in rows:
        bad = exposed_ports(ports)
        if not bad:
            continue
        key = f"{cid}|{','.join(bad)}"
        seen.append(key)
        if key in state.setdefault("exposed", []):
            continue
        state["exposed"].append(key)
        alerts.append({"kind": "docker", "name": name, "container": cid, "exposed": bad, "ports": ports,
                       "since": iso(now())})
    state["exposed"] = [k for k in state.get("exposed", []) if k in seen]
    return alerts


def owner_gone():
    """ops-dashboard's run.sh, which OPS_DASHBOARD_PID names, has exited: the watch ends with it rather than run on under launchd."""
    try:
        os.kill(int(os.environ["OPS_DASHBOARD_PID"]), 0)
    except (KeyError, ValueError):
        return False
    except ProcessLookupError:
        return True
    except PermissionError:
        pass
    return False


def main():
    log("armed")
    while True:
        if owner_gone():
            log("ops-dashboard's run.sh is gone; exiting")
            sys.exit(3)
        state = load_state()
        alerts = docker_alerts(state)
        save_state(state)
        if alerts:
            with open(ALERT, "w") as f:
                json.dump(alerts, f, indent=1)
            for a in alerts:
                log(f"ALERT {a['kind']} {a['name']} since {a['since']}")
                print(json.dumps(a))
            sys.exit(0)
        time.sleep(TICK)


if __name__ == "__main__":
    main()
