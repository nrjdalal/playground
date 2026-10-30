#!/usr/bin/env python3
"""beat.py <job> <pid> <startedAt> <cycleSeconds> <lastResult> [extra JSON]: write the job's heartbeat, ops/<job>.json, atomically.
Imported, it also holds checkout(), the one place the ops scripts name the main checkout.

The dashboard reads it: Running while lastResult is "ok" and lastBeatAt is fresh, Failing when lastResult is anything else,
Down when lastBeatAt is older than 3 x cycleSeconds, the pid is gone or the file is missing.
"""
import json, os, shutil, subprocess, sys, time

RESOLVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "packages", "env", "src", "data-dir.ts")


def ops_dir():
    """The data folder's ops, as dataDir() in packages/env/src/data-dir.ts resolves it, so the TS jobs and these scripts read one folder; the same rule in Python when bun cannot answer."""
    bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
    try:
        r = subprocess.run([bun, "--no-env-file", "-e", f"import {{ dataDir }} from {json.dumps(RESOLVER)}; console.log(dataDir())"], capture_output=True, text=True, timeout=30, cwd="/")
        if r.returncode == 0 and r.stdout.strip():
            return os.path.join(r.stdout.strip(), "ops")
    except Exception:
        pass
    return os.path.join(os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground")), "ops")


OPS = ops_dir()


def checkout():
    """The factory's main checkout: PLAYGROUND_REPO, else the main checkout of the folder the job runs in, else that of the checkout this file sits in, else playground in the code root's default (the folder that holds that checkout)."""
    if os.environ.get("PLAYGROUND_REPO"):
        return os.environ["PLAYGROUND_REPO"]
    own = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
    for folder in (None, own):
        r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True, cwd=folder)
        root = os.path.dirname(r.stdout.strip()) if r.returncode == 0 else folder
        if root and os.path.exists(os.path.join(root, "scripts", "spawn.sh")):
            return root
    return os.path.join(os.path.dirname(own), "playground")


def beat(job, pid, started_at, cycle_seconds, last_result, extra=None):
    path = os.path.join(OPS, f"{job}.json")
    data = {"job": job, "pid": int(pid), "startedAt": started_at, "lastBeatAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "lastResult": (last_result or "ok")[:120], "cycleSeconds": int(cycle_seconds)}
    if extra:
        data.update(json.loads(extra) if isinstance(extra, str) else extra)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
        f.write("\n")
    os.replace(tmp, path)


def setting(key):
    """A setting's value as the settings reader in the factory's checkout prints it (packages/scripts/src/playground/setting.ts), its default on a machine with no extensions; stops naming why when the reader cannot answer."""
    bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
    r = subprocess.run([bun, os.path.join(checkout(), "packages", "scripts", "src", "playground", "setting.ts"), key], capture_output=True, text=True, timeout=60, cwd="/")
    if r.returncode != 0:
        raise SystemExit(f"{key}: {r.stderr.strip() or f'exit {r.returncode}'}")
    return json.loads(r.stdout)


if __name__ == "__main__":
    beat(*sys.argv[1:7])
