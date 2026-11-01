#!/usr/bin/env python3
"""ops-unstick: no factory session sits blocked unseen .

Every CYCLE seconds it reads the screen of every live Claude Code session cmux runs (`cmux sessions list`, then `cmux read-screen` per surface)
and herdr runs (`herdr pane list`, then `herdr pane read --source visible` per pane), cmux only while Claude's registry holds a live
session, not a headless run, that no herdr pane does (cmux_may_hold), and matches the blocking states: the
usage-limit dialog, a permission prompt, a picker (AskUserQuestion, plan approval), the folder-trust and MCP-server dialogs, and
"Please run /login". The usage-limit dialog alone is answered, with Escape, and only while the usage file of the account the session's
resume record names, else the machine's own login, says it has room (and was written in the last 15 minutes: room());
it checks 5s later that the dialog cleared and no limit line before its reset
still shows. Nothing else is ever answered (no permission prompt is cancelled; the managers handle
it"): a limit dialog with no room goes to the builder and the dispatcher, a probe's to its spawner (limit_targets), and every other
block to the session's manager (alert_to), each through the outbox at first sight and every 10 minutes while it waits, naming the session, the dialog and how long it has waited, unless the session's own session-state hook
recorded it as stuck or failed (hook_owned), since that hook has told the manager already and ops-session-resume escalates it. During an account move (move.json in its state folder names the
dispatcher running it and an `until`), the per-session limit alerts wait and that dispatcher gets one summary line every 10 minutes.
A stall alarm tells the builder (AUT-7; it was dispatcher) when the
merge queue holds open PRs and no session has taken a turn in 10 minutes. state.json in its state folder (ops/unstick) lists what is blocked now. No model call; one instance (flock).
`--once` runs one pass in the foreground and prints it.
"""
import calendar, datetime, fcntl, glob, json, os, re, shutil, subprocess, sys, time

# Code beside beat.py and notify.sh in the repo's scripts/ops; LW, OPS and HERE are in the data folder, $PLAYGROUND_DATA_DIR, else ~/.playground.
CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LW = os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground"))
OPS = os.path.join(LW, "ops")
HERE = os.path.join(OPS, "unstick")
# read budget (dispatcher, 13 Oct, after cmux reached 155% CPU with ~50 sessions): a pass every 120s (ND-644, planner), under the Dashboard's 3-minute
# freshness for state.json, reading only the screens of sessions whose transcript has been quiet over QUIET_READ; one still writing is at work
CYCLE = 120
QUIET_READ = 60
REALERT = 600
LIMIT_KINDS = ("usage-limit", "usage-limit-stuck")  # a session at its usage limit, or one still showing it past its reset
STALL = 600
STARTED = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
ONCE = "--once" in sys.argv
sys.path.insert(0, CODE)
from beat import beat, checkout, setting  # noqa: E402

CHECKOUT = checkout()

# Matched against the bottom of the screen only, where a dialog or prompt sits; a transcript line quoting one scrolls above it.
BOTTOM = 30
KINDS = [
    ("usage-limit", re.compile(r"hit your [\w -]*limit|What do you want to do\?", re.I)),
    ("login", re.compile(r"Please run /login|Invalid API key|OAuth token (has )?expired", re.I)),
    ("permission", re.compile(r"Do you want to (proceed|make this edit|create|allow|run|fetch|use|overwrite)", re.I)),
    ("trust", re.compile(r"Is this a project you created or one you trust|trust this folder", re.I)),
    ("mcp", re.compile(r"new MCP servers? found|MCP servers? found in", re.I)),
    ("picker", re.compile(r"Enter to select|Would you like to proceed\?|↑/↓ to navigate|Esc to cancel · Tab", re.I)),
]
# The limit dialog proper (a menu under its question), as against the one-line notice a turn prints when it stops on the limit.
# A factory session by its name: an old name's prefix (worker-greed), or an <id>-<kind> name's last word (k3m9px-worker), as kindOfName in packages/config/src/kinds.ts reads it.
FACTORY = re.compile(r"^(?:(worker|reviewer|tester|runner|probe)-.|[23456789bcdfghjkmnpqrstvwxyz]{6}-(worker|reviewer|tester|runner|probe)$)")
FACTORY_KINDS = {"worker", "reviewer", "tester", "runner", "probe"}
_NAMES = None


def session_kinds():
    """Each manager's set name and its kind: sessions.names, the dispatcher's with -2, then sessions.aliases, read once through setting.ts as
    spawn.sh reads them; a read that fails places none, as a fresh install's role words still do by name."""
    global _NAMES
    if _NAMES is None:
        names, aliases = {}, {}
        bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
        setting = os.path.join(os.path.dirname(os.path.dirname(CODE)), "packages", "scripts", "src", "playground", "setting.ts")
        try:
            r = subprocess.run([bun, "--no-env-file", setting, "sessions.names", "sessions.aliases"], capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                names, aliases = (json.loads(line) for line in r.stdout.splitlines()[:2])
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        names = names or {k: k for k in ("builder", "dispatcher", "ops", "planner")}
        _NAMES = {**{v: k for k, v in names.items()}, f"{names['dispatcher']}-2": "dispatcher", **aliases}
    return _NAMES


def named_kind(name):
    return session_kinds().get(name)


def dispatcher_name():
    return next(n for n, k in session_kinds().items() if k == "dispatcher")


# PG-1644: a manager's or the dispatcher's <id>-<kind> name, which places by its last word with no roster row, as today's names do.
MANAGER_NAME = re.compile(r"^[23456789bcdfghjkmnpqrstvwxyz]{6}-(builder|dispatcher|ops|optimizer|planner)$")
# a lead is known by its roster kind first, so a manager respawned under a new name is one at once; notify.sh resolves a kind word
# (builder, ops) to whoever holds that seat, so every line below goes to a kind rather than a name.
LEAD_KINDS = {"builder", "ops", "planner"}
LIMIT_DIALOG = re.compile(r"What do you want to do\?", re.I)
# a dialog with no numbered options (the folder-trust dialog, the MCP-server picker) is a ❯ line above one of these key hints; the input
# box's footer never holds them. Both come before Claude Code's SessionStart, so no hook reports them, and herdr reads the MCP picker as idle.
DIALOG_HINT = re.compile(r"Enter to confirm · Esc|Space to select · Esc|Esc to reject all")
# The factory's herdr servers: each name's socket is <dir>/<name>.sock beside one config.toml, reached through HERDR_SOCKET_PATH (the CLI's
# --session ignores it). A refused or missing socket is that server down, not a fault; `pane list` starts no server. The sockets follow HOME, never
# CLAUDE_CONFIG_DIR, as ops-herdr puts them (herdrDir in packages/scripts/src/ops-herdr/herdr.ts), so every Claude login reads the same servers.
# herdr runs by the copy ops-herdr installs and pins, under the data folder of HOME alone (herdrPath in packages/scripts/src/ops-herdr/pin.ts).
HERDR = os.environ.get("HERDR_BIN_PATH") or os.path.expanduser("~/.playground/bin/herdr")
HERDR_DIR = os.environ.get("PLAYGROUND_HERDR_DIR") or os.environ.get("DESK_HERDR_DIR") or os.path.expanduser("~/.playground/herdr")
HERDR_SESSIONS = [n for n in (os.environ.get("PLAYGROUND_HERDR_SESSIONS") or os.environ.get("DESK_HERDR_SESSIONS") or "playground,playground-probes").split(",") if n]


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(line):
    with open(os.path.join(HERE, "unstick.log"), "a") as f:
        f.write(f"{now()} {line}\n")
    if ONCE:
        print(line)


def cmux(args, timeout=20):
    r = subprocess.run(["cmux", *args], capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(f"cmux {args[0]}: {(r.stderr or r.stdout).strip()[:120]}")
    return r.stdout


def herdr(server, args, timeout=20):
    env = os.environ | {"HERDR_CONFIG_PATH": os.path.join(HERDR_DIR, "config.toml"), "HERDR_SESSION": server, "HERDR_SOCKET_PATH": os.path.join(HERDR_DIR, f"{server}.sock")}
    r = subprocess.run([HERDR, *args], capture_output=True, text=True, timeout=timeout, env=env)
    if r.returncode:
        raise RuntimeError(f"herdr {' '.join(args[:2])}: {(r.stderr or r.stdout).strip()[:120]}")
    return r.stdout


def roster_kinds():
    """Each roster name's kind; empty when the roster does not read."""
    try:
        agents = json.load(open(os.path.join(LW, "roster.json"))).get("agents") or []
        return {a["name"]: a["kind"] for a in agents if isinstance(a, dict) and isinstance(a.get("name"), str) and isinstance(a.get("kind"), str)}
    except Exception:
        return {}


def kind_of(name, kinds=None):
    """A session's kind, its roster entry's first (a lead may hold any name the roster gives its kind), else its name's, as kindOf in
    packages/config/src/kinds.ts reads it; the roster is read when no kinds are given."""
    return (roster_kinds() if kinds is None else kinds).get(name) or kind_of_name(name)


def is_lead(name, kinds):
    return (kinds.get(name) or manager_kind_of_name(name) or named_kind(name)) in LEAD_KINDS


def manager_kind_of_name(name):
    m = MANAGER_NAME.match(name)
    return m.group(1) if m else None


def notify(text, to="dispatcher"):
    subprocess.run([os.path.join(CODE, "notify.sh"), "unstick", text], env=os.environ | {"NOTIFY_TO": to}, capture_output=True, timeout=30)


STUCK_ALERT = os.path.join(os.path.dirname(os.path.dirname(CODE)), "packages", "scripts", "src", "stuck-alert.ts")


def alert_to(name, transcript):
    """Who hears of a session's block: its manager, by the one table the session-state hook's alert reads (managerFor in
    packages/scripts/src/stuck-alert.ts, PG-2184): a probe's spawner (its brief's "Report to <name> with SendMessage", spawn.sh), a worker's
    or runner's lead, a lead's own to the dispatcher, as is one whose manager is down; the dispatcher when the table names none or cannot run."""
    bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
    try:
        r = subprocess.run([bun, "--no-env-file", STUCK_ALERT, "manager", name, transcript or ""], capture_output=True, text=True, timeout=20)
        to = r.stdout.strip()
        if re.fullmatch(r"[a-z0-9-]+", to):
            return to
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "dispatcher"


def prompt_answer(name, sid, lines):
    """How the manager answers a permission prompt read off the screen (answerOf in packages/scripts/src/stuck-alert.ts): `playground picker` by
    the key of the waiting call the prompt shows, a subagent's included, so a prompt whose hook record a later Stop replaced still gets a key; else
    the one route left. "" when the table cannot run."""
    bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
    try:
        r = subprocess.run([bun, "--no-env-file", STUCK_ALERT, "answer", name, sid or ""], input="\n".join(lines), capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def hook_owned(sid):
    """True when the session's own session-state hook recorded it as stuck or failed, so that hook has told its manager."""
    try:
        rec = json.load(open(os.path.join(LW, "session-state", f"{sid}.json")))
        return rec.get("state") in ("stuck", "failed")
    except (OSError, ValueError, AttributeError):
        return False


def moving(now_t=None):
    """The dispatcher an account move runs from, while move.json in the state folder names one (`to`) and its `until` (ISO 8601 with a zone)
    is still ahead; else None (dispatcher, 18 Oct: about 50 limit alerts every 10 minutes would bury the leads while dispatcher-2 resumes every
    stopped session). A move.json that does not read is logged, so a bad file shows rather than letting the full flood out unseen."""
    path = os.path.join(HERE, "move.json")
    if not os.path.exists(path):
        return None
    try:
        move = json.load(open(path))
        until = datetime.datetime.fromisoformat(move["until"].replace("Z", "+00:00"))
        if until.tzinfo is None:
            raise ValueError("until has no zone")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        log(f"move.json does not read ({e}); no move")
        return None
    to = move.get("to")
    if not (isinstance(to, str) and re.fullmatch(r"[a-z0-9-]+", to)):
        log(f"move.json names no session in to ({to!r}); no move")
        return None
    return to if (now_t or time.time()) < until.timestamp() else None


def held_for_move(kind, mover):
    """Whether a block's own alert waits for the move's summary: a limit block while a move runs."""
    return bool(mover) and kind in LIMIT_KINDS


def move_summary(blocks):
    """One line for the move's dispatcher: how many sessions the usage limit holds, then every other block by session and kind, then the
    limit sessions' names last, so notify.sh's 400-character cut trims only those names."""
    limits = sorted(b["name"] for b in blocks.values() if b["kind"] in LIMIT_KINDS)
    others = sorted(f"{b['name']} ({b['kind']})" for b in blocks.values() if b["kind"] not in LIMIT_KINDS)
    line = f"{len(limits)} session{'' if len(limits) == 1 else 's'} blocked on the usage limit. "
    line += f"Blocked for another reason: {', '.join(others)}." if others else "Nothing blocked for another reason."
    return line + (f" On the limit: {', '.join(limits)}" if limits else "")


def limit_targets(name, transcript):
    """Who hears of a session at its usage limit: the builder and the dispatcher, but a probe's spawner alone."""
    return [alert_to(name, transcript)] if kind_of(name) == "probe" else ["builder", "dispatcher"]


def limit_alert(name, line, transcript=None):
    """A session at its usage limit goes to the builder and dispatcher at once, since the owner does not slow down at a limit (
    the limit ends"), a probe's to its spawner. The script takes no option on the dialog: a key other than Escape is not its to press (**voice**)."""
    msg = f"{name} is at its usage limit and is not continuing: {line}. No slowing down at a limit; decide its next step now (another account through spawn.sh resume --account)."
    for to in limit_targets(name, transcript):
        notify(msg, to=to)


_FORCE = None


def can_force():
    """cmux 0.65 refuses a key sent into a pane on a question or dialog unless --force; 0.64 has no such flag. Read once a process, from send-key's own help (dispatcher, 14 Oct: planner sat on a permission prompt and the Escape was refused)."""
    global _FORCE
    if _FORCE is None:
        r = subprocess.run(["cmux", "send-key", "--help"], capture_output=True, text=True, timeout=20)
        _FORCE = "--force" in (r.stdout + r.stderr)
    return _FORCE


def escape(s, name, why):
    """Press Escape in one session's own surface; log every attempt with cmux's answer, and alert dispatcher when cmux refuses it."""
    if s.get("herdr"):
        via = "herdr"
        try:
            r = subprocess.CompletedProcess([], 0, herdr(s["herdr"], ["pane", "send-keys", s["pane"], "esc"]), "")
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as e:
            r = subprocess.CompletedProcess([], 1, "", str(e))
    else:
        via = "cmux"
        args = ["cmux", "send-key", *(["--force"] if can_force() else []), "--workspace", s["workspace_id"], "--surface", s["surface_id"], "escape"]
        r = subprocess.run(args, capture_output=True, text=True, timeout=20)
    answer = " ".join((r.stdout + r.stderr).split())[:200] or "no output"
    log(f"{name}: Escape for {why}{' (--force)' if via == 'cmux' and can_force() else ''} through {via}: exit {r.returncode}: {answer}")
    if r.returncode:
        notify(f"ops-unstick: {via} refused the Escape on {name} ({why}): {answer}", to=alert_to(name, s.get("transcript_path")))
        return False, answer
    return True, answer


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


def name_of(s):
    try:
        reg = json.load(open(os.path.join(os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude")), "sessions", f"{s['pid']}.json")))
        if reg.get("name"):
            return reg["name"]
    except (OSError, ValueError, KeyError):
        pass
    args = s.get("launch_arguments") or s.get("stored_pid_arguments") or []
    for i, a in enumerate(args[:-1]):
        if a in ("-n", "--name"):
            return args[i + 1]
    return s.get("title") or f"session {s['session_id'][:8]}"


def herdr_sessions():
    """Every pane on the factory's herdr servers whose foreground process is claude, in the shape cmux's sessions take: its surface is
    `herdr:<server>:<pane id>`, the form the Dashboard is to read, its argv stands for the launch arguments, and the registry entry at its pid,
    once SessionStart wrote one, gives the session id and transcript."""
    cfg = os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude"))
    out = []
    for server in HERDR_SESSIONS:
        if os.path.exists(os.path.join(HERDR_DIR, f"{server}.sock")):
            out += herdr_panes(server, cfg)
    return out


def herdr_panes(server, cfg):
    try:
        panes = json.loads(herdr(server, ["pane", "list"])).get("result", {}).get("panes", [])
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired):
        return []
    out = []
    for p in panes:
        try:
            info = json.loads(herdr(server, ["pane", "process-info", "--pane", p["pane_id"]]))["result"]["process_info"]
        except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired):
            continue
        proc = next((x for x in info.get("foreground_processes", []) if x.get("name") == "claude"), None)
        if not proc:
            continue
        pid = str(proc["pid"])
        try:
            sid = json.load(open(os.path.join(cfg, "sessions", f"{pid}.json"))).get("sessionId")
        except (OSError, ValueError):
            sid = None
        found = glob.glob(os.path.join(cfg, "projects", "*", f"{sid}.jsonl")) if sid else []
        surface = f"herdr:{server}:{p['pane_id']}"
        out.append({"herdr": server, "launch_arguments": proc.get("argv"), "pane": p["pane_id"], "pid": pid, "session_id": sid or surface, "surface_id": surface,
                    "surface_ref": surface, "title": "", "transcript_path": found[0] if found else None, "workspace_id": p.get("workspace_id") or ""})
    return out


# A start as `ps -o lstart=` prints it under C (`Mon Oct  5 23:37:23 2026`), the one shape a registry procStart is compared in (peers.ts).
LSTART = re.compile(r"^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$")


def cmux_may_hold(found):
    """Whether cmux may run a session: one live in Claude's registry, any but a headless run (entrypoint sdk-cli, as spawn.sh reads it),
    its procStart the pid's start now, that no herdr pane in `found` holds. Read with no cmux call, so a factory all on herdr asks cmux nothing;
    a registry file that does not read, a ps that cannot run, or a procStart not in lstart's shape (peers.ts's rule) counts as yes, and cmux is
    asked as before. A session under another Claude config folder is not in this registry."""
    entries = {}
    for path in glob.glob(os.path.join(os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude")), "sessions", "*.json")):
        pid = os.path.basename(path)[:-5]
        if not pid.isdigit():
            continue
        try:
            d = json.load(open(path))
        except (OSError, ValueError):
            return True
        if isinstance(d, dict) and d.get("entrypoint") != "sdk-cli":
            entries[pid] = d
    pids = sorted(set(entries) - {s["pid"] for s in found})
    if not pids:
        return False
    try:
        out = subprocess.run(["ps", "-o", "pid=,lstart=", "-p", ",".join(pids)], capture_output=True, text=True, timeout=20, env=os.environ | {"LC_ALL": "C", "TZ": "UTC"}).stdout
    except (OSError, subprocess.TimeoutExpired):
        return True
    starts = {p[0]: " ".join(p[1].split()) for p in (l.split(None, 1) for l in out.splitlines()) if len(p) == 2}
    for pid in pids:
        start = entries[pid].get("procStart")
        if pid in starts and (not isinstance(start, str) or not LSTART.match(start) or " ".join(start.split()) == starts[pid]):
            return True
    return False


def sessions():
    """cmux's sessions and herdr's; cmux is asked only while it may hold one, and its failing fails the cycle only when herdr runs no session either."""
    found = herdr_sessions()
    if not cmux_may_hold(found):
        return found
    try:
        return cmux_sessions() + found
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired):
        if found:
            return found
        raise


def cmux_sessions():
    """Every terminal surface in cmux's tree (every window, every pane, so a session sharing a workspace counts) whose tty runs Claude Code,
    with its pid, name and transcript; cmux's session list can name a workspace the surface has left, so the tree is the map."""
    tree = json.loads(cmux(["tree", "--all", "--json", "--id-format", "both"], 30))
    ps = subprocess.run(["ps", "-A", "-o", "pid=,tty=,comm="], capture_output=True, text=True, timeout=20).stdout
    by_tty = {}
    for row in ps.splitlines():
        parts = row.split(None, 2)
        if len(parts) == 3 and os.path.basename(parts[2].strip()) == "claude":
            by_tty.setdefault(parts[1], parts[0])
    try:
        listed = {str(x.get("pid")): x for x in json.loads(cmux(["sessions", "list", "--json", "--limit", "500"], 30)).get("sessions", [])}
    except (RuntimeError, ValueError):
        listed = {}
    out = []
    for w in tree.get("windows", []):
        for ws in w.get("workspaces", []):
            for pane in ws.get("panes", []):
                for sf in pane.get("surfaces", []):
                    tty = (sf.get("tty") or "").removeprefix("/dev/")
                    pid = by_tty.get(tty)
                    if sf.get("type") != "terminal" or not pid:
                        continue
                    x = listed.get(pid, {})
                    out.append({"launch_arguments": x.get("launch_arguments"), "pid": pid, "session_id": x.get("session_id") or f"tty-{tty}",
                                "surface_id": sf.get("id") or sf["ref"], "surface_ref": sf["ref"], "title": re.sub(r"^\W+\s*", "", sf.get("title") or ""), "transcript_path": x.get("transcript_path"),
                                "workspace_id": ws.get("id") or ws["ref"]})
    return out


def screen(s):
    if s.get("herdr"):
        text = herdr(s["herdr"], ["pane", "read", s["pane"], "--source", "visible"])
    else:
        text = cmux(["read-screen", "--workspace", s["workspace_id"], "--surface", s["surface_id"]])
    return [l for l in text.splitlines()][-BOTTOM:]


def blocked(lines):
    """A prompt counts only as a live menu: its question within the bottom 15 lines and a selected numbered option (❯ 1.) below it, with no
    spinner still running; a transcript line quoting the question has no menu under it. /login has no menu, so it must sit in the last 8."""
    tail = lines[-15:]
    if any("esc to interrupt" in l for l in tail):
        return None, ""
    if any(re.search(r"Please run /login|Invalid API key|OAuth token (has )?expired", l, re.I) for l in lines[-8:]):
        return "login", next(l.strip() for l in lines[-8:] if re.search(r"/login|API key|OAuth", l, re.I))[:100]
    # a menu's selected first option has a second option within the next 3 lines, and no input-box rule right above it (a draft typed there)
    menu = next((i for i, l in enumerate(tail) if re.match(r"^\s*[│ ]*❯\s*1\.", l)
                 and any(re.match(r"^\s*[│ ]*\s*2\.", m) for m in tail[i + 1:i + 4])
                 and not (i and re.match(r"^\s*─{3,}", tail[i - 1]))), None)
    if menu is None:
        hint = next((i for i, l in enumerate(tail) if DIALOG_HINT.search(l)), None)
        if hint is None or not any(re.match(r"^\s*[│ ]*[↓↑ ]*❯", l) for l in tail[max(0, hint - 12):hint]):
            return None, ""
        menu = hint
    above = tail[: menu + 1]
    for kind, rx in KINDS:
        hit = next((l.strip() for l in above if rx.search(l)), None)
        if hit:
            return kind, hit[:100]
    return "picker", next((l.strip() for l in reversed(above[:-1]) if l.strip()), "a numbered menu")[:100]


def room(name):
    """Whether the session's own account has room, with why: the account session_account() names, judged by its newest usage file
    (the optimizer sat on one account at 100% of its week while another had room, and its dialog was escaped; a hand list of
    sessions on the other account drifted from the resume records). Every file counts as fresh for 15 minutes, where spawn.sh trusts
    another login's for 60, so a doubtful reading leaves the dialog up."""
    acct = session_account(name)
    if acct == "glm":
        return False, "a GLM session, which no usage file reads"
    u = readings().get(acct)
    if not u:
        return False, "no usage file reads " + (acct or "this machine's own login")
    try:
        fresh = time.time() - calendar.timegm(time.strptime(u["writtenAt"], "%Y-%m-%dT%H:%M:%SZ")) < 900
        used = {label: (u["rate_limits"].get(w) or {}).get("used_percentage") for label, w in (("5h", "five_hour"), ("7d", "seven_day"))}
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        return False, f"{acct}'s usage file unreadable ({type(e).__name__})"
    used = {label: pct for label, pct in used.items() if isinstance(pct, (int, float))}
    ok = fresh and "7d" in used and all(pct < 100 for pct in used.values())
    return ok, f"{acct}: " + ", ".join(f"{label} {pct}%" for label, pct in used.items())


def ago(t):
    m = int((time.time() - t) // 60)
    return f"{m}m" if m < 60 else f"{m // 60}h{m % 60:02d}m"


def stall(live, state):
    newest = 0.0
    for s in live:
        p = s.get("transcript_path")
        try:
            newest = max(newest, os.path.getmtime(p)) if p else newest
        except OSError:
            pass
    if not newest or time.time() - newest < STALL:
        state.pop("stall", None)
        return None
    try:
        q = json.load(open(os.path.join(LW, "merge-queue.json"))).get("queue", [])
    except (OSError, ValueError):
        q = []
    prs = [str(i.get("pr")) for i in q if i.get("pr")]
    if not prs:
        return None
    r = subprocess.run(["gh", "pr", "list", "--repo", setting("factory.repo"), "--state", "open", "--json", "number", "--jq", ".[].number"], capture_output=True, text=True, timeout=60)
    open_prs = [p for p in prs if p in r.stdout.split()]
    if not open_prs:
        return None
    last = state.get("stall", 0)
    if time.time() - last >= REALERT:
        state["stall"] = time.time()
        msg = f"stall: no factory session has taken a turn in {ago(newest)} while the merge queue holds open PRs ({', '.join('#' + p for p in open_prs[:8])})"
        notify(msg, to="builder")  # AUT-7: the merge-queue idle alarm is the builder's to clear, not dispatcher's
        log(msg)
    return f"stall {ago(newest)}"


# dispatcher, 8 Oct (load 80 on 15 cores, the dashboard 5.7s): at most 2 heavy jobs at once (3 while slot 3 is open). A heavy job is a full suite, a
# build or type check, or a dev stack other than the live dashboard's. slot_alerts says which of them raise the outside-slot alert.
HEAVY = re.compile(r"(NODE_ENV=test bun test|(^|/)bun test tests|bun run test(:skills)?\b|turbo run (build|check-types)|api/hono/src/bin/dev\.ts)")


ORGS = None


def org_owners():
    """The GitHub orgs ext.links guards, lowercase, whose folders in the home folder hold a company's checkouts; read once a process, none when the reader cannot answer."""
    global ORGS
    if ORGS is None:
        try:
            ORGS = setting("--guarded-orgs")
        except SystemExit:
            ORGS = []
    return ORGS


# every slot run-slot.sh takes, in its clear-stale list's order, the CPU slots first as its held_units lists them, which tests hold these to; each model slot is found by its name
CPU_SLOTS = ("run-slot", "run-slot-2", "run-slot-3", "run-slot-4")
SLOTS = (*CPU_SLOTS, "run-slot-commit", "run-slot-clone", "run-slot-quick")


def slot_names():
    try:
        models = sorted({m.group(1) for m in (re.match(r"^(run-slot-model-[0-9]+)(\.holder)?$", f) for f in os.listdir(OPS)) if m})
    except OSError:
        models = []
    return [*SLOTS, *models]


def heavy_jobs(rows=None):
    if rows is None:
        rows = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,command="], capture_output=True, text=True, timeout=20).stdout.splitlines()
    parent, cmds = {}, {}
    for line in rows:
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit():
            parent[parts[0]], cmds[parts[0]] = parts[1], parts[2]
    holders = set()
    for name in slot_names():
        try:
            if os.path.isdir(os.path.join(OPS, name)):
                holders.add(open(os.path.join(OPS, name + ".holder")).read().split()[1])
        except (OSError, IndexError):
            pass
    jobs, seen = [], set()
    for pid, cmd in cmds.items():
        # the program itself must be bun, node, turbo, tsc or next: a shell whose argv merely holds the words (Claude Code's Bash wrapper,
        # `zsh -c ... eval '<command>'`) is never a job (builder, 8 Oct)
        if not HEAVY.search(cmd) or not re.match(r"^(\S*/)?(bun|node|turbo|tsc|next)(\s|$)", cmd):
            continue
        chain, p = [], parent.get(pid)
        while p and p not in ("0", "1") and len(chain) < 40:
            chain.append(p)
            p = parent.get(p)
        # one job per tree: skip a heavy process whose ancestor is itself a heavy process already counted
        if any(a in cmds and HEAVY.search(cmds[a]) for a in chain):
            continue
        cwd = subprocess.run(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"], capture_output=True, text=True, timeout=10).stdout
        # a self-hosted runner's CI job runs the workflow's own steps, so it takes no run slot; it still counts toward the cap
        if "/mac-runners/" in cwd or any("/mac-runners/" in cmds.get(a, "") for a in chain):
            if ("mac-runner", "ci job") not in seen:
                seen.add(("mac-runner", "ci job"))
                jobs.append({"inside": False, "kind": "ci job", "pid": pid, "where": "mac-runner"})
            continue
        m = re.search(r"worktrees/([A-Za-z0-9._-]+)", cwd + " " + cmd) or next((o for o in (re.search(rf"/{re.escape(org)}/([A-Za-z0-9._-]+)", cwd + " " + cmd, re.I) for org in org_owners()) if o), None)
        where = m.group(1) if m else "?"
        if where in ("canary", "desk") and "dev.ts" in cmd:
            continue  # the live dashboard's own stack (its worktree read canary before the dashboard one)
        if (where, "dev" if "dev.ts" in cmd else "suite") in seen:
            continue
        seen.add((where, "dev" if "dev.ts" in cmd else "suite"))
        # inside a slot when run-slot.sh (the holder pid) is one of its ancestors
        jobs.append({"inside": bool(holders & set(chain)), "kind": "dev stack" if "dev.ts" in cmd else "suite", "pid": pid, "where": where})
    return jobs


# the cap is one per CPU slot held or open now, which run-slot.sh's `slots` counts by its own load rules and off-switches; a read that fails allows every CPU slot, so the pass's outside-slot alerts still go
def heavy_cap():
    try:
        out = subprocess.run(["bash", os.path.join(CODE, "run-slot.sh"), "slots"], env=os.environ | {"RUN_SLOT_OPS": OPS}, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        out = ""
    if out.isdigit():
        return int(out)
    log(f"run-slot.sh slots gave no count ({out!r}), so the heavy-job cap reads {len(CPU_SLOTS)}")
    return len(CPU_SLOTS)


def slot_alerts(jobs, cap, at):
    """outside-slot for a suite or build with no run-slot holder above it; a dev stack holds no slot (run-slot refuses `bun run dev`) and a
    self-hosted runner's CI job takes none, so neither raises one, but each still counts toward the cap."""
    alerts = []
    for j in jobs:
        if not j["inside"] and j["kind"] not in ("ci job", "dev stack"):
            alerts.append({"at": at, "kind": "outside-slot", "line": f"a {j['kind']} runs outside the run slots (pid {j['pid']}); use run-slot.sh", "name": j["where"], "since": at})
    if len(jobs) > cap:
        alerts.append({"at": at, "kind": "heavy-jobs", "line": f"{len(jobs)} heavy jobs at once (cap {cap}): " + ", ".join(f"{j['where']} {j['kind']}" for j in jobs), "name": "machine", "since": at})
    return alerts


# Claude Code now waits out a usage limit by itself ("Usage limit reached · continuing automatically at 12:20am"), so there is no dialog to
# clear; a session still showing the limit line more than 2 minutes past the reset time printed on it is stuck, and dispatcher or the Builder nudges it.
# Before that reset the line is a usage-limit block (18 Oct: "⎿ You've hit your weekly limit · resets Oct 20 at 9:30pm" sat unseen on 5 sessions).
LIMIT_LINE = re.compile(r"(Usage limit reached|hit your [\w -]*?limit)[^\n]*?resets? (?:at )?(?:([A-Z][a-z]{2,8}) (\d{1,2}),? at )?(\d{1,2}(?::\d\d)?\s*[ap]m)", re.I)


LIVE_SECONDS = 60


def transcript_live(s, now=None):
    """True when the session's transcript was written in the last LIVE_SECONDS: a session at work is not stuck, whatever its scrollback shows
    (13 Oct: dispatcher, working normally, read as usage-limit-stuck from an old limit line, which held the owner's queued message as a picker)."""
    p = s.get("transcript_path")
    try:
        return bool(p) and (now or time.time()) - os.path.getmtime(p) < LIVE_SECONDS
    except OSError:
        return False


def limit_line(lines):
    """The limit line and how far past its printed reset it is, in seconds (negative before it), when the screen still shows it and no turn runs;
    else None. A reset with no date is that clock time within 12 hours ahead, or a weekly limit's from an hour gone to 23 ahead ("resets
    7:30pm" read at 02:10 was that evening's, and a gone reset reads as gone for the escape, which fires 2 minutes past); one with a date is
    that date this year, moved a year when that puts it over half a year away."""
    import datetime as _dt
    tail = "\n".join(lines[-12:])
    if re.search(r"Usage limit reset|esc to interrupt", tail):
        return None
    m = None
    for m in LIMIT_LINE.finditer(tail):
        pass
    if not m:
        return None
    raw = m.group(4).replace(" ", "").lower()
    try:
        t = _dt.datetime.strptime(raw, "%I:%M%p" if ":" in raw else "%I%p").time()
        now = _dt.datetime.now()
        day = _dt.datetime.strptime(f"{now.year} {m.group(2)[:3]} {m.group(3)}", "%Y %b %d") if m.group(2) else None
    except ValueError:
        return None
    if day:
        at = _dt.datetime.combine(day.date(), t)
        if at - now > _dt.timedelta(days=183):
            at = at.replace(year=now.year - 1)
        elif now - at > _dt.timedelta(days=183):
            at = at.replace(year=now.year + 1)
    else:
        at = _dt.datetime.combine(now.date(), t)
        if "week" in m.group(1).lower():
            if at - now > _dt.timedelta(hours=23):
                at -= _dt.timedelta(days=1)
            elif now - at > _dt.timedelta(hours=1):
                at += _dt.timedelta(days=1)
        elif at - now > _dt.timedelta(hours=12):
            at -= _dt.timedelta(days=1)
    return m.group(0).strip()[:100], (now - at).total_seconds()


def read_block(lines, s):
    """The screen's block, its line and its limit line (limit_line's pair, or None): a live menu first, else a limit line before its reset
    is a usage-limit block ("⎿ You've hit your weekly limit · resets Oct 20 at 9:30pm" sat unseen on 5 sessions)."""
    kind, line = blocked(lines)
    stuck = None if kind else limit_line(lines)
    if stuck and transcript_live(s):
        stuck = None  # the limit line is old scrollback: the session wrote a transcript line in the last minute (dispatcher, 13 Oct)
    if stuck and stuck[1] <= 120:
        kind, line = "usage-limit", stuck[0]  # paused on the limit until its reset
    return kind, line, stuck


def dialog_room(name, lines):
    """Whether to Escape the usage-limit dialog, with why: the account has room, or the reset the screen prints passed 2 minutes ago."""
    has_room, why = room(name)
    past = limit_line(lines)
    if not has_room and past and past[1] > 120:
        has_room, why = True, f"its reset ({past[0]}) passed {int(past[1] // 60)}m ago"  # dispatcher, 18 Oct: a stalled factory writes no fresh usage.json, so the printed reset decides; the api-stop path then sends the carry-on
    return has_room, why


# autoMemoryEnabled is false and the memory folders were archived (8 Oct): any file under ~/.claude/projects/*/memory/ other than the one-line
# MEMORY.md pointer is new memory a session wrote anyway; name it, its originSessionId and that session's name (builder, 9 Oct)
POINTER = "Learnings live in the playground repo; see AGENTS.md."


def memory_files():
    import glob as _glob
    cfg = os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude"))
    names = {}
    for f in _glob.glob(os.path.join(cfg, "sessions", "*.json")):
        try:
            d = json.load(open(f))
            names[d.get("sessionId")] = d.get("name")
        except (OSError, ValueError):
            pass
    found = []
    for path in _glob.glob(os.path.join(cfg, "projects", "*", "memory", "*")):
        if not os.path.isfile(path):
            continue
        try:
            text = open(path, errors="replace").read()
        except OSError:
            continue
        if os.path.basename(path) == "MEMORY.md" and text.strip() == POINTER:
            continue
        m = re.search(r"originSessionId:\s*([0-9a-f-]{36})", text)
        sid = m.group(1) if m else None
        rel = os.path.relpath(path, os.path.join(cfg, "projects"))
        found.append({"at": now(), "kind": "memory-file", "line": f"{rel} (originSessionId {sid or 'unknown'})", "name": names.get(sid) or (sid[:8] if sid else "unknown session"),
                      "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(path)))})
    return found


# A turn that ends on "API Error: Server
# error mid-response" puts no prompt on screen, so the session sits idle with nothing to answer; read it from the transcript instead
API_IDLE = 120  # dispatcher, 18 Oct: worker-sharp-quill sat on "Connection lost mid-response"; resume after 2 minutes idle
API_ESCALATE = 600  # still idle 10 minutes after its resume line: its lead hears


def kind_of_name(name):
    m = FACTORY.match(name)
    return (m.group(1) or m.group(2)) if m else None


def lead_of(name):
    kind = kind_of(name)
    if kind in ("worker", "reviewer", "tester"):
        return "builder"
    if kind == "runner":
        return "ops"
    if "dispatcher" in (named_kind(name), manager_kind_of_name(name)):
        second = name == second_dispatcher() or (name.endswith("-2") and named_kind(name[:-2]) == "dispatcher")
        return "dispatcher" if second else "builder"
    return "dispatcher"


def second_dispatcher():
    """The dispatcher the roster seats in the second slot, by roster.ts who (dispatcherOf in packages/config/src/kinds.ts), else the dispatcher's name with -2;
    it answers to the first dispatcher, while the first answers to the builder."""
    bun = shutil.which("bun") or os.path.expanduser("~/.bun/bin/bun")
    try:
        r = subprocess.run([bun, os.path.join(os.path.dirname(CODE), "roster.ts"), "who", "dispatcher", "2"], capture_output=True, text=True, timeout=30)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else f"{dispatcher_name()}-2"
    except (OSError, subprocess.SubprocessError):
        return f"{dispatcher_name()}-2"


def resume_owned(sid, error_at):
    """True when the session's own hooks recorded this stop, so ops-session-resume sends its line: a usage limit with its reset, a
    reset after the error line, whose carry-on comes from Claude Code itself when it announced its own continue in the transcript, and from
    ops-session-resume on every other limit; or a failed turn, its record written by the StopFailure hook at or after the error
    line. A record from an earlier stop (herdr and cmux restore a session without its --settings, so outside a playground checkout its hooks
    stop) leaves the line to this job."""
    import datetime as _dt
    parse = lambda t: _dt.datetime.fromisoformat(t.replace("Z", "+00:00"))
    try:
        rec = json.load(open(os.path.join(LW, "session-state", f"{sid}.json")))
        at = parse(error_at)
        if rec.get("state") == "failed":
            return parse(rec["at"]) >= at
        return rec.get("state") == "usage-limit" and parse(rec["resetsAt"]) > at
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def quiet_for(path, now_t):
    """Seconds since the transcript's newest timestamped line that is not a `queue-operation`, which every message queued to the session
    writes, a stuck one's included; since the file changed when that line does not read, or the tail holds none. Raises OSError when
    the file cannot be read."""
    age = now_t - os.path.getmtime(path)
    if age >= QUIET_READ:
        return age
    with open(path, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 65536))
        tail = f.read().decode(errors="replace").splitlines()
    for raw in reversed(tail):
        try:
            entry = json.loads(raw)
        except ValueError:
            return age
        if not isinstance(entry, dict):
            return age
        # Claude Code writes a group of lines with no timestamp (last-prompt, custom-title, mode and the like), often just after a tool call
        if entry.get("type") == "queue-operation" or "timestamp" not in entry:
            continue
        try:
            return now_t - datetime.datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00")).timestamp()
        except (AttributeError, TypeError, ValueError):
            return age
    return age


def api_error_stop(s, now_t):
    """(entry id, its text, idle seconds) when the session's newest user or assistant entry is an API error line and its transcript has
    been quiet API_IDLE seconds; else None. A usage limit or a failed turn its hooks recorded is ops-session-resume's, so it is left out here."""
    p = s.get("transcript_path")
    try:
        idle = now_t - os.path.getmtime(p or "")
        if idle < API_IDLE:
            return None
        with open(p, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 262144))
            tail = f.read().decode(errors="replace").splitlines()
    except OSError:
        return None
    for raw in reversed(tail):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if d.get("type") not in ("user", "assistant"):
            continue
        if d.get("type") != "assistant" or not d.get("isApiErrorMessage"):
            return None
        content = (d.get("message") or {}).get("content")
        text = " ".join(c.get("text", "") for c in content if isinstance(c, dict)) if isinstance(content, list) else str(content or "")
        flat = " ".join(text.split())
        limit = limit_line([flat])
        if limit and limit[1] <= 120:
            return None  # a usage limit before its reset, which the screen read holds as a usage-limit block; a resume line does nothing until then
        if resume_owned(s.get("session_id") or "", d.get("timestamp") or ""):
            return None
        return d.get("uuid") or d.get("timestamp"), flat[:120] or "API error", idle
    return None


THRASH = "Autocompact is thrashing"


def api_stop_lines(name, text, idle):
    """The resume line and its lead's line for a session stopped on an API error, idle for the words idle; a stop on Claude Code's
    autocompact thrashing names its own fix in both, inside notify.sh's 400-character cut, since redoing the step that filled the context fills it again."""
    if text.startswith(THRASH):
        return (f"ops-unstick: your last turn stopped on autocompact thrashing and you have sat idle {idle} since: a read or a tool output was too large for your context. Carry on with small reads (Read with offset and limit, grep, head; Explore for a large one), and leave the output that filled it unread.",
                f"{name} stopped on autocompact thrashing and sat idle {idle}; ops-unstick sent it a resume line with small reads. If it thrashes again, start it fresh from its brief (api-error stop).")
    return (f"ops-unstick: your last turn ended on an API error ({text}) and you have sat idle {idle} since. Carry on from where you stopped: redo the step that failed.",
            f"{name} stopped on an API error ({text}) and sat idle {idle}; ops-unstick sent it a resume line (api-error stop).")


def api_stop_alerts(state, found, now_t):
    """Each stopped session gets one resume line through the relay (SendMessage, never a key: **voice**) and its lead is told once; still
    stopped on the same entry 10 minutes after the resume line, its lead is alerted once. Logged as its own kind, "api-error stop"."""
    prev, cur, out = state.get("api_stops", {}), {}, []
    for sid, (name, (eid, text, idle)) in found.items():
        e = prev.get(sid) if (prev.get(sid) or {}).get("entry") == eid else {"entry": eid, "name": name, "since": now_t - idle, "cycles": 0, "escalated": False, "sent": now_t}
        e["cycles"] += 1
        if e["cycles"] == 1:
            resume, lead = api_stop_lines(name, text, ago(e["since"]))
            notify(resume, to=name)
            notify(lead, to=lead_of(name))
            log(f"{name}: api-error stop, idle {ago(e['since'])}: {text}; resume line queued, {lead_of(name)} told")
        elif not e["escalated"] and now_t - e.get("sent", now_t) >= API_ESCALATE:
            e["escalated"] = True
            notify(f"{name} is still idle after an API-error stop ({text}), {ago(e['since'])} in all; the resume line did not take. Resume it by SendMessage or respawn it (api-error stop).", to=lead_of(name))
            log(f"{name}: api-error stop still idle 10 minutes after its resume line; {lead_of(name)} alerted")
        cur[sid] = e
        out.append({"at": now(), "kind": "api-error stop", "line": text, "name": name, "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(e["since"]))})
    state["api_stops"] = cur
    return out


# dispatcher, 15 Oct: worker-sure-note's harness held run-slot-3 at 0% CPU for 35 minutes after it moved on; a holder whose run used under
# SLOT_IDLE_CPU seconds of CPU in SLOT_IDLE seconds is flagged to the builder once
SLOT_IDLE, SLOT_IDLE_CPU = 900, 2.0


def cpu_seconds(t):
    days, _, rest = t.rpartition("-")
    total = 0.0
    for part in rest.split(":"):
        total = total * 60 + float(part)
    return total + (int(days) * 86400 if days else 0)


def slot_idle_alerts(state, now_t):
    rows = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,time=,command="], capture_output=True, text=True, timeout=20).stdout.splitlines()
    kids, cpu, cmd = {}, {}, {}
    for row in rows:
        parts = row.split(None, 3)
        if len(parts) < 3:
            continue
        kids.setdefault(parts[1], []).append(parts[0])
        try:
            cpu[parts[0]] = cpu_seconds(parts[2])
        except ValueError:
            pass
        cmd[parts[0]] = parts[3] if len(parts) > 3 else ""
    prev, cur, out = state.get("slot_idle", {}), {}, []
    # the CPU slots alone: a commit, clone, quick or model slot's run can wait at 0% CPU by design
    for slot in CPU_SLOTS:
        try:
            who, pid = open(os.path.join(OPS, f"{slot}.holder")).read().split()[:2]
        except (OSError, ValueError):
            continue
        if not os.path.isdir(os.path.join(OPS, slot)) or not alive(pid):
            continue
        tree, todo = [], list(kids.get(pid, []))
        while todo:
            c = todo.pop()
            tree.append(c)
            todo += kids.get(c, [])
        total = sum(cpu.get(c, 0.0) for c in tree)
        key = f"{slot}:{pid}"
        e = prev.get(key)
        if not e or total - e["cpu"] >= SLOT_IDLE_CPU:
            cur[key] = {"cpu": total, "since": now_t, "told": False}
            continue
        cur[key] = e
        if now_t - e["since"] >= SLOT_IDLE:
            top = " ".join((cmd.get(kids.get(pid, [""])[0], "") or "?").split())[:90]
            line = f"{who} holds {slot} with a run idle at 0% CPU for {ago(e['since'])} (pid {pid}: {top}); stop it if it is done, and run a server outside run-slot"
            out.append({"at": now(), "kind": "slot-idle", "line": line, "name": who, "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(e["since"]))})
            if not e["told"]:
                e["told"] = True
                notify(line, to="builder")
                log(line)
    state["slot_idle"] = cur
    return out


# At 98% weekly usage every process shuts down and is backed up, and the owner's end-of-day post is drafted. Once a week per account, the line goes to dispatcher, the builder and ops through the relay, and only for
# an account a live session runs on (22 Oct: it went for the machine's own login at 98% while every session ran on other accounts)
SHUTDOWN_AT = 98
SHUTDOWN_SENT = os.path.join(HERE, "shutdown-98.json")
RECORD_ACCOUNT = (re.compile(r"^# account: (\S+)", re.M), re.compile(r"--account (\S+)"))


def session_account(name):
    """The account the named session runs on: the account line of its spawn.sh resume record, a login the usage gate picked included,
    else the record's --account, "glm" for a session spawn.sh pinned to
    GLM (its backends/<name>), which no usage file reads, else the machine's own login: usage.json's storedLogin, else usage.json's
    account."""
    try:
        with open(os.path.join(LW, "backends", name)) as f:
            if f.read().strip() == "glm":
                return "glm"
    except OSError:
        pass
    try:
        with open(os.path.join(LW, "resume", f"{name}.sh")) as f:
            text = f.read()
        m = next((m for m in (r.search(text) for r in RECORD_ACCOUNT) if m), None)
    except OSError:
        m = None
    if m:
        return m.group(1)
    try:
        u = json.load(open(os.path.join(LW, "usage.json")))
        return (u.get("storedLogin") or {}).get("account") or u.get("account")
    except (OSError, ValueError, AttributeError):
        return None


def readings():
    """Each account's newest reading, from usage.json, every usage-<name>.json and usage.json's storedLogin, a week alone that takes the
    reset of its account's own file while that reset is ahead, since no running job keeps the own login's file fresh."""
    found, stored, own = {}, None, os.path.join(LW, "usage.json")
    for path in [own, *glob.glob(os.path.join(LW, "usage-*.json"))]:
        try:
            u = json.load(open(path))
            acct, written = u["account"], u["writtenAt"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if path == own and isinstance(u.get("storedLogin"), dict):
            stored = {"account": u["storedLogin"].get("account"), "rate_limits": {"seven_day": {"used_percentage": u["storedLogin"].get("week")}}, "writtenAt": written}
        if acct not in found or written > found[acct]["writtenAt"]:
            found[acct] = u
    acct = stored and stored["account"]
    if acct and (acct not in found or stored["writtenAt"] > found[acct]["writtenAt"]):
        reset = (((found.get(acct) or {}).get("rate_limits") or {}).get("seven_day") or {}).get("resets_at")
        if isinstance(reset, (int, float)) and reset > calendar.timegm(time.strptime(stored["writtenAt"], "%Y-%m-%dT%H:%M:%SZ")):
            stored["rate_limits"]["seven_day"]["resets_at"] = reset
        found[acct] = stored
    return found


def shutdown_alert(names):
    """The 98% line for each account one of the named live sessions runs on. Its once-a-week key is the reset to the hour, which falls on the
    hour, since usage.json's resets_at wobbles by a second (1793026800 and 1793026799 sent the line twice), or the ISO week for a
    reading with no reset."""
    weeks = {}
    for acct, u in readings().items():
        try:
            w = u["rate_limits"]["seven_day"]
            weeks[acct] = (float(w["used_percentage"]), w.get("resets_at"))
        except (KeyError, TypeError, ValueError):
            continue
    try:
        sent = json.load(open(SHUTDOWN_SENT)).get("keys") or {}
    except (OSError, ValueError, AttributeError):
        sent = {}
    alerts = []
    for acct in sorted({session_account(name) for name in names} & weeks.keys()):
        pct, reset = weeks[acct]
        if pct < SHUTDOWN_AT:
            continue
        timed = isinstance(reset, (int, float))
        key = round(reset / 3600) if timed else time.strftime("%G-W%V", time.gmtime())
        when = time.strftime("%a %d %b %H:%MZ", time.gmtime(reset)) if timed else "unknown"
        line = f"SHUTDOWN 98%: {acct}'s week is at {pct:.0f}% (resets {when}). At 98% weekly usage, shut down and back up every process and whatever is happening, and draft the owner's end-of-day post."
        if sent.get(acct) != key:
            for to in ("dispatcher", "builder", "ops"):
                notify(line, to=to)
            sent[acct] = key
            with open(SHUTDOWN_SENT + ".tmp", "w") as f:
                json.dump({"at": now(), "keys": sent}, f)
            os.replace(SHUTDOWN_SENT + ".tmp", SHUTDOWN_SENT)
            log(line)
        alerts.append({"at": now(), "kind": "shutdown-98", "line": line, "name": acct, "since": now()})
    return alerts


def cycle(state):
    live = sessions()
    blocks, now_t, cleared = {}, time.time(), []
    mover = moving(now_t)
    kinds = roster_kinds()
    skipped, api_found = 0, {}
    for s in live:
        name = name_of(s)
        role = kind_of(name, kinds)
        try:
            if quiet_for(s.get("transcript_path") or "", now_t) < QUIET_READ:
                skipped += 1
                continue  # wrote a work line in the last minute: at work, so its screen is not read (read budget)
        except OSError:
            pass
        if (role in FACTORY_KINDS or is_lead(name, kinds) or "dispatcher" in (role, manager_kind_of_name(name), named_kind(name))) and role != "probe":
            stop = api_error_stop(s, now_t)
            if stop:
                api_found[s["session_id"]] = (name, stop)
        try:
            lines = screen(s)
        except Exception as e:
            if s["surface_id"] not in state.setdefault("unreadable", {}):
                log(f"{name}: read-screen failed: {e}")
            state["unreadable"][s["surface_id"]] = name
            continue
        state.setdefault("unreadable", {}).pop(s["surface_id"], None)
        kind, line, stuck = read_block(lines, s)
        if not kind:
            if stuck:
                key = f"{s['surface_id']}:usage-limit-stuck"
                prev = state["blocks"].get(key, {})
                blocks[key] = {"account": session_account(name), "kind": "usage-limit-stuck", "line": f"{stuck[0]} (still showing {int(stuck[1] // 60)}m after that reset; nudge it)", "name": name,
                               "since": prev.get("since", now_t), "alerted": prev.get("alerted", 0), "surface": s["surface_id"], "workspace": s["workspace_id"]}
                if now_t - blocks[key]["alerted"] >= REALERT and not held_for_move("usage-limit-stuck", mover):
                    blocks[key]["alerted"] = now_t
                    limit_alert(name, blocks[key]["line"], s.get("transcript_path"))
            continue
        key = f"{s['surface_id']}:{kind}"
        prev = state["blocks"].get(key, {})
        since = prev.get("since", now_t)
        if kind == "usage-limit" and LIMIT_DIALOG.search("\n".join(lines[-15:])):
            has_room, why = dialog_room(name, lines)
            if has_room:
                sent, answer = escape(s, name, "the usage-limit dialog")
                time.sleep(5 if sent else 0)
                after = screen(s) if sent else None
                still, _ = blocked(after) if sent else ("usage-limit", None)
                inline = limit_line(after) if still != "usage-limit" else None
                if inline and inline[1] <= 120:
                    still, line = "usage-limit", f"{inline[0]} (Escape cleared the dialog; the limit still holds)"
                if still != "usage-limit":
                    log(f"{name}: cleared the usage-limit dialog with Escape ({why})")
                    cleared.append(name)
                    continue
                elif not inline:
                    log(f"{name}: Escape did not clear the usage-limit dialog")
                    line = f"{line} (Escape did not clear it)"
                else:
                    log(f"{name}: Escape cleared the usage-limit dialog, but its limit line still shows before its reset; kept as a usage-limit block")
            else:
                line = f"{line} (no room: {why})"
        blocks[key] = {"kind": kind, "line": line, "name": name, "since": since, "alerted": prev.get("alerted", 0), "surface": s["surface_id"], "workspace": s["workspace_id"]}
        if kind in LIMIT_KINDS:
            blocks[key]["account"] = session_account(name)  # ops-tick's limitWatch names it to the builder
        if now_t - blocks[key]["alerted"] >= REALERT and not held_for_move(kind, mover) and not (kind != "usage-limit" and hook_owned(s["session_id"])):
            blocks[key]["alerted"] = now_t
            msg = f"{name} is blocked on a {kind} prompt, waiting {ago(since)}: {line}"
            if kind == "permission":
                msg = f"{msg} {prompt_answer(name, s['session_id'], lines)}".rstrip()
            if kind == "usage-limit":
                limit_alert(name, line, s.get("transcript_path"))
            else:
                notify(msg, to=alert_to(name, s.get("transcript_path")))
            log(msg)
    state["blocks"] = blocks
    # during a move each session's limit alert waits, and the move's dispatcher gets one summary every REALERT instead; the alerts come back once move.json ends
    if not mover:
        state.pop("moveAlerted", None)
    elif any(b["kind"] in LIMIT_KINDS for b in blocks.values()) and now_t - state.get("moveAlerted", 0) >= REALERT:
        state["moveAlerted"] = now_t
        summary = move_summary(blocks)
        notify(summary, to=mover)
        log(f"move summary to {mover}: {summary}")
    st = stall(live, state)
    with open(os.path.join(HERE, "state.json.tmp"), "w") as f:
        json.dump({"blocked": sorted(({k: v for k, v in b.items() if k != "alerted"} | {"since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(b["since"]))} for b in blocks.values()), key=lambda b: b["since"]), "sessions": len(live), "unreadable": sorted(state.get("unreadable", {}).values()), "writtenAt": now()}, f, indent=1)
    os.replace(os.path.join(HERE, "state.json.tmp"), os.path.join(HERE, "state.json"))
    # what dispatcher and the Builder must see with no relay: every live block
    alerts = [{"at": now(), "kind": b["kind"], "line": b["line"], "name": b["name"], "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(b["since"]))} for b in blocks.values()]
    if st:
        alerts.append({"at": now(), "kind": "stall", "line": st, "name": "merge queue", "since": now()})
    try:
        alerts += shutdown_alert([name_of(s) for s in live])
    except Exception as e:
        log(f"shutdown-98 check failed: {type(e).__name__}: {e}")
    try:
        alerts += api_stop_alerts(state, api_found, now_t)
    except Exception as e:
        log(f"api-error stop check failed: {type(e).__name__}: {e}")
    try:
        alerts += slot_idle_alerts(state, now_t)
    except Exception as e:
        log(f"slot-idle check failed: {type(e).__name__}: {e}")
    alerts += docker_check(state)
    try:
        alerts += memory_files()
    except Exception as e:
        log(f"memory check failed: {type(e).__name__}: {e}")
    try:
        jobs = heavy_jobs()
        alerts += slot_alerts(jobs, heavy_cap(), now())
        state["heavy"] = len(jobs)
    except Exception as e:
        log(f"heavy-jobs check failed: {type(e).__name__}: {e}")
    try:
        stuck = slot_stuck(state, now_t)
        if stuck:
            alerts.append(stuck)
            if not state["slot_free"].get("told"):
                state["slot_free"]["told"] = True
                subprocess.run([os.path.join(CODE, "notify.sh"), "unstick", stuck["line"]], env=os.environ | {"NOTIFY_TO": "builder"}, capture_output=True, timeout=30)
    except Exception as e:
        log(f"slot-stuck check failed: {type(e).__name__}: {e}")
    # ops-report's PR stalls (no activity for 30 minutes, not held), while its file is fresh (written within 15 minutes)
    try:
        u = json.load(open(os.path.join(OPS, "alerts-usage.json")))
        if now_t - calendar.timegm(time.strptime(u["writtenAt"], "%Y-%m-%dT%H:%M:%SZ")) < 900:
            alerts += u.get("alerts", [])
    except (OSError, ValueError, KeyError):
        pass
    try:
        prs = json.load(open(os.path.join(OPS, "alerts-prs.json")))
        if now_t - calendar.timegm(time.strptime(prs["writtenAt"], "%Y-%m-%dT%H:%M:%SZ")) < 900:
            alerts += [a | {"since": a["lastActivityAt"]} for a in prs.get("alerts", [])]
    except (OSError, ValueError, KeyError):
        pass
    with open(os.path.join(OPS, "alerts-pending.json.tmp"), "w") as f:
        json.dump({"alerts": sorted(alerts, key=lambda a: a["since"]), "writtenAt": now()}, f, indent=1)
    os.replace(os.path.join(OPS, "alerts-pending.json.tmp"), os.path.join(OPS, "alerts-pending.json"))
    parts = [f"{len(live)} sessions", f"{len(blocks)} blocked", f"{state.get('heavy', '?')} heavy jobs"] + ([f"cleared {', '.join(cleared)}"] if cleared else []) + ([st] if st else [])
    return ", ".join(parts), blocks


def dashboard_db():
    """The live dashboard's /api/health `db` reading ("ok", "unreachable"), or None when it cannot be read: the checkout on live.branch, its API by portless as ops-dashboard's supervisor reads it."""
    try:
        setting = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "packages", "scripts", "src", "playground", "setting.ts")
        live = subprocess.run(["bun", setting, "--text", "live.branch"], capture_output=True, text=True, timeout=30).stdout.strip()
        tree = subprocess.run(["git", "-C", CHECKOUT, "worktree", "list", "--porcelain"], capture_output=True, text=True, timeout=10).stdout
        dashboard = next((b.split("\n")[0].removeprefix("worktree ") for b in tree.split("\n\n") if live and f"branch refs/heads/{live}" in b.split("\n")), None)
        if not dashboard:
            return None
        api = subprocess.run(["bunx", "portless", "get", "api.playground"], cwd=dashboard, capture_output=True, text=True, timeout=20).stdout.strip()
        if not api.startswith("http"):
            return None
        body = subprocess.run(["curl", "-s", "-m", "5", f"{api}/api/health"], capture_output=True, text=True, timeout=10).stdout
        return json.loads(body)["data"]["db"]
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        return None


def docker_check(state, timeout=20):
    """The Docker engine (OrbStack) hung twice on 9 Oct (00:51Z, 01:43Z) with nothing logged: probe it each cycle, log the answer, alert after two misses.
    A probe that times out while the live dashboard's db reads unreachable is a live-dashboard outage, so OrbStack restarts at once, once per outage."""
    t0 = time.time()
    hung = False
    try:
        ok = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, timeout=timeout).returncode == 0
    except subprocess.TimeoutExpired:
        ok, hung = False, True
    took = time.time() - t0
    with open(os.path.join(HERE, "docker-health.log"), "a") as f:
        f.write(f"{now()} {'ok' if ok else 'HUNG'} {took:.1f}s\n")
    state["docker_misses"] = 0 if ok else state.get("docker_misses", 0) + 1
    # a file, so a restart's 3 minutes past ops-up's stale bound, which restarts this job, still counts as this outage's one restart
    mark = os.path.join(HERE, "orb-restarted")
    if ok and os.path.exists(mark):
        os.remove(mark)
    if hung and not os.path.exists(mark) and dashboard_db() == "unreachable":
        with open(mark, "w") as f:
            f.write(now() + "\n")
        codes = []
        for verb, limit in (("stop", 60), ("start", 120)):
            try:
                codes.append(subprocess.run(["orbctl", verb], capture_output=True, timeout=limit).returncode)
            except (OSError, subprocess.TimeoutExpired) as e:
                codes.append(type(e).__name__)
        line = f"docker info hung while the live dashboard's db read unreachable, so ops-unstick restarted OrbStack: orbctl stop exited {codes[0]}, orbctl start exited {codes[1]}"
        log(line)
        notify(line, to="ops")
        return [{"at": now(), "kind": "docker-restarted", "line": line, "name": "machine", "since": now()}]
    if state["docker_misses"] >= 2:
        return [{"at": now(), "kind": "docker-hung", "line": f"docker info has not answered for {state['docker_misses']} cycles; restart OrbStack (orbctl stop, orbctl start)", "name": "machine", "since": now()}]
    return []


# builder, 12 Oct: a waiter on a pre-edit copy of run-slot.sh held the queue's head while run-slot sat free; flag it after 2 minutes, but
# only while run-slot.sh's can-take says that waiter could take run-slot now, since under the load units a waiter for units that are not
# free waits beside a free run-slot by design (a review's round 1)
def slot_stuck(state, now_t):
    env = os.environ | {"RUN_SLOT_OPS": OPS}
    head = subprocess.run(["bash", os.path.join(CODE, "run-slot.sh"), "head"], env=env, capture_output=True, text=True, timeout=30).stdout.strip()
    first = head.split("-", 2) if head.count("-") >= 2 else None
    held = os.path.isdir(os.path.join(OPS, "run-slot"))
    sf = state.get("slot_free") or {}
    if not first or held or taken_since(sf.get("since", now_t)):
        state["slot_free"] = None
        return None
    if sf.get("ticket") != first[0] + first[1]:
        state["slot_free"] = {"ticket": first[0] + first[1], "since": now_t}
        return None
    if now_t - sf["since"] < 120:
        return None
    can = subprocess.run(["bash", os.path.join(CODE, "run-slot.sh"), "can-take", "run-slot", first[2]], env=env, capture_output=True, timeout=30)
    if can.returncode != 0:
        return None
    line = f"run-slot free for {int(now_t - sf['since'])}s while {first[2]} (pid {first[1]}) heads the queue, could take it and takes nothing"
    return {"at": now(), "kind": "slot-stuck", "line": line, "name": first[2], "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(sf["since"]))}


# whether run-slot.runs.log shows run-slot taken at or after since, a sample of the window that found it held between this job's own reads, 2 minutes apart
def taken_since(since):
    try:
        with open(os.path.join(OPS, "run-slot.runs.log"), "rb") as f:
            f.seek(max(0, os.fstat(f.fileno()).st_size - 200_000))
            lines = f.read().decode(errors="replace").splitlines()
    except OSError:
        return False
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(since))
    return any(len(p) > 4 and p[1] == "start" and p[4] == "run-slot" and p[0] >= at for p in (l.split(" ") for l in lines))


def main():
    os.makedirs(HERE, exist_ok=True)
    lock = open(os.path.join(HERE, "run.lock"), "w")
    if not ONCE:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            sys.exit("ops-unstick is already running")
    state = {"blocks": {}}
    try:
        prev = json.load(open(os.path.join(HERE, "state.json")))
        for b in prev.get("blocked", []):
            state["blocks"][f"{b['surface']}:{b['kind']}"] = b | {"since": calendar.timegm(time.strptime(b["since"], "%Y-%m-%dT%H:%M:%SZ")), "alerted": time.time()}
    except (OSError, ValueError, KeyError):
        pass
    while True:
        try:
            detail, blocks = cycle(state)
            result = "ok"
        except Exception as e:
            detail, result = "", f"error: {type(e).__name__}: {e}"[:120]
        if ONCE:
            print(result, detail)
            for b in blocks.values() if result == "ok" else []:
                print(f"  {b['name']}: {b['kind']} since {ago(b['since'])}: {b['line']}")
            return
        beat("ops-unstick", os.getpid(), STARTED, CYCLE, result, {"detail": detail[:120]})
        time.sleep(CYCLE)


if __name__ == "__main__":
    main()
