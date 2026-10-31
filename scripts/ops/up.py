#!/usr/bin/env python3
"""ops-up: start every ops job in jobs.json that is not healthy, and leave healthy ones alone.

A job's `runtime` says where it runs: "cmux" as a split in cmux's Ops workspace, "herdr" (the default for a job ops starts in a terminal) as a pane of the Ops
workspace on the factory herdr server (the binary pin.json names, as spawn.sh reaches it), or "auto": cmux while cmux holds a live
factory session, else herdr, so quitting cmux moves the job on the next pass with no hand step. When a cmux or herdr job's
runtime changes, the next pass stops the copy in the other runtime by its recorded pid and starts the job in the new one; an auto
job is left wherever a healthy copy runs inside herdr or cmux while cmux holds no session (a launchd orphan is stopped and started in
herdr), and moves back to cmux once it holds one, on the next pass that runs inside cmux.

  up.py                      check every job once; start the unhealthy cmux and herdr jobs, each as a pane of its runtime's Ops workspace
  up.py --once-per-cmux      the same, at most once per cmux launch (the ~/.zshrc hook); silent. A launch counts as done only once a
                             pass found cmux holding a session, so each new cmux terminal tries until an auto job has moved back
  up.py --restarted <a,b>    a plain pass, once any running pass ends, with those jobs' starts dropped first, so GRACE holds
                             back no job ops-restart stopped (packages/scripts/src/ops-restart)
  up.py --sessions           list, never run, the commands that bring the factory's Claude sessions back

Healthy means the job's heartbeat (ops/<name>.json) is fresh (within three cycles), its pid is alive, its last result
is not an exit and, for a cmux job, its pid runs under the cmux app this script runs under (ptable.py): a job a cmux restart orphaned
keeps a fresh heartbeat under launchd, where cmux refuses it, so it is stopped by its recorded pid and started in the new Ops grid. An unhealthy cmux job's old workspace, which ops opened, is closed first (ops-dashboard then waits until its
recorded process groups are gone, stopping them through procs.sh); nothing is ever selected by name or pattern. A
launchd job is only reported: launchd keeps it alive. A job whose holder runs an executable an update deleted, or whose heartbeat pid does while a holder or launchd holds it,
(lsof, once a pass) is unhealthy: a cmux or herdr job is stopped by its recorded pid and started again, a launchd job is reported once. cmux answers only its own terminals, so a pass outside one (ops-tick's) logs
a cmux job it would start and leaves it. A job that fails to start is logged with cmux's or herdr's whole answer and tried again on
the next pass; only one that started waits out GRACE.

A plain pass exits 3 when it left the Dashboard's job (stop "dashboard") down only because it runs outside cmux (the "open a cmux terminal"
line), so dispatcher stops there rather than wait for a Dashboard this pass cannot start; every other pass exits 0.
"""
import fcntl, glob, hashlib, json, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
_hook = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "inscope", "inscope.zsh")
try:
    _hooked = open(_hook).read()
except OSError:
    _hooked = ""
# under the inscope signal spawn.sh drops CLAUDE_CONFIG_DIR and INSCOPE_CCD and registers sessions under ~/.claude, so the sessions and transcripts read there too
REGISTRY = (
    os.path.expanduser("~/.claude")
    if os.environ.get("INSCOPE_CCD") or "INSCOPE_CCD" in _hooked or "CLAUDE_CONFIG_DIR" in _hooked
    else CFG
)
# spawn.sh's data folder, as dataDir() reads it: PLAYGROUND_DATA_DIR when set, else .playground in the home folder; it keeps the backend pins and the roster there
DATA = os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground"))
OUTSIDE_CMUX = 3
GRACE = 600  # a job started this recently has not had time to write its first heartbeat, so it is left alone
SPAWN = os.path.join(os.path.dirname(HERE), "spawn.sh")  # the one way a session comes back, through the factory's capacity gate
ONCE = os.path.join(HERE, "once.py")  # every job starts through it: one copy per job, held by its recorded pid
_spec = __import__("importlib.util").util.spec_from_file_location("once", ONCE)
once = __import__("importlib.util").util.module_from_spec(_spec)
_spec.loader.exec_module(once)
sys.path.insert(0, HERE)
import ptable

OPS = once.OPS
LOG = os.path.join(OPS, "up.log")
STARTS = os.path.join(OPS, "up-state.json")

HERDR_DIR = os.environ.get("PLAYGROUND_HERDR_DIR") or os.environ.get("DESK_HERDR_DIR") or os.path.expanduser("~/.playground/herdr")
HERDR_SESSION = os.environ.get("PLAYGROUND_HERDR_SESSION") or os.environ.get("DESK_HERDR_SESSION") or "playground"


def log(msg):
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {msg}\n")


def run(argv, timeout=60):
    try:
        # CMUX_QUIET keeps cmux's notice that a legacy command is now an alias out of the answer, which a failure logs whole
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env={**os.environ, "CMUX_QUIET": "1"})
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 1, str(e)


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def healthy(job, procs, cmux):
    try:
        b = json.load(open(os.path.join(OPS, f"{job['heartbeat']}.json")))
    except Exception:
        return False, "no heartbeat"
    age = time.time() - (time.mktime(time.strptime(b["lastBeatAt"][:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone)
    if age > 3 * int(b.get("cycleSeconds", 60)):
        return False, f"heartbeat {int(age // 60)}m old"
    if not alive(b.get("pid", 0)):
        return False, "process gone"
    if "exited" in str(b.get("lastResult", "")):
        return False, str(b["lastResult"])
    if job.get("auto") and is_herdr(job):
        # cmux holds no session, so a copy is left where it runs, but only inside a terminal: a launchd orphan sits in neither
        if int(b["pid"]) in procs and not in_a_terminal(int(b["pid"]), procs):
            return False, f"pid {b['pid']} runs in neither herdr nor cmux"
        return True, "ok"
    # a pid the snapshot lacks started after it was read (a restart during this pass): it cannot be judged, so it is left to the next pass
    if is_herdr(job) and int(b["pid"]) in procs and ptable.cmux_of(int(b["pid"]), procs):
        return False, f"pid {b['pid']} runs under cmux, and its runtime is herdr"
    if job.get("needsCmux") and not is_herdr(job) and cmux and int(b["pid"]) in procs and ptable.cmux_of(int(b["pid"]), procs) != cmux:
        return False, f"pid {b['pid']} is not under the running cmux (pid {cmux})"
    return True, "ok"


def is_herdr(job):
    # a job ops starts in a terminal (needsCmux) names no runtime to run in herdr
    return job.get("runtime", "herdr" if job.get("needsCmux") else None) == "herdr"


def is_dashboard(job):
    return job.get("stop") == "dashboard"


def herdr_exes():
    """The pinned herdr binary's path, as ps prints a server started by it, and its real path; empty when the pin does not read."""
    try:
        path = json.load(open(os.path.join(HERDR_DIR, "pin.json")))["path"]
        return {path, os.path.realpath(path)}
    except Exception:
        return set()


def in_a_terminal(pid, procs):
    """Whether pid runs under the pinned herdr's server or a running cmux app."""
    return bool(ptable.above(pid, procs, herdr_exes()) or ptable.cmux_of(pid, procs))


def registered(path):
    """(the procStart a registry file gives in the shape ps prints under C, spaces made one, else "", and the name it gives, else "") for a file that reads whole as the dashboard's registeredOf() reads one, else None: a file Claude is rewriting counts by its pid."""
    try:
        d = json.load(open(path))
        pid, name = d.get("pid"), d.get("name")
        if isinstance(pid, int) and pid > 1 and isinstance(d.get("sessionId"), str) and d["sessionId"]:
            start = " ".join(str(d.get("procStart", "")).split())
            return (start if re.fullmatch(r"[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}", start) else "", name if isinstance(name, str) else "")
    except Exception:
        pass
    return None


# The factory-role rule from its one source: the names of the [name, the roster's kind] pairs on stdin that factoryRoleOf places in the factory; kinds.ts imports nothing, so Bun reads it from source as the hooks do
KINDS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "packages", "config", "src", "kinds.ts")
# The machine's managers' names (sessions.names and sessions.aliases) are set first, so a manager's name places as the hooks place it; with none readable the role words stand.
SETTING = os.path.join(os.path.dirname(os.path.dirname(HERE)), "packages", "scripts", "src", "playground", "setting.ts")
IN_FACTORY = "const [kinds, setting] = process.argv.slice(-2); try { (await import(setting)).loadSessionNames() } catch {} const { factoryRoleOf } = await import(kinds); console.log(JSON.stringify((await Bun.stdin.json()).filter(([name, kind]) => factoryRoleOf(name, kind)).map(([name]) => name)))"


def in_factory(names):
    """The names the factory-role rule places in the factory, by the roster's kind for each name, else the name, in one Bun call; None when Bun cannot answer."""
    if not names:
        return []
    kinds = roster_kinds()
    try:
        r = subprocess.run([shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun"), "--no-env-file", "-e", IN_FACTORY, KINDS, SETTING],
                           input=json.dumps([[name, kinds.get(name)] for name in names]), capture_output=True, text=True, timeout=30)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except Exception:
        return None


def cmux_held(procs):
    """Whether cmux holds a live factory session, as the dashboard's cmuxHeldOf() reads one: a registry file (sessions/<pid>.json) whose pid runs under the cmux app and, where the file gives procStart, started then (a crashed session's pid macOS gave to another process does not hold), and whose name a PR's rule places in the factory, so a session of the owner's own never holds cmux. A file Claude is rewriting holds by its pid. With no cmux app running it holds none; a process table, registry, ps or Bun call that cannot be read counts as held."""
    if not procs:
        return True
    if not ptable.running_cmux(procs):
        return False
    folder = os.path.join(REGISTRY, "sessions")
    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    under = {int(n[:-5]): registered(os.path.join(folder, n)) for n in names if re.fullmatch(r"\d+\.json", n) and ptable.cmux_of(int(n[:-5]), procs)}
    timed = [pid for pid, file in under.items() if file and file[0]]
    started = ptable.starts(timed) if timed else {}
    live = [file for pid, file in under.items() if not file or not file[0] or started is None or started.get(pid) == file[0]]
    if any(file is None for file in live):
        return True
    held = in_factory([name for _, name in live])
    return held is None or bool(held)


def placed(job, held):
    """The job as this pass runs it: an auto job's runtime is cmux while cmux holds a factory session and herdr once it holds none."""
    if job.get("runtime") != "auto":
        return job
    return {**job, "auto": True, "runtime": "cmux" if held else "herdr"}


def one_line_answer(out):
    """A cmux or herdr answer whole, on one line."""
    return " ".join(line.strip() for line in out.splitlines() if line.strip() and "is now an alias for" not in line) or "no answer"


def elsewhere(job, holder, procs, cmux, stale=""):
    """Why a job's live holder runs outside its runtime, else "": a herdr job's under a cmux, a cmux job's outside the running cmux (a cmux restart's orphan, or a copy in herdr), an auto job's in neither herdr nor cmux, or any job's on a deleted executable (stale)."""
    if not holder or holder not in procs:
        return ""
    if stale:
        return stale
    if job.get("auto") and is_herdr(job):
        return "" if in_a_terminal(holder, procs) else "runs in neither herdr nor cmux"
    under = ptable.cmux_of(holder, procs)
    if is_herdr(job):
        return "runs under cmux, and its runtime is herdr" if under else ""
    return "is not under the running cmux" if job.get("needsCmux") and cmux and under != cmux else ""


def beat_pid(job):
    try:
        return int(json.load(open(os.path.join(OPS, f"{job['heartbeat']}.json"))).get("pid") or 0)
    except Exception:
        return 0


def deleted(pids):
    """Each of the pids whose executable no longer exists, with that path, read in one lsof call (the first txt file after each pid); a failed or empty read finds none."""
    if not pids:
        return {}
    found, pid = {}, None
    for line in run(["lsof", "-a", "-p", ",".join(map(str, sorted(pids))), "-d", "txt", "-Fpn"], 10)[1].splitlines():
        if line[:1] == "p" and line[1:].isdigit():
            pid = int(line[1:])
        elif line[:1] == "n" and pid is not None and pid not in found:
            found[pid] = line[1:]
    return {pid: exe for pid, exe in found.items() if exe.startswith("/") and not os.path.exists(exe)}


def stale_of(holder, beat, gone):
    """Why a job runs on a deleted executable (an update removed it), its holder's or its heartbeat pid's, else ""."""
    if holder in gone:
        return f"runs a deleted executable ({gone[holder]})"
    if beat in gone:
        return f"holds pid {beat}, which runs a deleted executable ({gone[beat]})"
    return ""


def herdr():
    """(the pinned herdr binary, "") while it hashes to its pin's sha256, reads its version and the factory server's socket exists, else (None, why)."""
    try:
        pin = json.load(open(os.path.join(HERDR_DIR, "pin.json")))
        path = pin["path"]
        found = hashlib.sha256(open(os.path.realpath(path), "rb").read()).hexdigest()
    except Exception:
        return None, f"it cannot read the herdr pin {HERDR_DIR}/pin.json"
    if found != pin.get("sha256"):
        return None, f"herdr at {path} does not hash to its pin's sha256"
    if run([path, "--version"], 20)[1].strip().split("\n")[0] != f"herdr {pin.get('version')}":
        return None, f"herdr at {path} does not read herdr {pin.get('version')} on --version"
    if not os.path.exists(os.path.join(HERDR_DIR, f"{HERDR_SESSION}.sock")):
        return None, f"the herdr server {HERDR_SESSION} has no socket in {HERDR_DIR}"
    # a crashed server leaves its socket, so it must also say it runs, as spawn.sh checks
    try:
        r = subprocess.run([path, "status", "server", "--json"], capture_output=True, text=True, timeout=30, env=hr_env())
        running = json.loads(r.stdout).get("running") is True
    except Exception:
        running = False
    if not running:
        return None, f"the herdr server {HERDR_SESSION} is not running at its socket in {HERDR_DIR}"
    return path, ""


def hr_env():
    return {**os.environ, "HERDR_SESSION": HERDR_SESSION, "HERDR_SOCKET_PATH": os.path.join(HERDR_DIR, f"{HERDR_SESSION}.sock"), "HERDR_CONFIG_PATH": os.path.join(HERDR_DIR, "config.toml")}


def hr(binary, *args):
    """herdr on the factory server, as spawn.sh's hr(): (exit code, its JSON answer's result, what it said on stderr)."""
    try:
        r = subprocess.run([binary, *args], capture_output=True, text=True, timeout=30, env=hr_env())
    except Exception as e:
        return 1, {}, str(e)
    try:
        result = json.loads(r.stdout).get("result") or {}
    except Exception:
        result = {}
    return r.returncode, result, (r.stderr or "").strip()


def ops_panes(binary):
    """[(pane id, label)] in the herdr Ops workspace, oldest first, and that workspace's id or None."""
    ws = next((w.get("workspace_id") for w in hr(binary, "workspace", "list")[1].get("workspaces", []) if w.get("label") == GRID), None)
    if not ws:
        return [], None
    return [(p["pane_id"], p.get("label")) for p in hr(binary, "pane", "list", "--workspace", ws)[1].get("panes", []) if p.get("workspace_id") == ws], ws


def start_herdr(job, binary, command, cwd):
    panes, _ = ops_panes(binary)
    if panes:
        _, r, answer = hr(binary, "pane", "split", panes[-1][0], "--direction", "right", "--cwd", cwd, "--no-focus")
        pane = (r.get("pane") or {}).get("pane_id")
    else:
        _, r, answer = hr(binary, "workspace", "create", "--cwd", cwd, "--label", GRID, "--no-focus")
        pane = (r.get("root_pane") or {}).get("pane_id")
    if not pane:
        log(f"started {job['name']} in herdr {GRID}: herdr opened no pane{': ' + answer if answer else ''}")
        return False
    # the label carries the job's name, so in_grid finds the pane and a restart keeps it; a pane that fails a step is closed, as spawn.sh does
    for step, arg in (("rename", job["name"]), ("run", f"cd {cwd} && exec python3 -I {ONCE} {job['name']} {command}")):
        code, _, answer = hr(binary, "pane", step, pane, arg)
        if code:
            hr(binary, "pane", "close", pane)
            log(f"started {job['name']} in herdr {GRID}: pane {step} failed, so pane {pane} is closed{': ' + answer if answer else ''}")
            return False
    log(f"started {job['name']} in herdr {GRID}: ok, pane {pane}")
    return True


def workspaces():
    _, out = run(["cmux", "list-workspaces"], 20)
    found = {}
    for line in out.splitlines():
        m = re.match(r"^\*?\s*(workspace:\d+)\s+(\S+)", line.strip())
        if m:
            found.setdefault(m.group(2), []).append(m.group(1))
    return found


# the dashboard's jobs, each a pid file procs.sh reads: the follower first, then the API, a swap's next web and the web
JOBS = ("dashboard-ingest", "dashboard-dev", "dashboard-web-next", "dashboard-web")


def stop_dashboard():
    """Wait for the old dashboard stack's recorded groups to go, stopping what is left through procs.sh (never by name)."""
    procs = os.path.join(HERE, "dashboard", "procs.sh")
    for _ in range(40):
        if not any(run([procs, "left", job])[1].strip() for job in JOBS):
            return
        time.sleep(1)
    for job in JOBS:
        run([procs, "stop", job], 60)


GRID = "Ops"  # every ops job runs as a split in this one workspace


def surfaces(ws):
    """[(surface ref, title)] across every pane of a workspace."""
    _, panes = run(["cmux", "list-panes", "--workspace", ws], 20)
    found = []
    for pane in re.findall(r"pane:\d+", panes):
        _, out = run(["cmux", "list-pane-surfaces", "--workspace", ws, "--pane", pane], 20)
        found += [(m.group(1), m.group(2)) for l in out.splitlines() for m in [re.match(r"^\*?\s*(surface:\d+)\s+(.*?)(\s+\[selected\])?$", l.strip())] if m]
    return found


def marker(job):
    """The job's folder (ops/<name>/), which its loop's command line holds even after a wrapper execs."""
    argv = [os.path.expanduser(a) for a in job["command"].split()]
    script = next((a for a in argv if "/" in a and os.path.isfile(a) and not a.endswith(("/python3", "/bash", "/env"))), argv[0])
    return once.marker_of(script)


def key_of(job):
    command = job["command"].replace("~/", os.path.expanduser("~") + "/")
    key = command.split()[-1] if command.split()[-1].startswith("/") else command.split()[0]
    # a Bun job (packages/scripts/src/ops-<name>/cli.ts) holds no /ops/ word, and keyed by bun it would close every Ops surface, so its script is found by shape even before it is on disk
    script = next((w for w in command.split() if "/" in w and not w.endswith(("/python3", "/bash", "/bun", "/env"))), None)
    folder = once.marker_of(script) if script else "/"
    return next((w for w in command.split() if "/ops/" in w), folder if folder != "/" else key)


def in_grid(job, existing, binary=None):
    """Whether the job has a pane in its runtime's Ops workspace; an auto job's pane counts in either."""
    if job.get("auto") and not binary:
        binary = herdr()[0]
    pane = bool(binary) and any(label == job["name"] for _, label in ops_panes(binary)[0])
    if is_herdr(job) and not job.get("auto"):
        return pane
    if pane and job.get("auto"):
        return True
    grid = (existing.get(GRID) or [None])[0]
    return bool(grid) and any(key_of(job) in title for _, title in surfaces(grid))


def start(job, existing):
    """Start the job in its runtime's Ops workspace, closing its old cmux workspace, surface and herdr pane first (best effort); True once it started."""
    for ws in existing.get(job["name"], []):
        run(["cmux", "close-workspace", "--workspace", ws], 20)
    command = job["command"].replace("~/", os.path.expanduser("~") + "/")
    key = key_of(job)
    grid = (existing.get(GRID) or [None])[0]
    if grid:
        for ref, title in surfaces(grid):
            if key in title:
                run(["cmux", "close-surface", "--surface", ref, "--workspace", grid], 20)
    binary = herdr()[0]
    for pane, label in ops_panes(binary)[0] if binary else []:
        if label == job["name"]:
            hr(binary, "pane", "close", pane)
    if is_dashboard(job):
        stop_dashboard()
    cwd = os.path.expanduser(job["cwd"])
    if is_herdr(job):
        return start_herdr(job, binary, command, cwd)
    if grid and surfaces(grid):
        members = surfaces(grid)
        # full-height columns only, never a grid, since columns give more room
        code, out = run(["cmux", "new-split", "right", "--workspace", grid, "--surface", members[-1][0], "--command", f"cd {cwd} && exec python3 -I {ONCE} {job['name']} {command}", "--focus", "false"], 30)
    else:
        code, out = run(["cmux", "new-workspace", "--name", GRID, "--cwd", cwd, "--command", f"exec python3 -I {ONCE} {job['name']} {command}", "--focus", "false"], 30)
    log(f"started {job['name']} in {GRID}: {'ok' if code == 0 else one_line_answer(out)}")
    return code == 0


JOBS_RENDER = os.path.join(os.path.dirname(os.path.dirname(HERE)), "packages", "scripts", "src", "playground", "jobs.ts")


def render_jobs():
    """jobs.json from the store's job settings, each org's script folders under ops, and each enabled launchd job's plist into ops/launch-agents, which launchd does not read until the switch; a machine with no store keeps its own jobs.json, and one whose store read is refused keeps the last and logs why."""
    bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
    if not (os.path.exists(bun) and os.path.exists(JOBS_RENDER)):
        return
    try:
        r = subprocess.run([bun, "--no-env-file", JOBS_RENDER, "render", "--data", os.path.dirname(OPS), "--jobs", os.path.join(OPS, "jobs.json"), "--launch-agents", os.path.join(OPS, "launch-agents")],
                           capture_output=True, text=True, timeout=60)
    except Exception as e:
        log(f"jobs.json kept: {e}")
        return
    if r.returncode == 0 and "unchanged" not in r.stdout:
        log(r.stdout.strip())
    elif r.returncode not in (0, 3):
        log(f"jobs.json kept: {one_line_answer(r.stderr or r.stdout)}")


def up(quiet):
    render_jobs()
    jobs = json.load(open(os.path.join(OPS, "jobs.json")))["jobs"]
    existing = workspaces()
    try:
        starts = json.load(open(STARTS))
    except Exception:
        starts = {}
    skip = os.environ.get("OPS_UP_SKIP", "")
    procs = ptable.table()
    cmux = ptable.cmux_of(os.getpid(), procs)
    held = cmux_held(procs) if any(job.get("runtime") == "auto" for job in jobs) else True
    stranded = False
    holders = {job["name"]: once.running(job["name"], marker(job)) if job.get("command") else None for job in jobs}
    beats = {job["name"]: beat_pid(job) for job in jobs if job.get("heartbeat")}
    gone = deleted({pid for pid in [*holders.values(), *beats.values()] if pid})
    for job in jobs:
        job = placed(job, held)
        holder = holders[job["name"]]
        if job.get("disabled"):
            # a paused job stops itself here: ops-up started it through once.py, so its recorded pid is ours to signal
            if holder and not is_dashboard(job):
                os.kill(holder, 15)
                log(f"{job['name']} is paused; stopped its loop, pid {holder}")
            continue
        if job["name"] == skip or time.time() - (starts.get(job["name"]) or 0) < GRACE:
            continue
        ok, why = healthy(job, procs, cmux)
        # a heartbeat pid counts only with a holder to stop, or for a job ops-up never starts; with neither, a start would run a second copy beside it
        stale = stale_of(holder, beats.get(job["name"]) if holder or not job.get("command") else None, gone)
        if ok and stale:
            ok, why = False, stale
        if ok:
            if job.get("auto") and not is_herdr(job) and not cmux and holder in procs and not ptable.cmux_of(holder, procs):
                # only a pass inside cmux moves it back, and spawn.sh's panes run bash; ops hears it by two routes, notify.sh once a holder and ops-tick's relay of the printed line once until it changes
                said = f"{job['name']} runs outside cmux while cmux holds a factory session; a pass inside cmux moves it back, so open a cmux terminal"
                key = f"{job['name']}:{holder}:cmux"
                if key not in starts.get("_reported", []):
                    starts.setdefault("_reported", []).append(key)
                    log(said)
                    run(["env", "NOTIFY_MAC=1", os.path.join(HERE, "notify.sh"), "up", said], 60)
                if not quiet:
                    print(said)
            continue
        binary = None
        if is_herdr(job):
            # checked before any stop, so a job moving to a herdr that cannot take it keeps its old copy
            binary, refused = herdr()
            if not binary:
                log(f"{job['name']} unhealthy ({why}); not starting it in herdr: {refused}")
                if not quiet:
                    print(f"{job['name']} is down, and herdr cannot start it: {refused}")
                continue
        elif job.get("needsCmux") and not cmux:
            log(f"{job['name']} unhealthy ({why}); not starting it in cmux: this pass runs outside cmux, which answers only its own terminals")
            if not quiet:
                print(f"{job['name']} is down, and this pass runs outside cmux, which answers only its own terminals; a pass inside cmux starts it, so open a cmux terminal")
            stranded = stranded or is_dashboard(job)
            continue
        moved = elsewhere(job, holder, procs, cmux, stale)
        if moved:
            # orphaned by a cmux restart, or left in its old runtime: ops-up started it through once.py, so its recorded pid is ours to signal; its trap stops its children
            os.kill(holder, 15)
            for _ in range(60):
                if not alive(holder):
                    break
                time.sleep(1)
            if alive(holder):
                log(f"{job['name']} pid {holder} {moved} and outlived its TERM by 60s; the next pass tries again")
                continue
            log(f"{job['name']} pid {holder} {moved}; stopped it")
        elif holder and not in_grid(job, existing, binary):
            # a live copy with no pane in Ops (an orphan): starting another would stack a second supervisor, so report it
            key = f"{job['name']}:{holder}"
            if key not in starts.get("_reported", []):
                starts.setdefault("_reported", []).append(key)
                run([os.path.join(HERE, "notify.sh"), "up", f"{job['name']} is {why} but its loop, pid {holder}, is still alive; not starting a second copy"], 60)
            log(f"{job['name']} unhealthy ({why}) but pid {holder} still holds it; not starting another")
            continue
        if not job.get("needsCmux") and not is_herdr(job):
            if stale:
                # launchd keeps it alive and ops-up never started it, so it is reported, never signalled
                key = f"{job['name']}:{beats.get(job['name'])}:deleted"
                if key not in starts.get("_reported", []):
                    starts.setdefault("_reported", []).append(key)
                    run([os.path.join(HERE, "notify.sh"), "up", f"{job['name']} pid {beats.get(job['name'])} runs a deleted executable ({gone[beats.get(job['name'])]}); launchd job {job.get('launchd')} keeps it alive, so restart it there"], 60)
            log(f"{job['name']} unhealthy ({why}); launchd job {job.get('launchd')} keeps it alive")
            continue
        log(f"{job['name']} unhealthy ({why}); starting")
        # the printed line is told to ops once until it changes, so a heartbeat's age stays out of it
        told = re.sub(r"\d+m old", "stale", why)
        # only a job that started waits out GRACE; a failed start is tried again on the next pass
        if start(job, existing):
            starts[job["name"]] = time.time()
            with open(STARTS, "w") as f:
                json.dump(starts, f)
            if not quiet:
                print(f"started {job['name']} in {'herdr' if is_herdr(job) else 'cmux'} ({told})")
        elif not quiet:
            print(f"could not start {job['name']} in {'herdr' if is_herdr(job) else 'cmux'} ({told}); see {LOG}")
    with open(STARTS, "w") as f:
        json.dump(starts, f)
    return held, stranded


def roster_kinds():
    """Each roster name's kind; empty when the roster does not read."""
    try:
        agents = json.load(open(os.path.join(DATA, "roster.json"))).get("agents") or []
        return {a["name"]: a["kind"] for a in agents if isinstance(a, dict) and isinstance(a.get("name"), str) and isinstance(a.get("kind"), str)}
    except Exception:
        return {}


def command_of(pid):
    return run(["ps", "-o", "command=", "-p", str(pid)], 20)[1].strip()


def guarded(command):
    """Whether a claude command line loads the factory's hooks: a --settings file that names no-playground-leak."""
    words = command.split()
    for i, w in enumerate(words):
        path = words[i + 1] if w == "--settings" and i + 1 < len(words) else w[len("--settings="):] if w.startswith("--settings=") else ""
        try:
            if path and "no-playground-leak" in open(os.path.expanduser(path)).read():
                return True
        except OSError:
            pass
    return False


def covered(cwd):
    """Whether the project settings a session in cwd loads carry the factory's hooks: Claude Code reads .claude/settings.json in the session's own folder, not its checkout's root (measured with claude -p)."""
    try:
        return "no-playground-leak" in open(os.path.join(cwd or "/", ".claude", "settings.json")).read()
    except OSError:
        return False


def unguarded(command_of=command_of):
    """[(name, pid, cwd)] for each live factory session whose --settings and project settings both lack the factory's hooks: one cmux restored in a folder whose project settings do not carry them."""
    rows = []
    for f in sorted(glob.glob(os.path.join(REGISTRY, "sessions", "*.json"))):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        name, pid, cwd = d.get("name") or "", d.get("pid", 0), d.get("cwd") or ""
        if alive(pid) and not covered(cwd):
            rows.append((name, pid, cwd))
    factory = in_factory([name for name, _, _ in rows])
    if factory is None:
        print("up: the factory rule in kinds.ts did not read through Bun, so no session is checked for the factory's hooks", file=sys.stderr)
        return []
    found = []
    for name, pid, cwd in rows:
        if name not in factory:
            continue
        command = command_of(pid)
        # a crashed session's file can name a pid macOS has since given to another process
        if re.match(r"(?:\S*/)?claude(?:\s|$)", command) and not guarded(command):
            found.append((name, pid, cwd))
    return found


def sessions():
    """Print, for each live-roster session, the command that brings it back with a handoff line, then each factory session to respawn for lack of its hooks."""
    roster = json.load(open(os.path.join(DATA, "roster.json")))
    running = set()
    for f in glob.glob(os.path.join(REGISTRY, "sessions", "*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if d.get("name") and alive(d.get("pid", 0)):
            running.add(d["name"])
    ids = {}
    for f in glob.glob(os.path.join(REGISTRY, "projects", "*", "*.jsonl")):
        try:
            with open(f, "rb") as fh:
                fh.seek(max(0, os.path.getsize(f) - 200_000))
                tail = fh.read().decode("utf-8", "ignore")
        except Exception:
            continue
        names = re.findall(r'"agentName":"([^"]+)"', tail)
        cwds = re.findall(r'"cwd":"([^"]+)"', tail)
        models = re.findall(r'"model":"((?:claude|glm)-[^"]*)"', tail)
        if names and cwds:
            prev = ids.get(names[-1])
            if not prev or os.path.getmtime(f) > prev[1]:
                glm = bool(models) and models[-1].startswith("glm-")
                ids[names[-1]] = (os.path.basename(f)[:-6], os.path.getmtime(f), cwds[-1], glm)
    for a in roster.get("agents", []):
        n = a.get("name")
        if a.get("status") in ("ended", "paused") or n in running or n not in ids:
            continue
        sid, _, cwd, glm = ids[n]
        # a resume takes --backend only while no pin stands: with one, the pin decides and a flag is refused
        backend = "" if os.path.isfile(os.path.join(DATA, "backends", n)) else (" --backend glm" if glm else " --backend claude")
        # a session comes back in its repo's main worktree, the checkout Claude Code starts sessions in: a worktree session skips the worktree the trust dialog stops a session in, and a worker started --in another folder stays in that repository; --resume finds the session from any folder (measured), and a cwd of no checkout falls back to itself, named below
        code, common = run(["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"])
        main = os.path.dirname(common.strip()) if code == 0 and common.strip() else ""
        print(f"{SPAWN} resume {n} {main or cwd} {sid}{backend}")
        if not main:
            print(f"  ({cwd} is no git checkout; it resumes there as it is)")
        print(f'  then SendMessage {n}: "cmux restarted; you were resumed from your transcript. Re-read your roster task and continue."')
    for name, pid, cwd in unguarded():
        print(f"{name} (pid {pid}, {cwd}) runs without the factory's hooks: respawn it from its handoff through {SPAWN} (playbook SESSIONS.md)")


def main():
    args = sys.argv[1:]
    if args == ["--sessions"]:
        sessions()
        return
    restarted = args[1].split(",") if len(args) == 2 and args[0] == "--restarted" else []
    lock = open(os.path.join(OPS, "up.lock"), "w")
    try:
        # a restart waits for a running pass, whose own write of STARTS would put back the starts it drops
        fcntl.flock(lock, fcntl.LOCK_EX | (0 if restarted else fcntl.LOCK_NB))
    except OSError:
        return
    if restarted:
        try:
            starts = json.load(open(STARTS))
        except Exception:
            starts = {}
        for name in restarted:
            starts.pop(name, None)
        with open(STARTS, "w") as f:
            json.dump(starts, f)
    if args == ["--once-per-cmux"]:
        sock = os.environ.get("CMUX_SOCKET_PATH", "")
        try:
            st = os.stat(sock)
            key = f"{st.st_ino}-{int(st.st_mtime)}"
        except Exception:
            return
        marker = os.path.join(OPS, "up.cmux")
        if os.path.exists(marker) and open(marker).read().strip() == key:
            return
        held, _ = up(True)
        if held:
            open(marker, "w").write(key)
        return
    _, stranded = up(False)
    if stranded:
        sys.exit(OUTSIDE_CMUX)


if __name__ == "__main__":
    main()
