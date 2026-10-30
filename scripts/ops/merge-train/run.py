#!/usr/bin/env python3
"""ops-merge-train: the merge train as a script ops job, no model, no session; Ops runs it, and it shows under Runners.

Merge on ready first (merge_ready): a PR whose every gate passes, its stamp included, merges at once. With no train running, canary's tip
is checked once it has moved, NET_EVERY seconds at the soonest after the last check ends and, for up to NET_YIELD_MAX past that, never while a ready PR's Checks wait for a run slot, and its stamp
posted on the commit (canary_net, the net). Then every CYCLE seconds, in its own worktree reset to origin/canary (.claude/worktrees/train), it asks `bun run pr:train next --json`:
  none   build a train (`pr:train build`), at most once every BUILD_EVERY seconds
  empty  end it (`pr:train end`)
  check  check that step's commit in Checks lane 1 (checks.test_train), posting the verdict on every PR up to the step,
         only while it holds the machine's one run slot (ops/run-slot; one local CI or Checks run at a time, dispatcher's rule)
  land   `pr:train land --json`; on "refused" `pr:train end` (the next build re-gates every PR); on "locked" the next cycle
Single instance (flock); the heartbeat (ops-merge-train.json) beats from a thread, so a long check never reads as down.
"""
import fcntl, importlib.util, json, os, re, subprocess, sys, threading, time

HERE = os.path.expanduser("~/.playground/ops/merge-train")  # the state folder by name, so a run by its repo path still reads the live state
OPS = os.path.dirname(HERE)
sys.path.insert(0, OPS)
from beat import beat, checkout  # noqa: E402

ROOT = checkout()
WT = os.path.join(ROOT, ".claude", "worktrees", "train")
SLOT = os.path.join(OPS, "run-slot")
TRAINS = os.path.join(os.path.dirname(OPS), "trains")
NO_BUILD = os.path.join(HERE, "no-build")
NO_READY = os.path.join(HERE, "no-ready")  # a file here pauses merge-on-ready
CANARY_NET = os.path.join(HERE, "canary-net.json")  # the net's state: the tip it last checked, canary's last green commit, its first red one, the culprit, and when it last checked
NET_EVERY = 3600  # dispatcher: a full check of canary holds a slot 45 to 60 minutes under load, so a new tip waits out the hour
NET_YIELD_MAX = 3600  # past NET_EVERY, a new tip yields to ready PRs' Checks this long at most, so a queue that never empties still gets canary checked
WAITERS = os.path.join(OPS, "run-slot.waiters")
MERGE_QUEUE = os.path.join(os.path.dirname(OPS), "merge-queue.json")
BUILD_EVERY = 0  # merge on ready, no cadence: every cycle merges what its stamp covers and checks the rest at once
CORES = os.cpu_count() or 16
# The gitleaks stand-in applies only while GitGuardian does not report; it reports again since 7 Oct ~17:30Z
SECRET_SCAN = os.environ.get("TRAIN_SECRET_SCAN") == "gitleaks"
STARTED = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

lock = open(os.path.join(HERE, "run.lock"), "w")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit("ops-merge-train is already running")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


checks = load("checks", os.path.join(OPS, "checks", "checks.py"))
lanes = load("parallel", os.path.join(OPS, "checks", "parallel.py"))
CYCLE = checks.setting("jobs.opsMergeTrain")["schedule"].get("every", 60)  # the job's own schedule, so moving it is a settings write
state = {"result": "ok", "detail": "starting", "last_build": 0.0, "rebuild_now": True}


def log(line):
    with open(os.path.join(HERE, "train.log"), "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {line}\n")


def heartbeat():
    while True:
        try:
            beat("ops-merge-train", os.getpid(), STARTED, CYCLE, state["result"], {"detail": state["detail"]})
        except Exception:
            pass
        time.sleep(30)


def sh(argv, timeout=900):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, cwd=WT, env=checks.clean_env())
    return r.returncode, (r.stdout or ""), (r.stderr or "")


def train(*args, timeout=900):
    code, out, err = sh(["bun", "run", "--silent", "pr:train", *args], timeout=timeout)
    return code, out.strip(), err.strip()


def first_error(text):
    return next((l.strip() for l in text.splitlines() if l.strip()), "")[:110]


def take_any_slot(holder):
    """The first free run slot: run-slot, else run-slot-2, which a train's check takes at any load (testers and scripted runs keep the load rule)."""
    global SLOT
    # run-slot.priority (a lead's pick for the next run-slot, under an hour old) keeps the train on run-slot-2
    pri = os.path.join(OPS, "run-slot.priority")
    try:
        reserved = time.time() - os.path.getmtime(pri) < 3600 and open(pri).read().split()[0] != holder
    except (OSError, IndexError):
        reserved = False
    first = "reserved" if reserved else take_slot_at(os.path.join(OPS, "run-slot"), holder)
    if first is None:
        SLOT = os.path.join(OPS, "run-slot")
        return None
    # run-slot.single (builder, 9 Oct: heavy suites one at a time) closes slots 2 and 3 to new holders while it exists
    # single-slot mode no longer holds the train back (12 Oct: it waited an hour behind testers' runs with a PR ready): it still takes slot 2
    # a train carries only PRs that are ready, so its check never waits behind a tester's run: it takes the second slot at any load (dispatcher, 7 Oct)
    if take_slot_at(os.path.join(OPS, "run-slot-2"), holder) is None:
        SLOT = os.path.join(OPS, "run-slot-2")
        return None
    # run-slot.3-off closes slot 3 to the train too, as in run-slot.sh (dispatcher, 18 Oct 19:5xZ)
    if os.getloadavg()[0] < 12 and not os.path.exists(os.path.join(OPS, "run-slot.3-off")) and take_slot_at(os.path.join(OPS, "run-slot-3"), holder) is None:
        SLOT = os.path.join(OPS, "run-slot-3")
        return None
    return first


def take_slot_at(path, holder):
    global SLOT
    SLOT = path
    return take_slot(holder)


def take_slot(holder):
    """The machine's one run slot (dispatcher: one local CI or Checks run at a time). Taking it is `mkdir ops/run-slot` (only one process can)
    and writing "<who> <pid> <iso>" to ops/run-slot.holder beside it; releasing is `rmdir ops/run-slot` alone, since the folder stays empty
    (workers may not rm). A slot whose holder pid has died is reclaimed. Returns None when taken, else who holds it."""
    for _ in range(2):
        try:
            os.mkdir(SLOT)
            with open(SLOT + ".holder", "w") as f:
                f.write(f"{holder} {os.getpid()} {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")
            return None
        except FileExistsError:
            try:
                who = open(SLOT + ".holder").read().strip()
            except OSError:
                who = ""
            try:
                os.kill(int(who.split()[1]), 0)
                return who
            except ProcessLookupError:
                free_slot()
            except (OSError, ValueError, IndexError):
                # a holder line with no pid (a session writing its own shape) is held, not dead, until it is 2 hours old
                try:
                    if time.time() - os.path.getmtime(SLOT + ".holder") < 7200:
                        return who or "unknown"
                except OSError:
                    pass
                free_slot()
    return "unknown"


def free_slot():
    try:
        os.remove(os.path.join(SLOT, "holder"))  # the old shape kept the holder inside
    except OSError:
        pass
    try:
        os.rmdir(SLOT)
    except OSError:
        pass


def sync():
    """The train's worktree follows origin/canary, so pr:train is the code canary carries; install when the lockfile moved, build the packages when the reset moved any (a merged PR's new export has no dist until built: the train stopped on a PR's verdicts, 23:02Z)."""
    _, before, _ = sh(["git", "rev-parse", "HEAD"])
    sh(["git", "fetch", "-q", "origin", "canary"], timeout=300)
    sh(["git", "reset", "-q", "--hard", "origin/canary"])
    code, _, _ = sh(["git", "diff", "--quiet", before.strip(), "HEAD", "--", "bun.lock"])
    if code:
        sh(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], timeout=900)
    code, _, _ = sh(["git", "diff", "--quiet", before.strip(), "HEAD", "--", "packages"])
    if code:
        sh(["bun", "run", "turbo", "run", "build", "--filter=./packages/*"], timeout=900)


def tell_lead(text):
    # builder, 20 Oct: an auto-merge sends "merged #N <sha>" so the queue's overlap check runs at once
    subprocess.Popen([os.path.join(OPS, "notify.sh"), "merge-train", text], env={**os.environ, "NOTIFY_TO": "builder"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def net_target(st, tip, between):
    """Pure: what the net does next, from its state st: ("check", sha) for a new tip, for a red commit once more (a flake clears on a green
    re-run, the newest stamp of its kind), then for the halving's midpoint along canary's first parents strictly between the last green commit
    and the first red one (between, oldest first); ("culprit", sha) once nothing lies between; None when there is nothing to do."""
    if not st.get("bad") or st.get("culprit"):
        return ("check", tip) if tip != st.get("checked") else None
    if not st.get("retried"):
        return ("check", st["bad"])
    return ("check", between[len(between) // 2]) if between else ("culprit", st["bad"])


def net_record(st, tip, sha, green):
    """Pure: the net's state after sha checked green or not."""
    if not st.get("bad") or st.get("culprit"):
        return {"checked": tip, "good": tip} if green else {"bad": tip, "checked": tip, "good": st.get("good", "")}
    if not st.get("retried"):
        return {"checked": st["checked"], "good": sha} if green else {**st, "retried": True}
    return {**st, "good": sha} if green else {**st, "bad": sha}


def clock():
    return time.time()


def ready_waiting():
    """The ready PRs (merge-queue.json entries with the lead's go at 5/5, goAt, or a readyAt) whose Checks run waits for a run slot now:
    a live run-slot.waiters ticket named ops-checks-<n>[-<m>]."""
    try:
        ready = {e["pr"] for e in json.load(open(MERGE_QUEUE))["queue"] if isinstance(e, dict) and isinstance(e.get("pr"), int) and (isinstance(e.get("goAt"), str) or isinstance(e.get("readyAt"), str))}
        tickets = os.listdir(WAITERS)
    except (OSError, ValueError, KeyError, TypeError):
        return []
    found = set()
    for t in tickets:
        parts = t.split("-", 2)
        m = re.match(r"ops-checks-([\d-]+)$", parts[2]) if len(parts) == 3 and parts[1].isdigit() else None
        if not m:
            continue
        try:
            os.kill(int(parts[1]), 0)
        except ProcessLookupError:
            continue
        except OSError:
            pass
        found |= {int(n) for n in m.group(1).split("-") if n} & ready
    return sorted(found)


def canary_net():
    """The net: canary's own run after each batch. It checks each new tip in lane 1 and posts its stamp on the commit
    (checks.test_canary), where a red one stops every merge; it checks a red tip once more, then halves to the merge that turned canary red
    and tells the lead and the owner to revert it. A new tip on a green canary waits out NET_EVERY and yields to a ready PR's Checks waiting
    for a slot for NET_YIELD_MAX at most, both measured from the last check's `at` so a restart keeps them; a red one is checked at once, since it already holds every merge. None when there is nothing to do."""
    code, out, _ = sh(["git", "-C", ROOT, "ls-remote", "origin", "refs/heads/canary"], timeout=60)
    tip = out.split()[0] if code == 0 and out.split() else ""
    try:
        st = json.load(open(CANARY_NET))
    except (OSError, ValueError):
        st = {}
    between = []
    if tip and st.get("bad") and st.get("retried") and st.get("good") and not st.get("culprit"):
        sh(["git", "-C", ROOT, "fetch", "-q", "origin", "canary"], timeout=300)
        code, out, _ = sh(["git", "-C", ROOT, "rev-list", "--first-parent", "--reverse", f"{st['good']}..{st['bad']}"], timeout=60)
        between = out.split()[:-1] if code == 0 else []
    step = net_target(st, tip, between) if tip else None
    if not step:
        return None
    kind, sha = step
    if kind == "check" and not st.get("bad"):
        since = clock() - st.get("at", 0)
        if since < NET_EVERY:
            return None
        waiting = ready_waiting() if since < NET_EVERY + NET_YIELD_MAX else []
        if waiting:
            return "ok", f"canary's run of {sha[:7]} yields to the Checks of ready " + ", ".join(f"#{n}" for n in waiting)
    if kind == "culprit":
        _, subject, _ = sh(["git", "-C", ROOT, "log", "-1", "--format=%s", sha], timeout=60)
        st = {**st, "culprit": sha}
        with open(CANARY_NET, "w") as f:
            json.dump(st, f)
        # with no green commit known before it the net cannot halve, so it names the red tip and says so
        where = f"turned red at {sha[:7]}" if st.get("good") else f"is red at {sha[:7]}, and no earlier commit is known green, so the net could not halve"
        text = f"canary {where} ({subject.strip()[:80]}): revert it in a PR that merges canary in; a green run of its own on that head passes the canary gate"
        tell_lead(text)
        checks.notify(text)
        return "ok", text
    holder = take_any_slot("ops-merge-train")
    if holder:
        return "ok", f"canary's run waits for the run slot, held by {holder.split()[0]}"
    try:
        log(f"check canary {sha[:7]}")
        state["detail"] = f"checking canary {sha[:7]} on {os.path.basename(SLOT)}"
        wt, db = lanes.prepare(1)
        checks.WT, checks.BRANCH, checks.DBC = wt, "live/chk-1", db
        checks.DEVLOG = os.path.join(OPS, "checks", "dev-chk-1.log")
        checks.PGIDS = os.path.join(OPS, "checks", "stack-chk-1.pgids")
        checks.stack = None
        try:
            green = checks.test_canary(sha)
        finally:
            checks.stop_stack()
    finally:
        free_slot()
    with open(CANARY_NET, "w") as f:
        json.dump({**net_record(st, tip, sha, green), "at": clock()}, f)
    return "ok", f"checked canary {sha[:7]}: {'green' if green else 'red'}"


def merge_ready():
    """Merge-on-ready: a PR ready before another merges straight away. `pr:train ready`
    merges, through pr:merge, the first PR in queue order whose every gate passes at its head: its stamp holds there or carries past clean
    canary merges, so it merges with no new run. One merge per call; returns a detail, or None."""
    if os.path.exists(NO_READY):
        return None
    code, out, err = train("ready", "--json", timeout=900)
    if code:
        log(f"merge-on-ready: pr:train ready exited {code}: {first_error(err or out)}")
        return None
    try:
        merged = json.loads(out[out.index("{"):]).get("merged")
    except ValueError:
        return None
    if not merged:
        return None
    n, sha = merged["n"], merged["sha"]
    log(f"merge-on-ready #{n} at {sha[:7]}: {merged.get('why', '')}")
    checks.tell_owner(n, f"#{n}: merged on ready as {sha[:7]}")
    tell_lead(f"merged #{n} {sha[:7]} (merge-on-ready)")
    state["rebuild_now"] = True
    return f"merged #{n} on ready as {sha[:7]}"


def fingerprint():
    """What a scan depends on: canary's head (git, no API) and each open PR's number, head and update time (one GraphQL call). None on failure."""
    code, out, err = sh(["gh", "pr", "list", "--repo", checks.REPO, "--state", "open", "--limit", "100", "--json", "number,headRefOid,updatedAt,isDraft"], timeout=60)
    if code:
        if "rate limit" in (err + out).lower():
            raise RateLimited(err or out)
        return None
    _, canary, _ = sh(["git", "rev-parse", "origin/canary"])
    return canary.strip() + "|" + "|".join(sorted(f"{p['number']}:{p['headRefOid'][:12]}:{p['updatedAt']}:{p['isDraft']}" for p in json.loads(out or "[]")))


class RateLimited(Exception):
    pass


def graphql_reset():
    """Seconds until the GraphQL window resets (gh api rate_limit is free of charge), at least 60 and at most an hour."""
    code, out, _ = sh(["gh", "api", "rate_limit", "--jq", ".resources.graphql.reset"], timeout=30)
    try:
        return max(60, min(3600, int(out.strip()) - int(time.time()) + 5))
    except ValueError:
        return 600


def cycle():
    # the train never holds ready PRs for one that is not ready (dispatcher, 7 Oct): a hotfix leads the next train once it is gated
    sync()
    code, out, err = train("next", "--json", timeout=300)
    if code:
        return f"error: pr:train next: {first_error(err or out)}", ""
    data = json.loads(out[out.index("{"):])
    nxt = data.get("next", {})
    kind = nxt.get("kind")
    if kind in ("none", "check"):
        # GitHub's GraphQL budget (5000/h, shared by the whole factory) went on scanning every open PR every minute (8 Oct): scan only when an
        # open PR's head or update time, or canary, changed since the last scan; one cheap list call per cycle decides
        fp = fingerprint()
        if fp is None:
            return "ok", "skipped: could not list PRs (GitHub API), next cycle"
        if fp == state.get("fingerprint") and not state["rebuild_now"] and kind == "none":
            # the net's next step (a tip the slot kept it from, a red re-check, the halving) changes no fingerprint, so it runs here too
            return canary_net() or ("ok", "no train; nothing changed since the last scan")
        state["fingerprint"] = fp
        merged = merge_ready()
        if merged:
            if kind == "check":
                train("end")
                log(f"train ended unchecked: {merged}, so canary moved under it")
            return "ok", merged
    if kind == "none":
        net = canary_net()
        if net:
            return net
    if kind == "none" and os.path.exists(NO_BUILD):
        # merging one by one is quicker than a train: no new trains while no-build
        # exists; merge-on-ready above still merges each PR whose own gates pass (per-PR Checks at its head merged with canary)
        return "ok", "train building off (no-build)" + ("; merge-on-ready paused (no-ready)" if os.path.exists(NO_READY) else ": merge-on-ready only")
    if kind == "none":
        # no cadence: whatever is ready and was not merged on ready rides one check now
        state["last_build"], state["rebuild_now"] = time.time(), False
        code, out, err = train("build", *(["--secret-scan=gitleaks"] if SECRET_SCAN else []), timeout=1800)
        log(f"build: exit {code}: {first_error(out) or first_error(err)}")
        return ("ok", f"built: {first_error(out)}") if code == 0 else (f"error: pr:train build: {first_error(err or out)}", "")
    if kind == "empty":
        code, out, err = train("end")
        log(f"empty train ended: exit {code}")
        state["rebuild_now"] = True
        return ("ok", "empty train ended") if code == 0 else (f"error: pr:train end: {first_error(err or out)}", "")
    if kind == "check":
        k = int(nxt["step"])
        ids = sorted(f[:-5] for f in os.listdir(TRAINS) if f.endswith(".json"))
        if not ids:
            return "error: a check is due but trains/ holds no running train", ""
        tid = ids[-1]
        tr = json.load(open(os.path.join(TRAINS, f"{tid}.json")))
        step = tr["steps"][k - 1]
        prs = [s["n"] for s in tr["steps"][:k]]
        # builder, 9 Oct: a check of a PR merged by hand, or on a canary that has moved, is wasted (land refuses it anyway): end the train unchecked
        stale = []
        code, out, _ = sh(["git", "-C", ROOT, "ls-remote", "origin", "refs/heads/canary"], timeout=60)
        if code == 0 and out.split() and out.split()[0] != tr["canary"]:
            stale.append(f"canary moved to {out.split()[0][:7]}")
        for n in prs:
            code, out, _ = sh(["gh", "api", f"repos/{checks.REPO}/pulls/{n}", "--jq", ".state + \" \" + (.merged|tostring) + \" \" + .head.sha"], timeout=60)
            parts = out.split()
            if code == 0 and len(parts) == 3 and (parts[0] != "open" or parts[1] == "true"):
                stale.append(f"#{n} {'merged' if parts[1] == 'true' else parts[0]}")
            elif code == 0 and len(parts) == 3 and parts[2] != next(st["head"] for st in tr["steps"] if st["n"] == n):
                stale.append(f"#{n} moved to {parts[2][:7]}")
        if stale:
            log(f"skip check of train {tid} step {k}: " + ", ".join(stale) + "; ending it")
            train("end")
            state["rebuild_now"] = True
            return "ok", f"train {tid} stale (" + ", ".join(stale) + "): ended unchecked"
        holder = take_any_slot("ops-merge-train")
        if holder:
            return "ok", f"waiting for the run slot, held by {holder.split()[0]}"
        try:
            log(f"check train {tid} step {k} @ {step['commit'][:7]} on " + " ".join(f"#{n}" for n in prs))
            state["detail"] = f"checking train {tid} step {k} on {os.path.basename(SLOT)}: " + " ".join(f"#{n}" for n in prs)
            wt, db = lanes.prepare(1)
            checks.WT, checks.BRANCH, checks.DBC = wt, "live/chk-1", db
            checks.DEVLOG = os.path.join(OPS, "checks", "dev-chk-1.log")
            checks.PGIDS = os.path.join(OPS, "checks", "stack-chk-1.pgids")
            checks.stack = None
            try:
                checks.test_train(tid, k, step, prs)
            finally:
                checks.stop_stack()
        finally:
            free_slot()
        return "ok", f"checked train {tid} step {k}"
    if kind == "land":
        code, out, err = train("land", "--json", *(["--secret-scan=gitleaks"] if SECRET_SCAN else []), timeout=1800)
        try:
            landed = json.loads(out[out.index("{"):])
        except ValueError:
            landed = {}
        lk = landed.get("kind")
        log(f"land up to step {nxt.get('upTo')}: {lk or 'exit ' + str(code)} {json.dumps(landed)[:300]}")
        if lk in ("refused", "landed"):
            state["rebuild_now"] = True
        if lk == "refused":
            train("end")
            return "ok", "land refused: ended the train; the next build re-gates"
        if lk == "locked":
            return "ok", f"land waits: merge lock held by {landed.get('holder', '?')}"
        if lk == "landed":
            merged = " ".join(f"#{m['n']}" for m in landed.get("merged", []))
            for m in landed.get("merged", []):
                checks.tell_owner(m["n"], f"#{m['n']}: merged by the train as {m['sha'][:7]}")
                tell_lead(f"merged #{m['n']} {m['sha'][:7]} (train)")
            return ("ok", f"landed {merged}") if not landed.get("stopped") else (f"error: the land stopped midway: {landed['stopped'][:80]}", merged)
        return f"error: pr:train land: {first_error(err or out)}", ""
    return f"error: pr:train next gave {kind!r}", ""


threading.Thread(target=heartbeat, daemon=True).start()
log("ops-merge-train armed")
failures = 0
while True:
    try:
        state["result"], state["detail"] = cycle()
        if "rate limit" in (state["result"] + state["detail"]).lower():
            raise RateLimited(state["result"])
    except RateLimited:
        # back off until GitHub's GraphQL window resets, rather than spend the next window's first calls retrying (builder, 8 Oct)
        wait = graphql_reset()
        until = time.strftime("%H:%M:%SZ", time.gmtime(time.time() + wait))
        state["result"], state["detail"] = "ok", f"GitHub GraphQL rate limit: backing off until {until}"
        log(state["detail"])
        try:
            beat("ops-merge-train", os.getpid(), STARTED, CYCLE, state["result"], {"detail": state["detail"]})
        except Exception:
            pass
        time.sleep(wait)
        continue
    except Exception as e:
        state["result"], state["detail"] = f"error: {type(e).__name__}: {e}"[:120], ""
    if state["result"].startswith("error"):
        failures += 1
        log(state["result"])
        if failures in (2, 10):
            checks.notify(f"merge train: {state['result']}")
    else:
        failures = 0
    try:
        beat("ops-merge-train", os.getpid(), STARTED, CYCLE, state["result"], {"detail": state["detail"]})
    except Exception:
        pass
    time.sleep(CYCLE)
