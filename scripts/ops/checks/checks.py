#!/usr/bin/env python3
"""ops-checks: the PR checks outside any Claude session (runner-envy's tick-prompt (B) as a script, no model).

Every INTERVAL seconds: list open PRs into canary, take heads not in the ledger (tested.txt; non-draft first, then
drafts, oldest push first) plus any "<n> <sha>" lines in reverify.txt, and for one head at a time either comment that
it is behind canary or run the tester stack (worktree .claude/worktrees/tester, DB playground-tester-db on loopback) and
post the stamp, green or red, with a check per verify line and verify itself, through stamp-cli.ts's post. Text only, never a screenshot. Tells Ops
(notify.sh) only on a failing check, a preflight refusal or a script error. Signals only the stack it started.
"""
import glob, json, os, re, signal, ssl, subprocess, sys, threading, time, urllib.request
def portless_urls(wt): return tuple(subprocess.run(["bunx", "portless", "get", n], cwd=wt, capture_output=True, text=True, timeout=30, check=True).stdout.strip() for n in ("playground", "api.playground"))

HERE = os.path.dirname(os.path.abspath(__file__))
OPS = os.path.dirname(HERE)
sys.path.insert(0, OPS)
from beat import beat, checkout  # noqa: E402

WT = os.path.join(checkout(), ".claude", "worktrees", "tester")


def setting(key):
    """A setting's value as the store's reader in this script's own checkout prints it (packages/scripts/src/playground/setting.ts), its default on a machine with no store; stops naming why on a store whose policy.json it cannot read."""
    r = subprocess.run(["bun", os.path.join(os.path.dirname(os.path.dirname(OPS)), "packages", "scripts", "src", "playground", "setting.ts"), key], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise SystemExit(f"checks: {key}: {r.stderr.strip() or f'exit {r.returncode}'}")
    return json.loads(r.stdout)


REPO = setting("factory.repo")
OWNER = REPO.split("/")[0]  # the account every factory session pushes as
LEDGER = os.path.join(HERE, "tested.txt")
PASSES = os.path.join(HERE, "passes.json")
REVERIFY = os.path.join(HERE, "reverify.txt")
LOG = os.path.join(HERE, "checks.log")
DEVLOG = os.path.join(HERE, "dev.log")
INTERVAL = int(os.environ.get("TESTER_INTERVAL", "60"))  # a merge hands the next PR its turn within a minute
API = WEB = ""  # verify_once reads them from portless, which names the stack from its checkout's branch
BRANCH = "live/tester"  # portless names the stack from this branch (tester.*); parallel lanes override it
DBC = "playground-tester-db"
BUILD_SINCE = "3da7206"
stack = None
STARTED = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
last_result = "ok"


def log(msg):
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {msg}\n")


def notify(msg):
    subprocess.run([os.path.join(OPS, "notify.sh"), "checks", msg])


def run(argv, timeout=900, env=None, cwd=None):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env, cwd=cwd)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def git(*args, timeout=300):
    return run(["git", "-C", WT, *args], timeout=timeout)


def clean_env():
    env = dict(os.environ)
    env.pop("NODE_ENV", None)
    env.pop("SKIP_ENV_VALIDATION", None)
    return env


def ledger():
    try:
        return {l.split()[1] for l in open(LEDGER) if len(l.split()) >= 3}
    except FileNotFoundError:
        return set()


def take_reverify():
    try:
        lines = [l.split() for l in open(REVERIFY) if len(l.split()) == 2]
    except FileNotFoundError:
        return []
    open(REVERIFY, "w").close()
    return [{"number": int(n), "headRefOid": s, "isDraft": False} for n, s in lines]


def behind(sha):
    _, out = git("log", "--format=%s", f"{sha}..origin/canary")
    subjects = [s for s in out.splitlines() if s and not s.startswith(("ci(changelog)", "ci(version)"))]
    return subjects


def scrub(text):
    return re.sub(r"(?i)release", "ship", text)


def comment(n, body_file):
    with open(body_file) as f:
        if re.search(r"(?i)release", f.read()):
            raise RuntimeError("comment body holds the r-word after scrubbing")
    # GitHub's comment API flakes after an outage (7 Oct): retry before failing, since pr:merge reads only comments
    for attempt in range(3):
        code, out = run(["gh", "pr", "comment", str(n), "--repo", REPO, "--body-file", body_file], timeout=120)
        if code == 0:
            return out.strip().splitlines()[-1]
        time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"gh pr comment failed: {out.strip()[:200]}")


def sentence(text):
    """text as a stamp comment: one line of at most 20 words, ending in a full stop, or None when it holds no word."""
    words = re.sub(r"[`\n]", " ", text).split()[:20]
    line = " ".join(words).rstrip(".:;,")
    return f"{line[:1].upper()}{line[1:]}." if line else None


def checks_of(lines):
    """The stamp's checks from Checks' ✓ and ✗ lines: each line's label, passing (skip when it says skipped) or failing, a failing one with its text as the comment."""
    out = {}
    for line in lines:
        if not line.startswith(("✓", "✗")):
            continue
        label, _, text = line[2:].strip().partition("  ")
        name = re.sub(r"[^\w.:/-]", "-", label.strip()) or "check"
        if line.startswith("✗"):
            out[name] = ("fail", sentence(text.strip()))
        elif name not in out:
            out[name] = ("skip" if text.strip().startswith("skipped") else "pass", None)
    return out


# the check names the merge gates read, as CHECKS in packages/config/src/verdicts.ts names them (a test holds them equal)
AGENT_DRIVE_CHECK, AGENT_REVIEW_CHECK, TRAIN_CHECK, VERIFY_CHECK = "agent-drive", "agent-review", "train", "verify"


def stamp_checks(code, out, lines):
    """The stamp's checks from one Checks run on dashboard code: one per ✓ or ✗ line, then verify, the check the merge gate reads,
    passing only when `verify all` exited 0; code is None when the run stopped at its preflight, which fails both."""
    checks = checks_of(lines)
    if code is None:
        checks["preflight"] = ("fail", sentence(out))
    checks[VERIFY_CHECK] = ("pass", None) if code == 0 else ("fail", "The preflight stopped the run." if code is None else f"Verify all exited {code}.")
    return checks


def post_stamp(n, sha, status, checks, remark=None):
    """Post the stamp at sha on #n, or on commit sha when n is None, through stamp-cli.ts's post, the one writer, from the main checkout; checks maps each name to
    (pass|fail|skip, comment or None), each from source local, and remark is the stamp's own sentence. Returns its URL; tries 3 times, since pr:merge reads only comments."""
    argv = ["bun", "packages/scripts/src/pr-merge/stamp-cli.ts", "post", sha, status, *(["--pr", str(n)] if n else []), "--repo", REPO]
    for name, (state, why) in sorted(checks.items()):
        argv += ["--check", f"{name}={state}" + (f" {scrub(why)}" if why else "")]
    if remark:
        argv += ["--remark", scrub(remark)]
    for attempt in range(3):
        code, out = run(argv, timeout=120, cwd=checkout())
        if code == 0:
            return out.strip().splitlines()[-1]
        time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"stamp-cli.ts post failed: {out.strip()[:200]}")


def record(n, sha, result, url, note, canary=None):
    with open(LEDGER, "a") as f:
        f.write(f"{n} {sha} {result} {url}\n")
    log(f"#{n} @ {sha[:7]}: {result} {url}{(' (' + note + ')') if note else ''}")
    passes = load_json(PASSES, {})
    if result == "pass" and canary:
        # the canary each pass ran against, so a canary move re-queues the passes it made stale (dispatcher's guard needs one at the current canary)
        passes[str(n)] = {"canary": canary, "sha": sha}
    elif result == "fail" and passes.get(str(n), {}).get("sha") == sha:
        # a head that has since failed (a conflict with a newer canary) waits for its next head; it is no stale pass to re-test
        passes.pop(str(n))
    else:
        return
    with open(PASSES, "w") as f:
        json.dump(passes, f)


def load_json(path, default):
    try:
        return json.load(open(path))
    except Exception:
        return default


def owner(n):
    """The session to tell about PR n: owners.json's entry (a PR with no worker, such as a changelog commit), else the live roster agent whose pr is it, a worker first."""
    named = load_json(os.path.join(HERE, "owners.json"), {}).get(str(n))
    if named:
        return named
    agents = [a for a in load_json(os.path.join(os.path.dirname(OPS), "roster.json"), {}).get("agents", []) if str(a.get("pr", "")).rstrip("/").endswith(f"/pull/{n}") and a.get("status") != "ended"]
    agents.sort(key=lambda a: not a["name"].startswith("worker-"))
    return agents[0]["name"] if agents else None


def tell_owner(n, text):
    """Type the Checks line into the PR's own session, so its worker merges without a relay (notify.sh types only into an empty input box)."""
    who = owner(n)
    if who:
        subprocess.Popen([os.path.join(OPS, "notify.sh"), "checks", text], env={**os.environ, "NOTIFY_TO": who}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def post_behind(n, sha, subjects, note=""):
    nums = [m for s in subjects for m in re.findall(r"\(#(\d+)\)", s)]
    missing = f" (missing {', '.join('#' + x for x in nums)})" if nums else ""
    body = f"Checks: {sha[:7]} is {len(subjects)} commits behind canary{missing}; merge canary in and I'll check the new head."
    if note:
        body += f"\n\nNote: {note}"
    path = os.path.join(HERE, f"comment-pr{n}-{sha[:7]}.md")
    with open(path, "w") as f:
        f.write(scrub(body) + "\n")
    record(n, sha, "skipped-behind", comment(n, path), note)


def descendant_groups(root):
    """The process groups of every process under root (turbo puts each task in a group of its own), all started by this job."""
    _, out = run(["ps", "-ax", "-o", "pid=,ppid=,pgid="], timeout=30)
    rows = [tuple(int(x) for x in l.split()) for l in out.splitlines() if len(l.split()) == 3]
    kids, todo, seen = {}, [root], set()
    for pid, ppid, pgid in rows:
        kids.setdefault(ppid, []).append((pid, pgid))
    groups = set()
    while todo:
        p = todo.pop()
        for c, g in kids.get(p, []):
            if c not in seen:
                seen.add(c)
                groups.add(g)
                todo.append(c)
    return groups - {os.getpgrp()}


PGIDS = os.path.join(HERE, "stack.pgids")


def recorded_groups():
    """Groups an earlier stack recorded, kept only while one of their processes still runs a command in the checks worktree (a reused pgid is left alone)."""
    try:
        groups = {int(x) for x in open(PGIDS).read().split()}
    except (FileNotFoundError, ValueError):
        return set()
    _, out = run(["ps", "-ax", "-o", "pgid=,command="], timeout=30)
    live = {int(l.split(None, 1)[0]) for l in out.splitlines() if len(l.split(None, 1)) == 2 and WT in l.split(None, 1)[1]}
    return groups & live


def stop_stack():
    global stack
    groups = (descendant_groups(stack.pid) if stack else set()) | recorded_groups()
    run(["bun", "run", "--cwd", WT, "dev:stop"], timeout=120, env=clean_env())
    for g in groups:
        try:
            os.killpg(g, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
    if stack and stack.poll() is None:
        try:
            os.killpg(stack.pid, signal.SIGTERM)
            stack.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(stack.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    # wait for the old stack's groups to go, so the next stack never starts while this one still answers the shared URL (a voided run otherwise)
    for i in range(30):
        left = [g for g in groups if alive_group(g)]
        if not left:
            break
        if i == 20:
            for g in left:
                try:
                    os.killpg(g, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        time.sleep(1)
    if stack:
        stack.logf.close()
    stack = None
    open(PGIDS, "w").close()


def alive_group(g):
    try:
        os.killpg(g, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def start_stack():
    global stack
    f = open(DEVLOG, "w")
    stack = subprocess.Popen(["bun", "run", "--cwd", WT, "dev", "--ui", "stream"], stdout=f, stderr=subprocess.STDOUT, env=clean_env(), start_new_session=True)
    stack.logf = f


# urllib checks a certificate against the system's cert.pem, never the keychain `portless trust` writes, so an https stack is read with portless's own CA
def portless_ssl(env=os.environ):
    ca = os.path.join(env.get("PORTLESS_STATE_DIR") or os.path.expanduser("~/.portless"), "ca.pem")
    return ssl.create_default_context(cafile=ca) if os.path.exists(ca) else None


def wait_up(url, secs=360):
    end = time.time() + secs
    while time.time() < end:
        if stack and stack.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=5, context=portless_ssl()) as r:
                if r.status < 400:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def refusal():
    try:
        for l in open(DEVLOG):
            if "refusing" in l:
                return l.strip()[:200]
    except FileNotFoundError:
        pass
    return None


def verify_once(sha):
    start_stack()
    global API, WEB
    try:
        WEB, API = portless_urls(WT)
    except (OSError, subprocess.SubprocessError) as e:
        return 1, f"✗ stack  portless get failed in {WT}: {e}"
    up = wait_up(f"{API}/api/health") and wait_up(f"{WEB}/dashboard")
    if stack:
        with open(PGIDS, "w") as f:
            f.write(" ".join(str(g) for g in descendant_groups(stack.pid)))
    # a stack left from an earlier run answers on the same names: refuse to verify one that is not this head
    try:
        with urllib.request.urlopen(f"{API}/api/health", timeout=10, context=portless_ssl()) as r:
            version = json.load(r).get("data", {}).get("version", "")
        if up and sha[:8] not in version:
            return 1, f"✗ stack  the checks stack answered as {version}, not {sha[:8]}: a stale stack; this run is void"
    except Exception:
        pass
    if not up:
        why = refusal()
        return (None, why) if why else (1, "✗ stack  the tester stack did not answer within 6 minutes")
    code, out = run(["bun", "run", "--cwd", WT, "verify", "all", "--expect", sha], timeout=900, env=clean_env())
    # a lead can hold one verify check out of the verdict while it is in question (builder, 8 Oct: `cursor` failed the first train after
    # a flake or canary-wide); the check still runs and shows, and the verdict names what it did not count
    try:
        ignored = {l.split()[0] for l in open(os.path.join(HERE, "ignore-checks.txt")) if l.strip() and not l.startswith("#")}
    except OSError:
        ignored = set()
    failed = {l.split()[1] for l in out.splitlines() if l.startswith("✗") and len(l.split()) > 1}
    if code and failed and failed <= ignored:
        out += "\n(not counted: " + ", ".join(sorted(failed)) + " is on ops-checks' ignore list while a lead checks it; every other check passed)"
        code = 0
    return code, out


BOX = os.path.join(OPS, "runner-host", "ci.sh")
BOX_FULL = []
# dispatcher, 18 Oct: verify's stack and browser run only for a PR whose diff touches the dashboard's code (the web, the API, or a package the dashboard
# imports); any other PR's Checks is the suite on the runner host alone, taking no slot on the Mac
DASHBOARD_PATHS = ("api/hono/", "packages/auth/", "packages/config/", "packages/db/", "packages/env/", "web/next/")
VERIFY_SKIPPED = "✓ verify  skipped: no dashboard code in the diff"
VERIFY = True


def needs_verify(paths):
    return any(p.startswith(DASHBOARD_PATHS) for p in paths)


def diff_needs_verify(base, sha, cwd=None):
    """True unless git names every path the head changes since its merge base with base and none is dashboard code; a diff git cannot read
    needs verify. --no-renames names both paths of a rename, as pr:merge and go.py read a PR's files."""
    r = subprocess.run(["git", "diff", "--name-only", "--no-renames", f"{base}...{sha}"], capture_output=True, text=True, timeout=120, cwd=cwd or WT)
    return r.returncode != 0 or needs_verify(r.stdout.split())


MAC_HELD = []


def mac_suite_take():
    """While runner-host/mac-suite-on exists, as many Checks suites as its number (1 when empty) run on the Mac at once (through run-slot,
    so the Mac's load gates hold) and the rest on the box (dispatcher, 20 Oct: a box suite runs in 8-9 min, the same as the Mac's, and the
    42-60 min runs were first-come waits for both box slots). Each Mac place is a lock on runner-host/mac-suite[-N].lock, this run's
    until its process ends."""
    import fcntl
    host = os.path.dirname(BOX)
    on = os.path.join(host, "mac-suite-on")
    if MAC_HELD or not os.path.exists(on):
        return bool(MAC_HELD)
    try:
        n = int(open(on).read().strip() or 1)
    except (OSError, ValueError):
        n = 1
    for i in range(1, max(n, 1) + 1):
        f = open(os.path.join(host, "mac-suite.lock" if i == 1 else f"mac-suite-{i}.lock"), "a")
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            f.close()
    else:
        return False
    MAC_HELD.append(f)
    return True


def box_start(test_sha):
    """dispatcher, 18 Oct: the suite runs on the runner host, beside verify here, and takes no slot on the Mac; None when the box is off."""
    # runner-host/checks-off sends Checks' suite back to the Mac and leaves the box to run-slot's runs (ops, 19 Oct: 2 box slots, Checks suites queued workers' 1-min runs to 15 min)
    if not os.path.exists(BOX) or any(os.path.exists(os.path.join(os.path.dirname(BOX), f)) for f in ("off", "checks-off")):
        return None
    if mac_suite_take():
        return None
    return subprocess.Popen(["bash", BOX, test_sha], cwd=WT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=clean_env())


def box_result(proc):
    """(test code, test line) from the box's run, its other steps kept in BOX_FULL as full_suite's lines, or None to run the suite here."""
    BOX_FULL.clear()
    try:
        out, _ = proc.communicate(timeout=5400)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        return None
    steps = {}
    for line in out.splitlines():
        m = re.match(r"^(ok|fail) (\S+) (\d+)s(?:: (.*))?$", line.strip())
        if m:
            steps[m.group(2)] = (m.group(1) == "ok", int(m.group(3)), m.group(4) or "")
    if proc.returncode not in (0, 1) or "test" not in steps:
        print(f"runner host: exit {proc.returncode}, the suite runs here instead: {out.strip()[-200:]}", flush=True)
        return None
    ok, secs, rest = steps["test"]
    test = (0, f"✓ test  bun run test on the runner host ({secs}s): {rest or 'passed'}") if ok else (1, f"✗ test  bun run test on the runner host: {rest}")
    labels = {l for l, _, _ in FULL_STEPS}
    BOX_FULL.extend(f"✓ {l}  on the runner host ({t}s)" if k else f"✗ {l}  on the runner host: {r}" for l, (k, t, r) in steps.items() if l in labels)
    return test


def run_suite(prev, test_sha, label):
    """The suite every Checks run is: install when the lockfile moved, a fresh migrated DB, verify all against a stack of test_sha,
    then bun run test with the stack down, re-running load flakes. Returns (verify code, verify output, test code, test line, notes)."""
    BOX_FULL.clear()  # a Mac run must never report an earlier run's box steps
    if not VERIFY:
        box = box_start(test_sha)
        got = box_result(box) if box else None
        return (0, VERIFY_SKIPPED, *(got or in_slot("suite")), [])
    # the Mac's share runs as run-slot's child, the box's suite beside it; the lane waits on the box with no slot held
    box = box_start(test_sha)
    try:
        code, out, notes = in_slot("verify", label=label, prev=prev.strip(), test_sha=test_sha)
    except Exception:
        # the box started first, so a phase that raises stops it, as box_result does on a timeout
        if box:
            box.kill()
            box.communicate()
        raise
    got = box_result(box) if box else None
    if got:
        return code, out, got[0], got[1], notes
    tcode, test_line = in_slot("suite")
    return code, out, tcode, test_line, notes


def verify_phase(prev, test_sha, label):
    """The Mac's share of a Checks run: install when the lockfile moved, a fresh migrated DB, the API's build, and verify all against a
    stack of test_sha, the stack stopped after. Returns [verify code, verify output, notes]."""
    if git("diff", "--quiet", prev.strip(), test_sha, "--", "bun.lock")[0]:
        code, out = run(["bun", "install", "--cwd", WT, "--ignore-scripts", "--frozen-lockfile"], timeout=900, env=clean_env())
        if code:
            raise RuntimeError(f"bun install: {out.strip()[-200:]}")
    # its own container stops with Docker or a shutdown; start it again (a fixed loopback port, so the URL holds) and wait until it answers
    if run(["docker", "inspect", "-f", "{{.State.Running}}", DBC], timeout=30)[1].strip() != "true":
        run(["docker", "start", DBC], timeout=60)
        for _ in range(30):
            if run(["docker", "exec", DBC, "pg_isready", "-U", "postgres"], timeout=20)[0] == 0:
                break
            time.sleep(1)
    code, out = run(["docker", "exec", DBC, "psql", "-U", "postgres", "-c", "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"], timeout=120)
    if code:
        raise RuntimeError(f"db reset: {out.strip()[:200]}")
    code, out = run(["bun", "run", "--cwd", WT, "db:migrate"], timeout=300, env=clean_env())
    if code:
        raise RuntimeError(f"db:migrate: {out.strip()[-200:]}")
    if git("merge-base", "--is-ancestor", BUILD_SINCE, "HEAD")[0]:
        run([os.path.join(WT, "node_modules", ".bin", "turbo"), "run", "build", "--filter=@api/hono", "--cwd", WT], timeout=900, env=clean_env())
    notes = []
    code, out = verify_once(test_sha)
    log = open(DEVLOG).read()
    if code and "panicked" in log:
        os.replace(DEVLOG, os.path.join(HERE, f"dev-{label}-panic.log"))
        stop_stack()
        notes.append("a first start died on a Turbopack cache panic (the stack, not this head); this is the restarted run.")
        code, out = verify_once(test_sha)
    elif code and "EADDRINUSE" in log:
        # portless can hand an app a port another stack holds on 127.0.0.1, so its name routes to that stack; a restart draws a new port
        os.replace(DEVLOG, os.path.join(HERE, f"dev-{label}-port.log"))
        stop_stack()
        notes.append("a first start was given a port another stack holds (the stack, not this head); this is the restarted run.")
        code, out = verify_once(test_sha)
    stop_stack()
    return [code, out, notes]


def mac_suite():
    """bun run test here, with the stack down, re-running load flakes, when the runner host cannot run it. Returns [test code, test line]."""
    # a lane with no verify phase never installed, so its workspace links went stale (ops, 20 Oct: a PR failed on chk-8's missing remark-gfm); an unchanged install takes under a second
    code, out = run(["bun", "install", "--cwd", WT, "--ignore-scripts", "--frozen-lockfile"], timeout=900, env=clean_env())
    if code:
        raise RuntimeError(f"bun install: {out.strip()[-200:]}")
    # the full suite too, with the stack down (it rebuilds packages/*): verify alone missed a red bun run test at 8b11272
    tcode, tout = run(["bun", "run", "--cwd", WT, "test"], timeout=1800, env=clean_env())
    fails = sorted({l.strip()[7:].strip()[:100] for l in tout.splitlines() if l.strip().startswith("(fail)")})
    summary = [l.strip() for l in tout.splitlines() if re.match(r"^\s*\d+ (pass|fail)$", l)]
    reruns = ""
    if tcode and fails:
        # dispatcher's stopgap for load flakes (real fix PG-88): each failing file alone, then the full suite once more, every re-run named
        files, current = [], None
        for l in tout.splitlines():
            m = re.match(r"^(tests/\S+\.test\.tsx?):$", l.strip())
            if m:
                current = m.group(1)
            elif l.strip().startswith("(fail)") and current and current not in files:
                files.append(current)
        env = {**clean_env(), "NODE_ENV": "production", "SKIP_ENV_VALIDATION": "true"}
        alone = []
        for f in files[:8]:
            c, _ = run(["bun", "test", "--cwd", WT, os.path.join(WT, f)], timeout=600, env=env)
            alone.append(f"{f} {'pass' if c == 0 else 'fail'}")
        tcode2, tout2 = run(["bun", "run", "--cwd", WT, "test"], timeout=1800, env=clean_env())
        summary2 = [l.strip() for l in tout2.splitlines() if re.match(r"^\s*\d+ (pass|fail)$", l)]
        reruns = f"; re-run alone: {', '.join(alone) or 'none found'}; full suite again: {', '.join(summary2) or 'exit ' + str(tcode2)}"
        if tcode2 == 0 and all(a.endswith(" pass") for a in alone):
            tcode, summary, fails = 0, summary2, []
            reruns = f"; first run had {len(files)} failing file(s) under load{reruns}"
    test_line = (f"✓ test  bun run test: {', '.join(summary) or 'passed'}" if tcode == 0 else f"✗ test  bun run test: {', '.join(summary) or 'exit ' + str(tcode)}" + (f"; failing: {'; '.join(fails[:5])}" if fails else f"; {tout.strip()[-200:]}" if not summary else "")) + reruns
    return [tcode, test_line]


# (builder, 18 Oct, the factory's yes): a train step's green stamp stands for the suite on every PR up to its step, so the train step
# also runs GitHub's jobs' other steps. Off until the repo side merges: touch full-suite.on beside this file to switch it on with it
FULL_SUITE_FLAG = os.path.join(HERE, "full-suite.on")
PY313 = os.path.expanduser("~/.local/share/uv/python/cpython-3.13-macos-aarch64-none/bin")
FULL_STEPS = [
    ("audit", ["bun", "packages/scripts/src/audit.ts", "--audit-level", "high", "--ignore", "GHSA-vfj7-8cjw-p6xm"], 300),
    ("format:check", ["bun", "run", "format:check"], 600),
    ("lint", ["bun", "run", "lint"], 600),
    ("check-types", ["bun", "run", "check-types"], 1200),
    ("build", ["bun", "run", "build"], 1800),
    ("test:skills", ["bun", "run", "test:skills"], 1800),
]


def full_suite():
    """Local CI's steps beyond verify and bun run test, run in the lane's worktree with its stack down; one ✓ or ✗ line each."""
    env = clean_env() | {"NODE_ENV": "production", "SKIP_ENV_VALIDATION": "true", "PATH": PY313 + os.pathsep + os.environ.get("PATH", "")}
    lines = []
    for label, argv, timeout in FULL_STEPS:
        try:
            r = subprocess.run(argv, cwd=WT, capture_output=True, text=True, timeout=timeout, env=env)
            code, out = r.returncode, (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired:
            code, out = 124, f"timed out after {timeout}s"
        tail = " ".join(out.strip().splitlines()[-2:])[-200:]
        lines.append(f"✓ {label}  {' '.join(argv)}" if code == 0 else f"✗ {label}  {' '.join(argv)}: exit {code}: {tail}")
    return lines


# (ops, 19 Oct: a dashboard-code lane held a Mac slot for 20 minutes at 0% CPU while its suite ran on the box): the Mac's share of a run
# goes through run-slot.sh as its own child, so the slot is held only for it, and its dev stack descends from run-slot, as ops-unstick's
# outside-slot check reads; parallel lanes name their PR as the slot's holder
SLOT_RUN = os.path.join(OPS, "run-slot.sh")
SLOT_WHO = "ops-checks"
PHASES = {"full": full_suite, "suite": mac_suite, "verify": verify_phase}


def holds_slot():
    """True when this process already holds a run slot (merge-train takes one by mkdir and calls test_train in-process), so a phase runs
    inline rather than waiting on a second slot."""
    for h in glob.glob(os.path.join(OPS, "run-slot*.holder")):
        try:
            if int(open(h).read().split()[1]) == os.getpid():
                return True
        except (OSError, ValueError, IndexError):
            pass
    return False


def in_slot(phase, **args):
    """Runs one phase (verify, suite or full) under run-slot.sh as checks.py --phase <state file>, the lane's settings in the file, and
    returns what the phase wrote back there; a run with no result raises, naming run-slot's exit and output."""
    if holds_slot():
        return PHASES[phase](**args)
    path = os.path.join(HERE, f"phase-{phase}-{os.getpid()}.json")
    with open(path, "w") as f:
        json.dump({"args": args, "lane": {"BRANCH": BRANCH, "DBC": DBC, "DEVLOG": DEVLOG, "PGIDS": PGIDS, "VERIFY": VERIFY, "WT": WT}, "phase": phase}, f)
    try:
        # no timeout here: each step in the phase has its own, and the wait for a slot is the queue
        r = subprocess.run(["bash", SLOT_RUN, SLOT_WHO, "--", sys.executable, "-I", os.path.abspath(__file__), "--phase", path], capture_output=True, text=True)
        try:
            state = json.load(open(path))
        except (OSError, ValueError):
            state = {}
        if "error" in state:
            raise RuntimeError(state["error"])
        if "result" not in state:
            raise RuntimeError(f"the {phase} phase under run-slot left no result (exit {r.returncode}): {((r.stdout or '') + (r.stderr or '')).strip()[-200:]}")
        return state["result"]
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def phase_main(path):
    """run-slot's child: one phase with the lane's settings from the state file, its result (or its error) written back there. It refuses to
    run outside run-slot (which exports RUN_SLOT_NICE), since the Mac's share of Checks needs a slot."""
    if "RUN_SLOT_NICE" not in os.environ:
        print("checks.py --phase runs only as run-slot.sh's child: the Mac's share of Checks needs a slot", file=sys.stderr)
        return 2
    global WT, BRANCH, DBC, DEVLOG, PGIDS, VERIFY
    state = json.load(open(path))
    lane = state["lane"]
    WT, BRANCH, DBC, DEVLOG, PGIDS, VERIFY = lane["WT"], lane["BRANCH"], lane["DBC"], lane["DEVLOG"], lane["PGIDS"], lane["VERIFY"]
    signal.signal(signal.SIGTERM, lambda *_: (stop_stack(), sys.exit(143)))
    try:
        state["result"] = PHASES[state["phase"]](**state["args"])
    except Exception as e:
        stop_stack()
        state["error"] = f"{state['phase']} phase: {e}"
    with open(path + ".tmp", "w") as f:
        json.dump(state, f)
    os.replace(path + ".tmp", path)
    return 0


def test_train(train_id, k, step, prs):
    """The merge train's Checks: check one train step's commit as built (canary plus PRs 1..k squashed, no further merge), then post on
    every PR of steps 1..k the stamp at that commit, with a train check, which pr:train reads by the commit it names. Returns True on green."""
    commit, tree7 = step["commit"], step["tree"][:7]
    stop_stack()
    _, prev = git("rev-parse", "HEAD")
    git("fetch", "-q", "origin", f"+refs/heads/train/{train_id}:refs/remotes/origin/train/{train_id}", timeout=300)
    code, out = git("checkout", "-q", "-B", BRANCH, commit)
    if code:
        raise RuntimeError(f"checkout train {train_id} step {k} {commit[:7]}: {out.strip()[:200]}")
    code, out, tcode, test_line, notes = run_suite(prev, commit, f"train{train_id}-{k}")
    full = os.path.exists(FULL_SUITE_FLAG) and code == 0 and tcode == 0
    full_lines = (list(BOX_FULL) or in_slot("full")) if full else []
    body_short = []
    for n in prs:
        _, body = run(["gh", "pr", "view", str(n), "--repo", REPO, "--json", "body", "--jq", ".body"], timeout=60)
        if refusal := body_refusal(body):
            body_short.append(f"#{n}: {refusal}")
    body_line = "✓ pr-body  every PR on the step has the PR template's body" if not body_short else f"✗ pr-body  {'; '.join(body_short)}"
    if code is None:
        lines, failed = [x for x in (out, test_line, body_line) if x], "preflight"
    else:
        lines = ([l for l in out.splitlines() if l.startswith(("✓", "✗"))] or [out.strip()[-300:]]) + [test_line] + full_lines + [body_line]
        bad = [l for l in lines if l.startswith("✗") and not l.startswith(("✗ test ", "✗ pr-body"))]
        failed = re.split(r"\s{2,}", bad[0][2:].strip())[0] if bad else ("verify" if code else "test" if tcode else "PR body" if body_short else "")
    verdict = "FAIL" if failed else "PASS"
    status = "red" if failed else "green"
    first = f"stamp {status} @ {commit[:7]} (train {train_id}, step {k}, tree {tree7})"
    stamped = {**checks_of(lines), TRAIN_CHECK: ("fail" if failed else "pass", sentence(f"Train {train_id} step {k} failed on {failed}") if failed else None)}
    if code is None:
        stamped["preflight"] = ("fail", sentence(out))
    for n in prs:
        url = post_stamp(n, commit, status, stamped)
        tell_owner(n, f"#{n}: {first}{(' (' + failed + ')') if failed else ''} {url}")
    log(f"train {train_id} step {k} @ {commit[:7]}: {verdict.lower()}{(' (' + failed + ')') if failed else ''} on " + " ".join(f"#{n}" for n in prs))
    if failed:
        notify(f"train {train_id} step {k} @ {commit[:7]}: {first} ({failed})")
    return not failed


def test_canary(commit):
    """The net: check canary's tip as it stands after a batch, then post its stamp on the commit, where a red one stops every
    merge (pr:merge's canary gate) until canary is fixed. Returns True on green."""
    stop_stack()
    _, prev = git("rev-parse", "HEAD")
    git("fetch", "-q", "origin", "canary", timeout=300)
    code, out = git("checkout", "-q", "-B", BRANCH, commit)
    if code:
        raise RuntimeError(f"checkout canary {commit[:7]}: {out.strip()[:200]}")
    code, out, tcode, test_line, _ = run_suite(prev, commit, f"canary-{commit[:7]}")
    lines = [l for l in out.splitlines() if l.startswith(("✓", "✗"))] + [test_line]
    stamped = stamp_checks(code, out, lines)
    failed = [name for name, (state, _) in stamped.items() if state == "fail"] or (["verify"] if code else ["test"] if tcode else [])
    url = post_stamp(None, commit, "red" if failed else "green", stamped, sentence(f"The {failed[0]} check failed on canary") if failed else None)
    log(f"canary {commit[:7]}: {'red (' + failed[0] + ')' if failed else 'green'} {url}")
    if failed:
        notify(f"canary {commit[:7]} is stamped red ({failed[0]}): every merge waits until it is fixed {url}")
    return not failed


def test(pr):
    n, sha = pr["number"], pr["headRefOid"]
    stop_stack()
    _, prev = git("rev-parse", "HEAD")
    code, out = git("checkout", "-q", "-B", BRANCH, sha)
    if code:
        raise RuntimeError(f"checkout {sha[:7]}: {out.strip()[:200]}")
    # read canary fresh at the start of every run, lanes included, so a merge since the batch began is caught (builder, 7 Oct)
    git("fetch", "-q", "origin", timeout=300)
    # a head behind canary is checked as it would land: merged locally with current canary, never pushed (builder, 6 Oct)
    # every PASS names the canary and the merge tree it tested, so a worker may land the head as is while both still match (dispatcher's guard)
    _, canary_sha = git("rev-parse", "origin/canary")
    canary_sha = canary_sha.strip()
    canary7 = canary_sha[:7]
    _, t = git("merge-tree", "--write-tree", sha, canary_sha)
    tree7 = t.strip().splitlines()[0][:7] if t.strip() else "-"
    with_canary = f" (with canary {canary7}, tree {tree7})"
    global VERIFY
    VERIFY = diff_needs_verify(canary_sha, sha)
    # GitHub Actions' two jobs green at the head stand for the suite, so a PR's Checks is verify alone, and one off the dashboard paths has none
    if not VERIFY:
        record(n, sha, "skipped", "-", "no dashboard code in the diff; GitHub Actions' jobs stand for the suite")
        return
    if behind(sha):
        code, out = git("-c", "core.hooksPath=/dev/null", "-c", "user.name=ops-checks", "-c", "user.email=ops-checks@local", "merge", "--no-edit", "-q", "origin/canary")
        if code:
            git("merge", "--abort")
            url = post_stamp(n, sha, "red", {"merge": ("fail", f"The head conflicts with canary {canary7}.")}, "Merge canary in and resolve the conflict.")
            record(n, sha, "fail", url, f"conflicts with canary {canary7}")
            tell_owner(n, f"#{n}: stamp red @ {sha[:7]}: conflicts with canary {canary7}; merge canary in and resolve {url}")
            notify(f"#{n} @ {sha[:7]} conflicts with canary {canary7} {url}")
            return
    _, test_sha = git("rev-parse", "HEAD")
    test_sha = test_sha.strip()
    code, out, notes = in_slot("verify", label=f"pr{n}-{sha[:7]}", prev=prev.strip(), test_sha=test_sha)
    git("fetch", "-q", "origin", timeout=300)
    _, head = run(["gh", "pr", "view", str(n), "--repo", REPO, "--json", "headRefOid", "--jq", ".headRefOid"], timeout=60)
    # every playground PR body is the PR template, whose TL;DR the Changelog reads its line from
    _, pr_body = run(["gh", "pr", "view", str(n), "--repo", REPO, "--json", "body", "--jq", ".body"], timeout=60)
    body_why = body_refusal(pr_body)
    body_ok = not body_why
    body_line = "✓ pr-body  the PR body is the PR template" if body_ok else f"✗ pr-body  {body_why}"
    secrets_line, leaked = secret_scan(canary_sha, sha) if SECRET_SCAN else (None, False)
    # a head that moved while this ran still gets its verdict, named by the sha it ran, so pr:merge's carry-over keeps a green H
    moved = head.strip() if re.fullmatch(r"[0-9a-f]{40}", head.strip()) and head.strip() != sha else ""
    if code is None:
        lines, failed = [x for x in (body_line, secrets_line) if x], "preflight"
    else:
        lines = ([l for l in out.splitlines() if l.startswith(("✓", "✗"))] or [out.strip()[-300:]]) + [x for x in (body_line, secrets_line) if x]
        bad = [l for l in lines if l.startswith("✗")]
        bad = [l for l in bad if not l.startswith(("✗ pr-body", "✗ secrets"))]
        failed = re.split(r"\s{2,}", bad[0][2:].strip())[0] if bad else ("verify" if code else "secrets" if leaked else "" if body_ok else "PR body")
    status = "red" if failed else "green"
    first = f"stamp {status} @ {sha[:7]}{with_canary}" + (f": {failed}" if failed else "")
    stamped = stamp_checks(code, out, lines)
    said = ", and ".join(x for x in (f"the {failed} check failed" if failed else "", f"the head moved to {moved[:7]} during this run" if moved else "") if x)
    url = post_stamp(n, sha, status, stamped, sentence(said) if said else None)
    if SECRET_SCAN and not leaked:
        # the record pr:merge's gitleaks stand-in reads, standing in until GitGuardian reports again
        spath = os.path.join(HERE, f"secrets-pr{n}-{sha[:7]}.md")
        with open(spath, "w") as f:
            f.write(scrub(f"Secret scan: gitleaks clean @ {sha[:7]}\n\n{secrets_line[2:].strip()}. GitGuardian has not reported on this repo since 7 Oct ~13:46Z; this scan stands in for it under the owner's ruling.\n"))
        comment(n, spath)
    moved_note = f"head moved to {moved[:7]} before posting" if moved else ""
    # passes.json follows the PR's current head, so a moved head's verdict leaves it alone
    record(n, sha, "fail" if failed else "pass", url, "; ".join(x for x in (failed, moved_note) if x), canary=None if moved else canary_sha)
    tell_owner(n, f"#{n}: {first}{f' ({moved_note})' if moved else ''} {url}")
    if failed:
        notify(f"#{n} @ {sha[:7]} {first}{f' ({moved_note})' if moved else ''} {url}")


def queue():
    code, out = run(["gh", "pr", "list", "--repo", REPO, "--base", "canary", "--state", "open", "--json", "number,headRefOid,isDraft,author"], timeout=120)
    if code:
        raise RuntimeError(f"gh pr list: {out.strip()[:200]}")
    done = ledger()
    # only the factory's own PRs: a check runs the PR's code (its tests, its dev stack) on this machine, so a PR from any
    # other account is never run here, however it is asked for (an outside PR proposing every session skip permissions)
    prs = [p for p in json.loads(out) if (p.get("author") or {}).get("login") == OWNER]
    mine = {p["number"] for p in prs}
    asked = [p for p in take_reverify() if p["number"] in mine]
    todo = asked + [p for p in prs if p["headRefOid"] not in done]
    git("fetch", "-q", "origin", timeout=300)
    # a canary move makes every earlier pass stale for the merge guard: re-test, unasked, each merge-queued head whose pass names an older canary
    try:
        queued_prs = {int(x["pr"]) for x in json.load(open(os.path.join(os.path.dirname(OPS), "merge-queue.json"))).get("queue", []) if str(x.get("pr") or "").isdigit()}
    except Exception:
        queued_prs = set()
    _, cur = git("rev-parse", "origin/canary")
    passes = load_json(PASSES, {})
    taken = {(p["number"], p["headRefOid"]) for p in todo}
    for p in prs:
        last = passes.get(str(p["number"]))
        if p["number"] in queued_prs and not p["isDraft"] and last and last["sha"] == p["headRefOid"] and last["canary"] != cur.strip() and (p["number"], p["headRefOid"]) not in taken:
            todo.append(p)
    if not todo:
        return []
    def pushed(p):
        _, t = git("log", "-1", "--format=%ct", p["headRefOid"])
        return int(t.strip() or 0)
    # merge-queue order first (the Builder keeps merge-queue.json in the data folder, so runs go in merge-queue order),
    # then re-verify requests in the order asked, then the rest; any re-verify not taken goes back on the list, so none is lost
    try:
        mq = [int(x["pr"]) for x in json.load(open(os.path.join(os.path.dirname(OPS), "merge-queue.json"))).get("queue", []) if str(x.get("pr") or "").isdigit()]
    except Exception:
        mq = []
    rank = {n: i for i, n in enumerate(mq)}
    # merges take turns (builder, 7 Oct: "test the next PR in turn right after each merge"): walk the merge queue to the first open PR
    # without a pass at the current canary and test only that one; a PR whose head failed waits for its next head and is passed over;
    # once the PR whose turn it is holds a current pass, nothing else in the queue is tested until it merges (its merge moves canary)
    heads = {p["number"]: p for p in prs}
    turn = None
    for n in mq:
        p = heads.get(n)
        if not p or p["isDraft"]:
            continue
        last = passes.get(str(n))
        if last and last["sha"] == p["headRefOid"] and last["canary"] == cur.strip():
            break
        turn = next((t for t in todo if t["number"] == n and t["headRefOid"] == p["headRefOid"]), None)
        if turn:
            break
    others = [p for p in todo if p["number"] not in rank]
    queued = [turn] if turn else []
    ordered = queued + sorted([p for p in others if p not in asked], key=lambda p: (p["isDraft"], pushed(p))) + [p for p in asked if p["number"] not in rank]
    if not ordered:
        rest = [p for p in asked]
        if rest:
            with open(REVERIFY, "a") as f:
                f.writelines(f"{p['number']} {p['headRefOid']}\n" for p in rest)
        return []
    rest = [p for p in asked if p is not ordered[0]]
    if rest:
        with open(REVERIFY, "a") as f:
            f.writelines(f"{p['number']} {p['headRefOid']}\n" for p in rest)
    return ordered


# The gitleaks stand-in ran until GitGuardian reported again; it reported again on 7 Oct, so the scan and its comment are off
SECRET_SCAN = False


def template_body(body):
    """Whether a PR body is the PR template: a TL;DR of 2 sentences or more first, then Summary, Evidence, Merge Danger and Links, in order."""
    lines = [line for line in body.splitlines() if line.strip()]
    # a heading inside a code fence is a sample, not a section
    heads, fenced = [], False
    for line in lines:
        if re.match(r"^\s*(?:```|~~~)", line):
            fenced = not fenced
        m = None if fenced else re.match(r"^##\s+(.+?)\s*$", line)
        heads.append(re.sub(r"^tldr$", "tl;dr", m.group(1).lower()) if m else "")
    at = [heads.index(name) if name in heads else -1 for name in ("tl;dr", "summary", "evidence", "merge danger", "links")]
    # a bullet is a sentence of its own, its closing stop optional
    tldr_lines = [re.sub(r"(?<![.!?])$", ".", m.group(1).rstrip()) if (m := re.match(r"^\s*[-*+]\s+(.*)$", line)) else line
                  for line in (lines[1:at[1]] if at[1] > 0 else [])]
    tldr = re.sub(r"^\**Outcome\**\s*:\**\s*", "", " ".join(tldr_lines))
    sentences = len(re.findall(r"[^.!?]*\w[^.!?]*[.!?](?=\s|$)", tldr))
    return at[0] == 0 and all(at[k] > at[k - 1] for k in range(1, len(at))) and sentences >= 2


def tldr_label(body):
    """The Outcome label a line of a body's TL;DR opens with, up to its next ## heading, a bullet's, a numbered item's, a quote's
    or a bold one included, else None."""
    lines = body.splitlines()
    at = next((i for i, line in enumerate(lines) if re.match(r"^##\s+tl;?dr\s*$", line, re.I)), -1)
    if at == -1:
        return None
    for line in lines[at + 1:]:
        if re.match(r"^#{1,2}\s", line):
            break
        if m := re.match(r"^\s*(?:(?:[-*+>]|\d+[.)])\s*)?(?:\*\*|__)?(Outcome)(?:\*\*|__)?\s*:", line, re.I):
            return m.group(1)
    return None


def body_refusal(body):
    """Why Checks and the ready gate refuse a PR's body, or None when they take it, as body.ts's bodyRefusal: the PR template, its TL;DR
    holding no Outcome label line."""
    label = tldr_label(body)
    if label:
        return f'its body\'s TL;DR holds a line labelled "{label}:", which the pr skill\'s template (extensions/core/skills/pr/SKILL.md) leaves out; delete that line'
    if template_body(body):
        return None
    return "its body needs the PR template: a TL;DR of 2 sentences or more, the pr skill's Summary, Evidence and Merge Danger, then Links (extensions/core/skills/pr/SKILL.md)"


def secret_scan(canary, sha):
    """gitleaks over the PR's own commits (canary..head), in its official image with the main checkout mounted read-only: the stand-in
    for GitGuardian, which stopped reporting on this repo on 7 Oct (builder). Returns (line, leaked); a scan that cannot run fails closed."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(WT)))
    code, out = run(["docker", "run", "--rm", "-v", f"{root}:/repo:ro", "ghcr.io/gitleaks/gitleaks:latest", "detect", "--source", "/repo", "--log-opts", f"{canary}..{sha}", "--no-banner", "--redact"], timeout=300)
    m = re.search(r"(\d+) commits scanned", out)
    if code == 0 and "no leaks found" in out:
        return f"✓ secrets  gitleaks: no leaks in {m.group(1) if m else '?'} commits ({canary[:7]}..{sha[:7]})", False
    if code == 1 and "leaks found" in out:
        n = re.search(r"leaks found: (\d+)", out)
        return f"✗ secrets  gitleaks: {n.group(1) if n else 'some'} leak(s) in {canary[:7]}..{sha[:7]}; run gitleaks locally on the branch (redacted here)", True
    return f"✗ secrets  gitleaks could not run: {out.strip()[-120:]}", True


def heartbeat():
    while True:
        try:
            beat("ops-checks", os.getpid(), STARTED, 60, last_result)
        except Exception:
            pass
        time.sleep(30)


def main():
    global last_result
    threading.Thread(target=heartbeat, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: (stop_stack(), sys.exit(0)))
    signal.signal(signal.SIGHUP, lambda *_: (stop_stack(), sys.exit(0)))
    log("ops-checks armed")
    errors = 0
    while True:
        try:
            todo = queue()
            if not todo:
                errors, last_result = 0, "ok"
            if todo:
                test(todo[0])
                errors, last_result = 0, "ok"
                continue
        except Exception as e:
            stop_stack()
            errors += 1
            tb = __import__("traceback").extract_tb(e.__traceback__)
            log(f"error: {e}" + (f" (at line {tb[-1].lineno}: {tb[-1].line})" if tb else ""))
            # one network blip is not a failing job: the heartbeat reads failing from the second error in a row
            if errors >= 2:
                last_result = f"error: {e}"[:120]
            if errors in (1, 3):
                notify(f"script error ({errors} in a row): {str(e)[:200]}")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    # run-slot's child for one phase of a Checks run
    if len(sys.argv) == 3 and sys.argv[1] == "--phase":
        sys.exit(phase_main(sys.argv[2]))
    # the ops-checks loop is retired (12 Oct: the merge train and the Checks lanes replace it); 18 Oct a `checks.py --help` armed it
    sys.exit(f"checks.py is a library now: the ops-checks loop is retired. Run Checks on one PR with `python3 -I {os.path.join(OPS, 'checks', 'parallel.py')} <n>`.")
