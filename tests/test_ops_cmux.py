#!/usr/bin/env python3
"""scripts/ops after the 13 Oct cmux restarts (#542): the dashboard follows cmux.

- up.py counts a cmux job healthy only under the running cmux app: a job a restart left under launchd is not (fake process tables).
- ops-dashboard's run.sh and supervisor.sh stop their recorded process groups on SIGHUP and once their parent is gone, and nothing else: each
  runs on scratch state with stub git, bun, curl, docker, cmux and claude, so its stack is a few sleeps this test starts, never the dashboard.
  Started from the repo's copy, run.sh execs the checkout's own once at its first start (#1330), so the scratch checkout holds a copy of scripts/ops.
- supervisor.sh answers a roll-now with nothing to roll to (`playground update`) with CURRENT, or SKIP for a head in bad-builds, and removes it.

No real cmux restart happens here. Run: python3 tests/test_ops_cmux.py
"""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPS = os.path.join(ROOT, "scripts", "ops")
CMUX = "/Applications/cmux.app/Contents/MacOS/cmux"
failures = []
lock = threading.Lock()


def check(ok, name, detail=""):
    with lock:
        print(f"{'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failures.append(name)
            if detail:
                print(f"     {detail}")


def seed_names(config):
    """The managers' old names as sessions.aliases in config's data folder, as a machine past the switch holds them."""
    seed = "const [helper, names, data] = process.argv.slice(-3); (await import(helper)).storeWith(data, {}, { 'sessions.aliases': (await import(names)).OLD_NAMES })"
    subprocess.run([shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun"), "--no-env-file", "-e", seed, os.path.join(ROOT, "tests", "scripts", "hooks", "render-set.ts"),
                    os.path.join(ROOT, "tests", "session-names.ts"), os.path.join(config, "playground")], check=True)


def load(name, path, config):
    os.environ["CLAUDE_CONFIG_DIR"] = config
    os.environ["PLAYGROUND_DATA_DIR"] = os.path.join(config, "playground")
    os.environ["XDG_CONFIG_HOME"] = os.path.join(config, "xdg")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cfg(scratch):
    config = os.path.join(scratch, "cfg")
    ops = os.path.join(config, "playground", "ops")
    os.makedirs(os.path.dirname(ops))
    home = os.path.expanduser("~/.claude")
    os.environ.pop("INSCOPE_CCD", None)
    up = load("up_cfg", os.path.join(OPS, "up.py"), config)
    check(up.CFG == config, "up: without the inscope signal, CFG reads CLAUDE_CONFIG_DIR", up.CFG)
    check(up.REGISTRY == config, "up: without the inscope signal, the registry reads CLAUDE_CONFIG_DIR", up.REGISTRY)
    os.environ["INSCOPE_CCD"] = config
    up_inscope = load("up_cfg_inscope", os.path.join(OPS, "up.py"), config)
    check(up_inscope.REGISTRY == home, "up: under the inscope signal, the registry reads ~/.claude, where spawn.sh registers sessions", up_inscope.REGISTRY)
    check(up_inscope.CFG == config and up_inscope.OPS == ops, "up: under the inscope signal, CFG stays on CLAUDE_CONFIG_DIR and OPS on the data folder, where the heartbeats are written", f"{up_inscope.CFG} {up_inscope.OPS}")
    os.environ["INSCOPE_CCD"] = ""
    up_empty = load("up_cfg_empty", os.path.join(OPS, "up.py"), config)
    check(up_empty.REGISTRY == config, "up: an empty INSCOPE_CCD is no signal, like spawn.sh's -n", up_empty.REGISTRY)
    os.environ.pop("INSCOPE_CCD")
    hook = os.path.join(config, "xdg", "inscope")
    os.makedirs(hook)
    with open(os.path.join(hook, "inscope.zsh"), "w") as f:
        f.write("# inscope exports CLAUDE_CONFIG_DIR for its sessions\n")
    up_hook = load("up_cfg_hook", os.path.join(OPS, "up.py"), config)
    check(up_hook.REGISTRY == home, "up: an inscope hook naming the vars reads ~/.claude too", up_hook.REGISTRY)


def test_up(scratch):
    config = os.path.join(scratch, "up")
    state = os.path.join(config, "playground", "ops")
    os.makedirs(state)
    up = load("up", os.path.join(OPS, "up.py"), config)
    me = os.getpid()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(os.path.join(state, "ops-x.json"), "w") as f:
        json.dump({"job": "ops-x", "pid": me, "startedAt": now, "lastBeatAt": now, "lastResult": "ok", "cycleSeconds": 60}, f)
    job = {"name": "ops-x", "heartbeat": "ops-x", "needsCmux": True, "runtime": "cmux"}
    under = {me: (400, "/bin/bash"), 400: (300, "/bin/zsh"), 300: (100, "/usr/bin/login"), 100: (1, CMUX), 1: (0, "/sbin/launchd")}
    check(up.healthy(job, under, 100) == (True, "ok"), "up: a job whose ancestry reaches the running cmux is healthy")
    orphan = {me: (1, "/bin/bash"), 200: (1, CMUX), 1: (0, "/sbin/launchd")}
    ok, why = up.healthy(job, orphan, 200)
    check(not ok and "not under the running cmux" in why, "up: a job left under launchd by a cmux restart is unhealthy", why)
    other = {me: (100, "/bin/bash"), 100: (1, CMUX), 200: (1, CMUX), 1: (0, "/sbin/launchd")}
    check(not up.healthy(job, other, 200)[0], "up: a job under another cmux app is unhealthy")
    cli = {me: (100, "/Applications/cmux.app/Contents/Resources/bin/cmux"), 100: (1, "/bin/zsh"), 200: (1, CMUX)}
    check(not up.healthy(job, cli, 200)[0], "up: the cmux CLI above a job does not count as the cmux app")
    check(up.healthy({**job, "needsCmux": False}, orphan, 200)[0], "up: a launchd job is judged by its heartbeat alone")


def test_key(scratch):
    config = os.path.join(scratch, "key")
    os.makedirs(config)
    up = load("up_key", os.path.join(OPS, "up.py"), config)
    ops = os.path.expanduser("~/.playground/ops/sweep/sweep.py")
    check(up.key_of({"command": "python3 -I ~/.playground/ops/sweep/sweep.py no-headroom"}) == ops, "up: a job keys by its path under /ops/", up.key_of({"command": f"python3 -I {ops} no-headroom"}))
    folder = os.path.join(scratch, "key", "packages", "scripts", "src", "ops-sweep")
    os.makedirs(folder)
    open(os.path.join(folder, "cli.ts"), "w").close()
    key = up.key_of({"command": f"bun --no-env-file {folder}/cli.ts no-headroom"})
    check(key == "/src/ops-sweep/", "up: a Bun job with no word under /ops/ keys by its script's folder (its last two names), never by bun, which every Ops title could hold", key)
    missing = up.key_of({"command": f"bun --no-env-file {scratch}/absent/packages/scripts/src/ops-sweep/cli.ts no-headroom"})
    check(missing == "/src/ops-sweep/", "up: a Bun job whose script is not on disk yet still keys by its folder, never by bun", missing)
    absolute = up.key_of({"command": f"{os.path.expanduser('~/.bun/bin/bun')} {folder}/cli.ts"})
    check(absolute == "/src/ops-sweep/", "up: a Bun job that names bun by its absolute path still keys by its script's folder", absolute)


def test_unguarded(scratch):
    config = os.path.join(scratch, "unguarded")
    os.makedirs(os.path.join(config, "sessions"))
    seed_names(config)
    up = load("up_unguarded", os.path.join(OPS, "up.py"), config)
    factory = os.path.join(scratch, "factory.json")
    cmux_only = os.path.join(scratch, "cmux.json")
    with open(factory, "w") as f:
        f.write('{"hooks": "scripts/hooks/no-playground-leak.ts"}')
    with open(cmux_only, "w") as f:
        f.write('{"hooks": "cmux notify"}')

    def checkout(name, settings):
        root = os.path.join(scratch, name)
        os.makedirs(os.path.join(root, ".claude"))
        os.makedirs(os.path.join(root, "web"))
        with open(os.path.join(root, ".git"), "w") as f:
            f.write("gitdir: elsewhere\n")
        with open(os.path.join(root, ".claude", "settings.json"), "w") as f:
            f.write(settings)
        return root

    fresh = checkout("fresh", '{"hooks": "scripts/hooks/no-playground-leak.ts"}')
    old = checkout("old", '{"hooks": "scripts/hooks/no-release-comment.ts"}')
    outside = os.path.join(scratch, "acme-labs", "repo")
    os.makedirs(outside)
    procs = [subprocess.Popen(["sleep", "1000"], start_new_session=True) for _ in range(9)]
    # a manager respawned under a new name is placed by its roster kind
    os.makedirs(os.path.join(config, "playground"), exist_ok=True)
    with open(os.path.join(config, "playground", "roster.json"), "w") as f:
        json.dump({"agents": [{"kind": "builder", "name": "x7mh4d-builder"}]}, f)
    try:
        rows = [
            ("worker-outside", procs[0].pid, outside, f"/Users/x/.bun/bin/claude --resume s1 --settings {cmux_only}"),
            ("builder", procs[1].pid, old, f"claude --resume s2 --settings {cmux_only}"),
            ("worker-spawned", procs[2].pid, outside, f"claude -n worker-spawned --settings {factory}"),
            ("ops", procs[3].pid, os.path.join(fresh, "web"), f"claude --resume s4 --settings {cmux_only}"),
            ("planner", procs[5].pid, fresh, f"claude --resume s7 --settings {cmux_only}"),
            ("worker-stale", procs[6].pid, outside, "sleep 1000"),
            ("worker-reader", procs[7].pid, outside, "less /usr/local/bin/claude"),
            ("notes", procs[4].pid, outside, "claude --resume s5"),
            ("worker-gone", 999999, outside, "claude --resume s6"),
            ("x7mh4d-builder", procs[8].pid, old, f"claude --resume s8 --settings {cmux_only}"),
        ]
        commands = {}
        for name, pid, cwd, command in rows:
            commands[pid] = command
            with open(os.path.join(config, "sessions", f"{name}.json"), "w") as f:
                json.dump({"cwd": cwd, "name": name, "pid": pid}, f)
        found = sorted(up.unguarded(command_of=commands.get))
        want = sorted([("ops", procs[3].pid, os.path.join(fresh, "web")), ("builder", procs[1].pid, old), ("worker-outside", procs[0].pid, outside),
                       ("x7mh4d-builder", procs[8].pid, old)])
        check(found == want, "up: --sessions names a factory session whose own folder's project settings lack the hooks (outside dispatcher, an older checkout, a subfolder), and only those, not a stale file whose pid runs another command", found)
        check(up.in_factory(["dispatcher", "dispatcher-2", "dispatcher-3", "ops", "optimizer", "tester-x", "worker-", "k3m9px-worker", "kemapx-worker"]) == ["dispatcher", "dispatcher-2", "ops", "optimizer", "tester-x", "k3m9px-worker"],
              "up: in_factory places the names factoryRoleOf (kinds.ts) does, dispatcher-2, the optimizer and an <id>-<kind> name included")
    finally:
        for proc in procs:
            proc.kill()
            proc.wait()


STUBS = {
    "bun": """#!/bin/bash
case "$*" in
  "run dev --ui stream") sleep 1000 & sleep 1000 & wait ;;
  "run ingest --follow") echo "$(date -u +%Y-%m-%dT%H:%M:%S).000Z following"; exec sleep 1000 ;;
  "run ingest status") echo "follower: running"; echo "transcripts read: 0"; echo "entries: 0" ;;
  "run verify "*) echo "ok" ;;
  *"setting.ts --text live.branch") echo "live/dashboard" ;;
  *) exit 1 ;;
esac
""",
    "git": """#!/bin/bash
[ -n "$STUB_GIT_LOG" ] && echo "$*" >> "$STUB_GIT_LOG"
while [ "$1" = -c ]; do shift 2; done
[ "$1" = symbolic-ref ] && { echo "${STUB_BRANCH:-live/dashboard}"; exit 0; }
case "$1 $2" in
  "merge-base --is-ancestor") exit 1 ;;
  "rev-parse --short") echo 0000000 ;;
  "rev-parse HEAD") echo 0000000000000000000000000000000000000000 ;;
  "ls-remote origin") printf '%s\trefs/heads/canary\n' "${STUB_CANARY:-0000000000000000000000000000000000000000}" ;;
esac
exit 0
""",
    "curl": "#!/bin/bash\necho '{\"version\":\"test\"}'\n",
    "docker": "#!/bin/bash\necho 0\n",
    "cmux": "#!/bin/bash\nexit 1\n",
    "claude": "#!/bin/bash\nexit 1\n",
}


def recorded(state):
    """{pid: pgid} of the stack's processes procs.sh recorded."""
    found = {}
    for job in ("dashboard-dev", "dashboard-ingest"):
        try:
            for line in open(os.path.join(state, f"{job}.procs")):
                pid, pgid = line.split()[:2]
                found[int(pid)] = int(pgid)
        except OSError:
            pass
    return found


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(out) and not out.startswith("Z")


def wait_for(cond, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.5)
    return cond()


def stub_env(scratch, name):
    """A scratch config, checkout and stub bin for one run, and the environment that points at them."""
    config = os.path.join(scratch, name)
    checkout = os.path.join(scratch, name + "-checkout")
    bin_dir = os.path.join(scratch, name + "-bin")
    for d in (os.path.join(config, "playground", "ops", "dashboard"), checkout, bin_dir):
        os.makedirs(d)
    for stub, body in STUBS.items():
        path = os.path.join(bin_dir, stub)
        with open(path, "w") as f:
            f.write(body)
        os.chmod(path, 0o755)
    # the checkout's own scripts/ops, which run.sh started from the repo's copy execs into on its first start
    shutil.copytree(OPS, os.path.join(checkout, "scripts", "ops"), ignore=shutil.ignore_patterns("__pycache__"))
    return config, checkout, {**os.environ, "CLAUDE_CONFIG_DIR": config, "PLAYGROUND_DATA_DIR": os.path.join(config, "playground"), "PATH": f"{bin_dir}:{os.environ['PATH']}"}


def test_resume(scratch):
    config = os.path.join(scratch, "resume")
    os.makedirs(os.path.join(config, "playground"))
    os.makedirs(os.path.join(config, "projects", "p"))
    up = load("up_resume", os.path.join(OPS, "up.py"), config)
    with open(os.path.join(config, "playground", "roster.json"), "w") as f:
        json.dump({"agents": [{"name": n, "role": "worker", "status": "working", "task": "t"} for n in ("worker-claude", "worker-flash", "worker-back")]}, f)
    root = os.path.dirname(os.path.dirname(OPS))
    turns = {
        "s-claude": ("worker-claude", ["claude-opus-5-5"], root),
        "s-flash": ("worker-flash", ["claude-opus-5-5", "glm-5.3-flash[1m]"], "/n"),
        "s-back": ("worker-back", ["glm-5.3-flash[1m]", "claude-opus-5-5"], os.path.join(scratch, "no-checkout")),
    }
    os.makedirs(os.path.join(scratch, "no-checkout"))
    for sid, (name, models, cwd) in turns.items():
        with open(os.path.join(config, "projects", "p", f"{sid}.jsonl"), "w") as f:
            f.write(json.dumps({"agentName": name, "cwd": cwd}, separators=(",", ":")) + "\n")
            for m in models:
                f.write(json.dumps({"message": {"model": m}}, separators=(",", ":")) + "\n")
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        up.sessions()
    printed = out.getvalue().splitlines()
    lines = {l.split()[2]: l for l in printed if " resume " in l}
    check(lines.get("worker-flash", "").endswith("s-flash --backend glm"), "up: --sessions resumes a session whose newest turn ran on GLM with --backend glm", lines.get("worker-flash"))
    check(lines.get("worker-claude", "").endswith("s-claude --backend claude") and lines.get("worker-back", "").endswith("s-back --backend claude"), "up: --sessions resumes a session whose newest turn ran on Claude with --backend claude while no pin stands", lines)
    here = lines.get("worker-claude", "").split()
    main = os.path.dirname(subprocess.run(["git", "-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True).stdout.strip())
    check(len(here) > 3 and here[3] == main, "up: --sessions resumes a worktree session in its repo's main worktree, the checkout Claude Code starts sessions in, not the worktree the trust dialog stops a session in", lines.get("worker-claude"))
    gone = lines.get("worker-flash", "").split()
    check(len(gone) > 3 and gone[3] == "/n" and any(l.strip().startswith("(") and "/n" in l for l in printed), "up: --sessions falls back to a gone cwd, named in its output, since no checkout root can be found for it", lines.get("worker-flash"))
    other = lines.get("worker-back", "").split()
    check(len(other) > 3 and other[3] == os.path.join(scratch, "no-checkout"), "up: --sessions keeps the cwd of a session outside any checkout, so its resume stays where it worked", lines.get("worker-back"))
    os.makedirs(os.path.join(config, "playground", "backends"))
    with open(os.path.join(config, "playground", "backends", "worker-flash"), "w") as f:
        f.write("glm")
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        up.sessions()
    lines = {l.split()[2]: l for l in out.getvalue().splitlines() if " resume " in l}
    check(lines.get("worker-flash", "").endswith("s-flash"), "up: --sessions gives a pinned session no --backend, since the pin decides and a flag is refused", lines.get("worker-flash"))


def test_resume_registry(scratch):
    config = os.path.join(scratch, "resume-reg")
    os.makedirs(os.path.join(config, "playground"))
    registry = os.path.join(scratch, "registry")
    os.makedirs(os.path.join(registry, "projects", "p"))
    # the roster lives in spawn.sh's data folder, named here since the registry is patched in after up.py has read its own
    os.environ["INSCOPE_CCD"] = config
    os.environ["PLAYGROUND_DATA_DIR"] = os.path.join(registry, "playground")
    up = load("up_resume_reg", os.path.join(OPS, "up.py"), config)
    os.environ.pop("INSCOPE_CCD")
    os.environ.pop("PLAYGROUND_DATA_DIR")
    up.REGISTRY = registry
    with open(os.path.join(up.DATA, "roster.json"), "w") as f:
        json.dump({"agents": [{"name": "worker-reg", "role": "worker", "status": "working", "task": "t"}]}, f)
    with open(os.path.join(registry, "projects", "p", "s-reg.jsonl"), "w") as f:
        f.write(json.dumps({"agentName": "worker-reg", "cwd": "/w"}, separators=(",", ":")) + "\n")
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        up.sessions()
    lines = {l.split()[2]: l for l in out.getvalue().splitlines() if " resume " in l}
    check("worker-reg" in lines, "up: --sessions reads the transcripts under the registry, where the inscope sessions write them", out.getvalue())


def test_resume_paused(scratch):
    config = os.path.join(scratch, "resume-paused")
    os.makedirs(os.path.join(config, "playground"))
    os.makedirs(os.path.join(config, "projects", "p"))
    up = load("up_resume_paused", os.path.join(OPS, "up.py"), config)
    with open(os.path.join(config, "playground", "roster.json"), "w") as f:
        json.dump({"agents": [
            {"name": "worker-parked", "role": "worker", "status": "paused", "task": "t"},
            {"name": "worker-down", "role": "worker", "status": "working", "task": "t"},
        ]}, f)
    for sid, name in (("s-parked", "worker-parked"), ("s-down", "worker-down")):
        with open(os.path.join(config, "projects", "p", f"{sid}.jsonl"), "w") as f:
            f.write(json.dumps({"agentName": name, "cwd": "/w"}, separators=(",", ":")) + "\n")
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        up.sessions()
    lines = {l.split()[2]: l for l in out.getvalue().splitlines() if " resume " in l}
    check("worker-parked" not in lines, "up: --sessions holds a paused agent out of the resume list")
    check(lines.get("worker-down", "").endswith("s-down --backend claude"), "up: --sessions still lists a down working agent for resume", lines.get("worker-down"))


def test_branch_guard(scratch):
    config, checkout, env = stub_env(scratch, "guard")
    log = os.path.join(scratch, "guard-git.log")
    env = {**env, "STUB_BRANCH": "feature", "STUB_GIT_LOG": log}
    for script in ("supervisor.sh", "redeploy-pull.sh"):
        r = subprocess.run(["bash", os.path.join(OPS, "dashboard", script), "abc123"], cwd=checkout, env=env, capture_output=True, text=True, timeout=30)
        ran = open(log).read() if os.path.exists(log) else ""
        check(r.returncode == 1 and "refusing" in r.stderr and "reset" not in ran and "fetch" not in ran,
              f"dashboard: {script} refuses a checkout off live/dashboard and resets nothing", f"{r.returncode} {r.stderr.strip()} | git ran: {ran!r}")


def test_up_orphan(scratch):
    config = os.path.join(scratch, "up-orphan")
    state = os.path.join(config, "playground", "ops")
    os.makedirs(state)
    up = load("up_orphan", os.path.join(OPS, "up.py"), config)
    # the orphan is no child of this test, as a real one is not of up.py, so launchd reaps it rather than leaving a zombie up.py reads as alive
    orphan = int(subprocess.run(["bash", "-c", "sleep 1000 > /dev/null 2>&1 & echo $!"], capture_output=True, text=True).stdout)
    kept = subprocess.Popen(["sleep", "1000"], start_new_session=True)
    late = subprocess.Popen(["sleep", "1000"], start_new_session=True)
    fresh = subprocess.Popen(["sleep", "1000"], start_new_session=True)
    daemon = subprocess.Popen(["sleep", "1000"], start_new_session=True)
    try:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        jobs = []
        for name, pid in (("ops-orphan", orphan), ("ops-kept", kept.pid), ("ops-late", late.pid)):
            with open(os.path.join(state, f"{name}.json"), "w") as f:
                json.dump({"job": name, "pid": pid, "startedAt": now, "lastBeatAt": now, "lastResult": "ok", "cycleSeconds": 60}, f)
            jobs.append({"name": name, "heartbeat": name, "needsCmux": True, "runtime": "cmux", "command": f"python3 /x/{name}/run.py", "cwd": "/x"})
        # ops-fresh was restarted during the pass: once.py has recorded its pid, but it has written no heartbeat yet
        jobs.append({"name": "ops-fresh", "heartbeat": "ops-fresh", "needsCmux": True, "runtime": "cmux", "command": "python3 /x/ops-fresh/run.py", "cwd": "/x"})
        # ops-daemon is a launchd job with no heartbeat: launchd started its holder, so up.py only reports it
        jobs.append({"name": "ops-daemon", "heartbeat": "ops-daemon", "launchd": "com.x.daemon", "command": "python3 /x/ops-daemon/run.py", "cwd": "/x"})
        with open(os.path.join(state, "jobs.json"), "w") as f:
            json.dump({"jobs": jobs}, f)
        me = os.getpid()
        procs = {me: (100, "/bin/bash"), 100: (1, CMUX), orphan: (1, "/bin/sleep"), kept.pid: (100, "/bin/bash"), daemon.pid: (1, "/bin/sleep"), 1: (0, "/sbin/launchd")}
        # ops-late's holder started after the snapshot was read, so the table lacks it
        holders = {"ops-orphan": orphan, "ops-kept": kept.pid, "ops-late": late.pid, "ops-fresh": fresh.pid, "ops-daemon": daemon.pid}
        started = []
        up.ptable.table = lambda: procs
        up.once.running = lambda name, marker: holders[name]
        up.workspaces = lambda: {}
        up.start = lambda job, existing: started.append(job["name"])
        up.up(True)
        check(not alive(orphan), "up: a holder outside the running cmux is stopped")
        check(started == ["ops-orphan"], "up: that job is started again, and the one under cmux is left alone", repr(started))
        check(kept.poll() is None, "up: the holder under the running cmux still runs")
        check(late.poll() is None, "up: a holder the process snapshot lacks is left running")
        check(fresh.poll() is None, "up: a holder the snapshot lacks, with no heartbeat yet, is left running")
        check(daemon.poll() is None, "up: a launchd job's holder outside cmux is only reported, never stopped")
    finally:
        if alive(orphan):
            os.kill(orphan, signal.SIGKILL)
        for proc in (kept, late, fresh, daemon):
            proc.kill()
            proc.wait()


HERDR_STUB = r"""#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args == ["--version"]:
    print("herdr 0.9.5")
    sys.exit(0)
if args == ["status", "server", "--json"]:
    print(json.dumps({"running": not os.environ.get("STUB_HERDR_DOWN")}))
    sys.exit(0)
path = os.environ["STUB_HERDR_STATE"]
st = json.load(open(path)) if os.path.exists(path) else {"workspaces": [], "panes": [], "calls": []}
failed = False
st["calls"].append({"args": args, "socket": os.environ.get("HERDR_SOCKET_PATH"), "session": os.environ.get("HERDR_SESSION")})
out = {}
if args[:2] == ["workspace", "list"]:
    out = {"workspaces": st["workspaces"]}
elif args[:2] == ["pane", "list"]:
    ws = args[args.index("--workspace") + 1] if "--workspace" in args else None
    out = {"panes": [p for p in st["panes"] if ws in (None, p["workspace_id"])]}
elif args[:2] == ["workspace", "create"]:
    ws = f"w{len(st['workspaces']) + 1}"
    st["workspaces"].append({"workspace_id": ws, "label": args[args.index("--label") + 1]})
    pane = {"pane_id": f"{ws}:p1", "workspace_id": ws, "label": "", "cwd": args[args.index("--cwd") + 1]}
    st["panes"].append(pane)
    out = {"workspace": st["workspaces"][-1], "root_pane": pane}
elif args[:2] == ["pane", "split"]:
    ws = next(p["workspace_id"] for p in st["panes"] if p["pane_id"] == args[2])
    pane = {"pane_id": f"{ws}:p{len(st['panes']) + 10}", "workspace_id": ws, "label": "", "beside": args[2]}
    st["panes"].append(pane)
    out = {"pane": pane}
elif args[:2] == ["pane", "rename"]:
    next(p for p in st["panes"] if p["pane_id"] == args[2])["label"] = args[3]
elif args[:2] == ["pane", "run"] and os.environ.get("STUB_HERDR_RUN_FAIL"):
    failed = True
elif args[:2] == ["pane", "run"]:
    next(p for p in st["panes"] if p["pane_id"] == args[2])["run"] = args[3]
elif args[:2] == ["pane", "close"]:
    st["panes"] = [p for p in st["panes"] if p["pane_id"] != args[2]]
    st["workspaces"] = [w for w in st["workspaces"] if any(p["workspace_id"] == w["workspace_id"] for p in st["panes"])]
json.dump(st, open(path, "w"))
if failed:
    print("pane run refused", file=sys.stderr)
    sys.exit(1)
print(json.dumps({"result": out}))
"""

CMUX_STUB = """#!/bin/bash
echo "$*" >> "$STUB_CMUX_LOG"
if [ -n "$STUB_CMUX_FAIL" ] && [ "$1" = new-split ]; then
  [ -n "$CMUX_QUIET" ] || echo "cmux: 'new-split' is now an alias for 'cmux pane split'." >&2
  echo "Error: ERROR: Access denied - only processes started inside cmux can connect; this pass ran from a terminal cmux did not start" >&2
  exit 1
fi
case "$1" in
  list-workspaces) echo "  workspace:7 Ops" ;;
  list-panes) echo "  pane:1" ;;
  list-pane-surfaces) [ -n "$STUB_CMUX_TITLE" ] && echo "  surface:5 $STUB_CMUX_TITLE" ;;
esac
exit 0
"""

OSASCRIPT_STUB = """#!/bin/bash
echo "$*" >> "$STUB_OSASCRIPT_LOG"
"""


def test_up_herdr_names(scratch):
    config = os.path.join(scratch, "up-herdr-names")
    os.makedirs(config)
    keys = ("PLAYGROUND_HERDR_DIR", "PLAYGROUND_HERDR_SESSION")
    saved = {k: os.environ.pop(k, None) for k in keys}
    try:
        os.environ.update(PLAYGROUND_HERDR_DIR="/new", PLAYGROUND_HERDR_SESSION="probes")
        up = load("up_herdr_names", os.path.join(OPS, "up.py"), config)
        check((up.HERDR_DIR, up.HERDR_SESSION) == ("/new", "probes"), "up: PLAYGROUND_HERDR_DIR and PLAYGROUND_HERDR_SESSION name the server", (up.HERDR_DIR, up.HERDR_SESSION))
    finally:
        for k, v in saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v


def test_up_herdr(scratch):
    config = os.path.join(scratch, "up-herdr")
    state = os.path.join(config, "playground", "ops")
    pins = os.path.join(scratch, "herdr-pin")
    bins = os.path.join(scratch, "herdr-bin")
    for d in (state, pins, bins):
        os.makedirs(d)
    for name, body in (("herdr", HERDR_STUB), ("cmux", CMUX_STUB), ("osascript", OSASCRIPT_STUB)):
        with open(os.path.join(bins, name), "w") as f:
            f.write(body)
        os.chmod(os.path.join(bins, name), 0o755)
    sha = __import__("hashlib").sha256(open(os.path.join(bins, "herdr"), "rb").read()).hexdigest()
    with open(os.path.join(pins, "pin.json"), "w") as f:
        json.dump({"path": os.path.join(bins, "herdr"), "sha256": sha, "version": "0.9.5"}, f)
    sock = os.path.join(pins, "playground.sock")
    open(sock, "w").close()
    herdr_state = os.path.join(scratch, "herdr-state.json")
    cmux_log = os.path.join(scratch, "cmux.log")
    banners = os.path.join(scratch, "osascript.log")
    saved = {k: os.environ.get(k) for k in ("PATH", "PLAYGROUND_HERDR_DIR", "PLAYGROUND_HERDR_SESSION", "STUB_HERDR_STATE", "STUB_CMUX_LOG", "STUB_CMUX_TITLE", "STUB_HERDR_DOWN", "STUB_HERDR_RUN_FAIL", "STUB_CMUX_FAIL", "CMUX_SOCKET_PATH", "STUB_OSASCRIPT_LOG")}
    os.environ.update(PATH=f"{bins}:{os.environ['PATH']}", PLAYGROUND_HERDR_DIR=pins, STUB_HERDR_STATE=herdr_state, STUB_CMUX_LOG=cmux_log, STUB_OSASCRIPT_LOG=banners)
    for k in ("PLAYGROUND_HERDR_SESSION", "STUB_CMUX_TITLE"):
        os.environ.pop(k, None)
    up = load("up_herdr", os.path.join(OPS, "up.py"), config)
    me = os.getpid()
    procs = {me: (100, "/bin/bash"), 100: (1, CMUX), 1: (0, "/sbin/launchd")}
    up.ptable.table = lambda: procs
    herdr_st = lambda: json.load(open(herdr_state)) if os.path.exists(herdr_state) else {"workspaces": [], "panes": [], "calls": []}
    folder = os.path.join(scratch, "jobs")

    def job(name, **extra):
        os.makedirs(os.path.join(folder, name), exist_ok=True)
        open(os.path.join(folder, name, "run.py"), "w").close()
        return {"name": name, "heartbeat": name, "needsCmux": True, "runtime": "cmux", "command": f"python3 {folder}/{name}/run.py", "cwd": "/x", **extra}

    def pass_with(jobs, quiet=True):
        with open(os.path.join(state, "jobs.json"), "w") as f:
            json.dump({"jobs": jobs}, f)
        if os.path.exists(up.STARTS):
            os.remove(up.STARTS)
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            up.up(quiet)
        return printed.getvalue()

    holders = []
    try:
        # 1: a herdr job with no Ops workspace creates one labelled Ops and runs its once.py command there
        pass_with([job("ops-a", runtime="herdr")])
        st = herdr_st()
        ops = [w for w in st["workspaces"] if w["label"] == "Ops"]
        a = next((p for p in st["panes"] if p.get("label") == "ops-a"), {})
        check(len(ops) == 1 and a.get("workspace_id") == ops[0]["workspace_id"], "up: a herdr job with no Ops workspace creates one labelled Ops", json.dumps(st))
        check(a.get("run") == f"cd /x && exec python3 -I {up.ONCE} ops-a python3 {folder}/ops-a/run.py", "up: the herdr pane runs the job's once.py command", a.get("run"))
        check(all(c["socket"] == sock and c["session"] == "playground" for c in st["calls"]), "up: every herdr call goes to the playground server's socket in the pin folder")
        check(not any("--no-focus" not in c["args"] for c in st["calls"] if c["args"][:2] in (["workspace", "create"], ["pane", "split"])), "up: herdr opens its pane with --no-focus")

        # 2: a second herdr job splits right beside the existing Ops pane
        pass_with([job("ops-b", runtime="herdr")])
        st = herdr_st()
        b = next((p for p in st["panes"] if p.get("label") == "ops-b"), {})
        split = next((c["args"] for c in st["calls"] if c["args"][:2] == ["pane", "split"]), [])
        check(len(st["workspaces"]) == 1 and b.get("workspace_id") == a.get("workspace_id") and b.get("beside") == a.get("pane_id") and "right" in split,
              "up: a second herdr job splits right beside the Ops pane", json.dumps(st))
        check(up.in_grid(job("ops-b", runtime="herdr"), {}, up.herdr()[0]) and not up.in_grid(job("ops-c", runtime="herdr"), {}, up.herdr()[0]),
              "up: in_grid finds a herdr job's pane by its label")

        # a pane whose run fails is closed, and the log names the step
        os.environ["STUB_HERDR_RUN_FAIL"] = "1"
        pass_with([job("ops-fail", runtime="herdr")])
        del os.environ["STUB_HERDR_RUN_FAIL"]
        check(not any(p.get("label") == "ops-fail" for p in herdr_st()["panes"]) and "pane run failed" in open(up.LOG).read(),
              "up: a herdr pane whose run fails is closed, and the log names the step", json.dumps(herdr_st()["panes"]))

        # 3: cmux to herdr: the copy under cmux is stopped by its recorded pid before the herdr start
        def holder(name, parent):
            # no child of this test, so launchd reaps it once stopped rather than leaving a zombie up.py reads as alive
            pid = int(subprocess.run(["bash", "-c", f'python3 -c "import time; time.sleep(1000)" {folder}/{name}/run.py > /dev/null 2>&1 & echo $!'],
                                     capture_output=True, text=True).stdout)
            holders.append(pid)
            procs[pid] = (parent, "/usr/bin/python3")
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            with open(os.path.join(state, f"{name}.pid"), "w") as f:
                f.write(f"{pid}\n")
            with open(os.path.join(state, f"{name}.json"), "w") as f:
                json.dump({"job": name, "pid": pid, "startedAt": now, "lastBeatAt": now, "lastResult": "ok", "cycleSeconds": 60}, f)
            return pid

        in_cmux = holder("ops-move", 100)
        os.environ["STUB_CMUX_TITLE"] = f"python3 -I once.py ops-move python3 {folder}/ops-move/run.py"
        check(up.healthy(job("ops-move"), procs, 100)[0], "up: as a cmux job, its copy under cmux is healthy")
        check(not up.healthy(job("ops-move", runtime="herdr"), procs, 100)[0], "up: once its runtime is herdr, that copy is not")
        pass_with([job("ops-move", runtime="herdr")])
        st = herdr_st()
        moved = next((p for p in st["panes"] if p.get("label") == "ops-move"), {})
        check(wait_for(lambda: not alive(in_cmux), 5), "up: cmux to herdr stops the copy under cmux by its recorded pid")
        check("ops-move" in moved.get("run", ""), "up: and starts the job in herdr", json.dumps(st["panes"]))
        check("close-surface --surface surface:5 --workspace workspace:7" in open(cmux_log).read(), "up: and closes its old cmux surface")

        # and back: herdr to cmux stops the copy in herdr, closes its pane and starts it in cmux
        in_herdr = holder("ops-move", 1)
        os.environ["STUB_CMUX_TITLE"] = "another job"
        open(cmux_log, "w").close()
        pass_with([job("ops-move")])
        st = herdr_st()
        check(wait_for(lambda: not alive(in_herdr), 5), "up: herdr to cmux stops the copy in herdr by its recorded pid")
        check(not any(p.get("label") == "ops-move" for p in st["panes"]), "up: and closes its herdr pane", json.dumps(st["panes"]))
        check(re.search(r"^new-split right --workspace workspace:7 .*once\.py ops-move ", open(cmux_log).read(), re.M) is not None,
              "up: and starts it as a cmux split in Ops", open(cmux_log).read())

        # auto: cmux while cmux holds a live Claude session, herdr once it holds none
        os.makedirs(os.path.join(config, "sessions"), exist_ok=True)
        with open(os.path.join(config, "sessions", "555.json"), "w") as f:
            json.dump({"name": "dispatcher-5e", "pid": 555}, f)
        procs[555] = (100, "/usr/local/bin/claude")
        check(up.cmux_held(procs), "up: a registry session whose pid runs under the cmux app means cmux holds a session")
        os.environ["STUB_CMUX_TITLE"] = "another job"
        open(cmux_log, "w").close()
        pass_with([job("ops-auto", runtime="auto")])
        check(re.search(r"^new-split right --workspace workspace:7 .*once\.py ops-auto ", open(cmux_log).read(), re.M) is not None
              and not any(p.get("label") == "ops-auto" for p in herdr_st()["panes"]),
              "up: an auto job starts in cmux while cmux holds a session", open(cmux_log).read())
        procs[555] = (1, "/usr/local/bin/claude")
        check(not up.cmux_held(procs), "up: a registry session outside cmux means cmux holds none")
        # a crashed session's file whose pid macOS gave to a process under cmux holds nothing, as the dashboard's cmuxHeldOf() reads it
        reused = os.path.join(config, "sessions", "556.json")
        with open(reused, "w") as f:
            json.dump({"name": "worker-crashed", "pid": 556, "sessionId": "abc", "procStart": "Mon Oct  5 23:37:23 2026"}, f)
        procs[556] = (100, "/usr/local/bin/claude")
        real_starts = up.ptable.starts
        try:
            up.ptable.starts = lambda pids: {556: "Tue Oct 6 01:00:00 2026"}
            check(not up.cmux_held(procs), "up: a registry file whose procStart differs from its pid's start holds nothing")
            up.ptable.starts = lambda pids: {556: "Mon Oct 5 23:37:23 2026"}
            check(up.cmux_held(procs), "up: a registry file whose procStart matches its pid's start holds cmux")
            up.ptable.starts = lambda pids: None
            check(up.cmux_held(procs), "up: when ps cannot give the starts, the registry's pid decides")
        finally:
            up.ptable.starts = real_starts
            os.remove(reused)
            del procs[556]
        check(not up.cmux_held({me: (1, "/bin/bash")}), "up: with no cmux app running, cmux holds none")
        check(up.cmux_held({}), "up: a process table that cannot be read counts as held")
        open(cmux_log, "w").close()
        pass_with([job("ops-auto", runtime="auto")])
        check(any(p.get("label") == "ops-auto" for p in herdr_st()["panes"]) and "new-split" not in open(cmux_log).read(),
              "up: an auto job starts in herdr once cmux holds no session, with no hand step", json.dumps(herdr_st()["panes"]))
        in_cmux = holder("ops-auto-kept", 100)
        open(cmux_log, "w").close()
        calls = len(herdr_st()["calls"])
        pass_with([job("ops-auto-kept", runtime="auto")])
        check(alive(in_cmux) and len(herdr_st()["calls"]) == calls and not re.search(r"new-split|close", open(cmux_log).read()),
              "up: an auto job healthy under cmux is left there when cmux holds no session")
        procs[555] = (100, "/usr/local/bin/claude")
        in_herdr = holder("ops-auto-there", 1)
        open(cmux_log, "w").close()
        pass_with([job("ops-auto-there", runtime="auto")])
        check(wait_for(lambda: not alive(in_herdr), 5) and re.search(r"^new-split right --workspace workspace:7 .*once\.py ops-auto-there ", open(cmux_log).read(), re.M) is not None,
              "up: an auto job healthy in herdr moves back to cmux once cmux holds a session", open(cmux_log).read())
        orphan = holder("ops-auto-orphan", 1)
        open(cmux_log, "w").close()
        pass_with([job("ops-auto-orphan", runtime="auto")])
        check(wait_for(lambda: not alive(orphan), 5) and "once.py ops-auto-orphan " in open(cmux_log).read(),
              "up: an auto job a cmux restart left under launchd is stopped and started in cmux, not read as healthy")

        # while cmux holds no session, an auto job's copy counts only under the pinned herdr's server or a cmux, never as a launchd orphan
        procs[555] = (1, "/usr/local/bin/claude")
        procs[200] = (1, os.path.join(bins, "herdr"))
        holder("ops-auto-server", 200)
        check(up.healthy(up.placed(job("ops-auto-server", runtime="auto"), False), procs, 100)[0],
              "up: an auto job under the pinned herdr's server is healthy while cmux holds no session")
        lost = holder("ops-auto-lost", 1)
        check(not up.healthy(up.placed(job("ops-auto-lost", runtime="auto"), False), procs, 100)[0],
              "up: an auto job under launchd is not healthy while cmux holds no session")
        pass_with([job("ops-auto-lost", runtime="auto")])
        check(wait_for(lambda: not alive(lost), 5) and any(p.get("label") == "ops-auto-lost" for p in herdr_st()["panes"]),
              "up: and is stopped by its recorded pid and started in herdr", json.dumps(herdr_st()["panes"]))

        # --once-per-cmux counts a cmux launch done only once a pass found cmux holding a session
        cmux_sock = os.path.join(scratch, "cmux-launch")
        open(cmux_sock, "w").close()
        os.environ["CMUX_SOCKET_PATH"] = cmux_sock
        mark = os.path.join(state, "up.cmux")
        with open(os.path.join(state, "jobs.json"), "w") as f:
            json.dump({"jobs": [job("ops-auto-server", runtime="auto")]}, f)
        argv = sys.argv
        try:
            sys.argv = ["up.py", "--once-per-cmux"]
            up.main()
            check(not os.path.exists(mark), "up: a once-per-cmux pass with cmux holding no session leaves the launch to the next terminal")
            procs[555] = (100, "/usr/local/bin/claude")
            up.main()
            check(os.path.exists(mark), "up: a once-per-cmux pass with cmux holding a session marks the launch done")
        finally:
            sys.argv = argv

        # a pass that prints: a job with no runtime opens in herdr, and the jobs after it still run
        open(cmux_log, "w").close()
        bare = {k: v for k, v in job("ops-noruntime").items() if k != "runtime"}
        printed = pass_with([bare, job("ops-after", runtime="herdr")], quiet=False)
        check("started ops-noruntime in herdr (no heartbeat)" in printed and "started ops-after in herdr" in printed and any(p.get("label") == "ops-noruntime" for p in herdr_st()["panes"]) and "new-split" not in open(cmux_log).read(),
              "up: a job with no runtime prints as started in herdr, and the jobs after it still run", printed)

        # a failed start logs cmux's whole answer, past its alias notice, and waits out no GRACE
        os.environ["STUB_CMUX_FAIL"] = "1"
        open(cmux_log, "w").close()
        pass_with([job("ops-refused")])
        up.up(True)
        del os.environ["STUB_CMUX_FAIL"]
        logged = [l for l in open(up.LOG).read().splitlines() if "started ops-refused" in l]
        check(len(logged) == 2 and logged[-1].endswith("this pass ran from a terminal cmux did not start") and "alias" not in logged[-1],
              "up: a failed start logs cmux's whole answer with no alias notice", logged[-1:])
        check(open(cmux_log).read().count("new-split") == 2, "up: a failed start is tried again on the next pass, with no GRACE wait")

        # the printed line holds no heartbeat age, so ops-tick's once-only dedupe holds for a start that keeps failing
        os.environ["STUB_CMUX_FAIL"] = "1"
        said = []
        for minutes in (7, 12):
            beat = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - minutes * 60))
            with open(os.path.join(state, "ops-stale.json"), "w") as f:
                json.dump({"job": "ops-stale", "pid": me, "startedAt": beat, "lastBeatAt": beat, "lastResult": "ok", "cycleSeconds": 60}, f)
            said.append(pass_with([job("ops-stale")], quiet=False))
        del os.environ["STUB_CMUX_FAIL"]
        check(said[0] == said[1] and "could not start ops-stale" in said[0] and "m old" not in said[0], "up: the printed line leaves out the heartbeat's age", said)

        # a pass outside cmux leaves a cmux job and says why
        outside = {k: v for k, v in procs.items()}
        outside[me] = (1, "/bin/bash")
        up.ptable.table = lambda: outside
        open(cmux_log, "w").close()
        far = [pass_with([job("ops-far")], quiet=False), pass_with([job("ops-far")], quiet=False)]
        up.ptable.table = lambda: procs
        check("new-split" not in open(cmux_log).read() and "not starting it in cmux: this pass runs outside cmux" in open(up.LOG).read(),
              "up: a pass outside cmux logs a cmux job it would start and leaves it")
        check(far[0] == far[1] and "ops-far is down, and this pass runs outside cmux, which answers only its own terminals" in far[0],
              "up: and prints the same line each pass, so ops hears it once", far)

        # a pass outside cmux tells ops of an auto job left outside cmux while cmux holds a session, logging it once
        out_pid = holder("ops-auto-out", 200)
        outside[out_pid] = procs[out_pid]
        outside[555] = (100, "/usr/local/bin/claude")
        up.ptable.table = lambda: outside
        try:
            said = [pass_with([job("ops-auto-out", runtime="auto")], quiet=False)]
            again = io.StringIO()
            with contextlib.redirect_stdout(again):
                up.up(False)
            said.append(again.getvalue())
        finally:
            up.ptable.table = lambda: procs
        line = "ops-auto-out runs outside cmux while cmux holds a factory session; a pass inside cmux moves it back, so open a cmux terminal"
        check(all(line in out for out in said), "up: a pass outside cmux prints an auto job left outside cmux while cmux holds a session", said)
        check(open(up.LOG).read().count(line) == 1, "up: and logs it once")
        check(open(banners).read().count(line) == 1, "up: and shows it as one macOS banner, through the osascript stub")

        # a missing server socket refuses a herdr start and stops nothing
        os.remove(sock)
        kept = holder("ops-kept", 100)
        calls = len(herdr_st()["calls"])
        pass_with([job("ops-kept", runtime="herdr")])
        check(alive(kept) and len(herdr_st()["calls"]) == calls and "has no socket" in open(up.LOG).read(),
              "up: with no herdr socket, a herdr job is logged and skipped, and its cmux copy keeps running")

        # a server that crashed leaves its socket: one that does not say it runs refuses a herdr start too, and stops nothing
        open(sock, "w").close()
        os.environ["STUB_HERDR_DOWN"] = "1"
        down = holder("ops-down", 100)
        calls = len(herdr_st()["calls"])
        said = pass_with([job("ops-down", runtime="herdr")], quiet=False)
        check("ops-down is down, and herdr cannot start it: the herdr server" in said and "is not running" in said,
              "up: and prints why herdr cannot start it", said)
        check(alive(down) and len(herdr_st()["calls"]) == calls and "is not running" in open(up.LOG).read(),
              "up: with a herdr socket but no running server, a herdr job is logged and skipped, and its cmux copy keeps running")
    finally:
        for pid in holders:
            if alive(pid):
                os.kill(pid, signal.SIGKILL)
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def dashboard(scratch, name, how):
    """Start run.sh on scratch, stop it the way how says, and check that its recorded stack, and only that, is gone."""
    config, checkout, env = stub_env(scratch, name)
    # a dashboard past first run's setup, which wrote its database's URL, so the supervisor starts its follower
    with open(os.path.join(checkout, ".env"), "w") as f:
        f.write("POSTGRES_URL=postgresql://postgres:stub@127.0.0.1:1/stub\n")
    state = os.path.join(config, "playground", "ops", "dashboard")
    out = open(os.path.join(scratch, name + ".out"), "w")
    run_sh = os.path.join(OPS, "dashboard", "run.sh")
    bystander = subprocess.Popen(["sleep", "1000"], start_new_session=True)
    if how == "parent gone":
        pidfile = os.path.join(scratch, name + ".pid")
        parent = subprocess.Popen(["bash", "-c", 'bash "$0" & echo $! > "$1"; wait', run_sh, pidfile], cwd=checkout, env=env,
                                  stdout=out, stderr=out, start_new_session=True)
        wait_for(lambda: os.path.exists(pidfile) and open(pidfile).read().strip(), 10)
        run_pid = int(open(pidfile).read())
    else:
        parent = subprocess.Popen(["bash", run_sh], cwd=checkout, env=env, stdout=out, stderr=out, start_new_session=True)
        run_pid = parent.pid
    results = os.path.join(state, "results.log")
    started = wait_for(lambda: os.path.exists(results) and " START " in open(results).read(), 90)
    stack = recorded(state)
    try:
        check(started and len(stack) >= 4, f"dashboard ({how}): the scratch stack started and was recorded", f"{stack}; {open(out.name).read()[-400:]}")
        if how == "HUP":
            os.kill(run_pid, signal.SIGHUP)
        elif how == "parent gone":
            os.kill(parent.pid, signal.SIGKILL)
        else:
            os.kill(run_pid, signal.SIGKILL)
            parent.wait()  # reap it, as its terminal would: a zombie still answers kill -0
        gone = wait_for(lambda: not any(alive(p) for p in stack), 75)
        check(gone, f"dashboard ({how}): every recorded process of the stack stopped", [p for p in stack if alive(p)])
        check(alive(bystander.pid), f"dashboard ({how}): a process it did not record still runs")
        watch = [int(w) for w in re.findall(r"watch pid (\d+)", open(out.name).read())]
        # the stuck watch checks run.sh once a tick (60s), so it may take that long to follow
        check(len(watch) == 2 and not alive(watch[0]), f"dashboard ({how}): run.sh's first start execd the checkout's run.sh once, its first watch stopped", watch)
        check(watch and wait_for(lambda: not alive(watch[-1]), 90), f"dashboard ({how}): the stuck watch ended with run.sh", watch)
        if how != "run.sh killed":
            check(wait_for(lambda: not alive(run_pid), 30), f"dashboard ({how}): run.sh exited")
            beat = json.load(open(os.path.join(config, "playground", "ops", "ops-dashboard.json")))
            check(beat["lastResult"].startswith("loop exited"), f"dashboard ({how}): its heartbeat reads loop exited", beat)
    finally:
        # everything here is this test's own, so a failed run leaves nothing behind: the groups of run.sh, of the supervisor and the watch
        # it printed, and of the stack as recorded now (a supervisor left running may have restarted it), then the bystander
        printed = [int(p) for p in re.findall(r"(?:supervisor|watch) pid (\d+)", open(out.name).read())]
        for pgid in {parent.pid, *printed, *stack.values(), *recorded(state).values()}:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except OSError:
                pass
        for proc in (bystander, parent):
            if proc.poll() is None:
                proc.kill()
            proc.wait()


def roll_now(scratch, name, canary, expect):
    """Start run.sh on scratch with canary's head at canary, ask a roll with roll-now, and check the line it answers with."""
    config, checkout, env = stub_env(scratch, name)
    state = os.path.join(config, "playground", "ops", "dashboard")
    if canary != "0" * 40:
        with open(os.path.join(state, "bad-builds"), "w") as f:
            f.write(canary + "\n")
    out = open(os.path.join(scratch, name + ".out"), "w")
    parent = subprocess.Popen(["bash", os.path.join(OPS, "dashboard", "run.sh")], cwd=checkout, env={**env, "STUB_CANARY": canary},
                              stdout=out, stderr=out, start_new_session=True)
    results = os.path.join(state, "results.log")
    try:
        started = wait_for(lambda: os.path.exists(results) and " START " in open(results).read(), 90)
        open(os.path.join(state, "roll-now"), "w").close()
        answered = started and wait_for(lambda: expect in open(results).read(), 75)
        check(answered and not os.path.exists(os.path.join(state, "roll-now")),
              f"dashboard ({name}): a roll-now with nothing to roll to logs {expect.split()[0]} and is removed",
              open(results).read()[-300:] if os.path.exists(results) else "no results.log")
    finally:
        printed = [int(p) for p in re.findall(r"(?:supervisor|watch) pid (\d+)", open(out.name).read())]
        for pgid in {parent.pid, *printed, *recorded(state).values()}:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except OSError:
                pass
        if parent.poll() is None:
            parent.kill()
        parent.wait()


def main():
    with tempfile.TemporaryDirectory() as scratch:
        test_cfg(scratch)
        test_up(scratch)
        test_key(scratch)
        test_up_orphan(scratch)
        test_up_herdr_names(scratch)
        test_up_herdr(scratch)
        test_unguarded(scratch)
        test_branch_guard(scratch)
        test_resume(scratch)
        test_resume_registry(scratch)
        test_resume_paused(scratch)
        threads = [threading.Thread(target=dashboard, args=(scratch, f"dashboard{i}", how)) for i, how in enumerate(("HUP", "parent gone", "run.sh killed"))]
        threads.append(threading.Thread(target=roll_now, args=(scratch, "current", "0" * 40, "CURRENT 0000000")))
        threads.append(threading.Thread(target=roll_now, args=(scratch, "bad-build", "1" * 40, "SKIP 1111111 FAIL 1111111 failed its roll before")))
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    print("FAILURES:", len(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
