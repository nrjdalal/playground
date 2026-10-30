#!/usr/bin/env python3
"""ops-checks-go: Checks on every PR that has a go, in merge-queue order, with no lead running parallel.py by hand.

Every 120s it lists the open PRs on factory.repo into canary labelled Cloud CI (the go). For each at the head its go named it posts, as the
owner, the stamp GitHub's two gate jobs earned there (stamp-cli.ts's jobs): wait while one is queued, running or cancelled, else green or red. It takes
each whose newest owner ReviewBot verdict at its head reads 5/5, that touches dashboard code, whose stamp (stamp-cli.ts's read) holds no
passed verify and no Checks stamp at that head, and that no lane is running. A stamp carries past clean canary merges, so a canary
move starts no run. Each PR runs as its own parallel.py on a free lane of chk-9 to chk-12, merge-queue.json's order first, then by PR
number, so one long run never holds the next go; a PR whose phase under run-slot left no result goes ahead of that order on the next
pass. A lane is busy while its flock is held (a run by hand or an earlier copy of this job included), and the PR it runs is
its newest `lane chk-<k>: #<n> @ <sha7>` line in checks.log. A PR whose diff touches no dashboard code is skipped once a canary, since
Checks runs only verify, and GitHub's two jobs stamp it. A head is tried at most TRIES times a canary. A run this job started
is stopped whole, by its own group, once it passes RUN_MAX, its PR loses Cloud CI (a take-back) or leaves canary, or its PR's head
moves off it. ops-up starts it (jobs.json, runtime herdr), so a reboot brings it back with the other jobs. Single instance
(flock); heartbeat ops-checks-go.
"""
import fcntl, json, os, re, signal, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
OPS = os.path.dirname(HERE)
sys.path.insert(0, OPS)
from beat import beat, checkout  # noqa: E402

sys.path.insert(0, HERE)
from outside import runs  # noqa: E402
from checks import AGENT_DRIVE_CHECK, OWNER, REPO, VERIFY_CHECK, needs_verify, setting  # noqa: E402

GO = "Cloud CI"
CYCLE = setting("jobs.opsChecksGo")["schedule"].get("every", 120)  # the job's own schedule, so moving it is a settings write
LANES, LANE_START, TRIES, RUN_MAX = 4, 9, 2, 5400
MAX_RUNS = 4  # 4 lanes again from 22 Oct 23:12 IST, memory 63% free; 2 while memory is tight (22 Oct, 21:21 IST: jetsam idle-exit churn with three lanes up)
QUEUE_MAX, LIST_MAX = 6 * 3600, 200
LANE_LINE = re.compile(r"^\S+ lane chk-(\d+): #(\d+) @ ([0-9a-f]{7})")
DIED = re.compile(r"^\S+ lane chk-\d+ error on #(\d+): the \w+ phase under run-slot left no result")
REVIEW = re.compile(r"^## ReviewBot · round \d+: (\d)/5 at ([0-9a-f]{7})")
CHECKOUT = checkout()
STARTED = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
state = {"result": "ok", "detail": "starting"}


def ready(head, firsts, read):
    """True when the newest ReviewBot verdict at head reads 5/5 and the stamp read at head, read (stamp-cli's read, or None when it did not
    read), holds no passed verify, on head or carried past clean canary merges and the reviewer's looks, and no Checks stamp at head itself;
    firsts are the owner's comments' first lines, oldest first."""
    scores = [m.group(1) for f in firsts if (m := REVIEW.match(f)) and m.group(2) == head[:7]]
    if not scores or scores[-1] != "5":
        return False
    if not isinstance(read, dict) or "error" in read:
        return True
    if VERIFY_CHECK in read.get("passed", []):
        return False
    checks = [x.get("checks", {}) for x in read.get("stamps", [])]
    ran = [c for c in checks if AGENT_DRIVE_CHECK not in c and any(v.get("source") == "local" for v in c.values())]
    return not (read.get("at") == head and ran)


def stamp(command, n, head):
    """stamp-cli.ts <command> <n> <head> in the main checkout, once git there holds head and canary's tip: (exit code, stdout)."""
    subprocess.run(["git", "-C", CHECKOUT, "fetch", "-q", "origin", "canary", f"+refs/pull/{n}/head"], capture_output=True, timeout=300)
    r = subprocess.run(["bun", "packages/scripts/src/pr-merge/stamp-cli.ts", command, str(n), head], capture_output=True, text=True, timeout=300, cwd=CHECKOUT)
    if r.returncode:
        log(f"stamp {command} #{n}@{head[:7]}: {(r.stderr or r.stdout).strip()[:200]}")
    return r.returncode, r.stdout


def read_stamp(n, head):
    """What the stamp reads at #n's head, as stamp-cli's read prints it, or None."""
    code, out = stamp("read", n, head)
    try:
        return json.loads(out) if code == 0 else None
    except ValueError:
        return None


def stamp_jobs(prs):
    """Post, for each PR with a go at its head, the stamp GitHub's two jobs earned there; stamp-cli writes each status once."""
    gone = gos()
    for p in prs:
        n, head = p["number"], p["headRefOid"]
        if labelled(p) and (n, head) in gone and runs((p.get("author") or {}).get("login"), OWNER, n, head):
            code, out = stamp("jobs", n, head)
            if code == 0 and out.strip():
                log(f"stamped #{n}@{head[:7]} from GitHub's jobs: {out.strip()}")


def died(lines):
    """The PRs whose phase under run-slot left no result since their newest `lane chk-<k>: #<n>` line in checks.log, such as the 25 Oct 22:25Z init_sys_streams fault, so the next pass runs them first."""
    out = set()
    for line in lines:
        if m := DIED.match(line):
            out.add(int(m.group(1)))
        elif m := LANE_LINE.match(line):
            out.discard(int(m.group(2)))
    return out


def order(numbers, queue):
    """Merge-queue order first, a PR's first place in it when it is named twice, then the rest by number."""
    rank = {n: i for i, n in reversed(list(enumerate(queue)))}
    return sorted(numbers, key=lambda n: (rank.get(n, len(rank)), n))


def log(line):
    with open(os.path.join(HERE, "go.log"), "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {line}\n")


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(f"gh {args[0]}: {(r.stderr or r.stdout).strip()[:200]}")
    return r.stdout


def queue():
    try:
        q = json.load(open(os.path.join(os.path.dirname(OPS), "merge-queue.json"))).get("queue", [])
        return [int(x["pr"]) for x in q if str(x.get("pr") or "").isdigit()]
    except Exception:
        return []


def gos():
    """(pr, sha) of every ci:go in gos.jsonl: the label outlives a push, so a go counts only at the head it named (builder, 22 Oct: a PR ran at 54efbaa on a label left from its go at f6f236c)"""
    out = set()
    try:
        for line in open(os.path.join(OPS, "gos.jsonl")):
            try:
                g = json.loads(line)
                out.add((int(g["pr"]), g["sha"]))
            except (ValueError, KeyError, TypeError):
                pass
    except OSError:
        pass
    return out


def listed():
    """The open PRs into canary with each one's head, author and labels; labels are filtered by the caller, since --label goes through search, whose index missed a PR's go for 10 minutes on 22 Oct."""
    return json.loads(gh("pr", "list", "--repo", REPO, "--base", "canary", "--state", "open", "--limit", str(LIST_MAX), "--json", "number,headRefOid,author,labels"))


def labelled(p):
    return GO in {l["name"] for l in p.get("labels") or []}


def todo(tried, running, room, canary, prs=None, first=()):
    """Up to room PRs ready for Checks, skipping a head a lane runs (running holds (n, sha7)) or tried TRIES times against canary.
    prs is this cycle's listed(), read here when reap() read none; first goes ahead of the merge queue."""
    prs = listed() if prs is None else prs
    gone = gos()
    heads = {p["number"]: p["headRefOid"] for p in prs if labelled(p) and (p["number"], p["headRefOid"]) in gone and runs((p.get("author") or {}).get("login"), OWNER, p["number"], p["headRefOid"])}
    picked = []
    for n in order(list(heads), [*sorted(first), *queue()]):
        if len(picked) == room:
            break
        if (n, heads[n][:7]) in running or tried.get(f"{n} {heads[n]} {canary}", 0) >= TRIES:
            continue
        if not needs_verify(gh("api", f"repos/{REPO}/pulls/{n}/files", "--paginate", "--jq", ".[] | .filename, (.previous_filename // empty)").split()):
            log(f"#{n}@{heads[n][:7]}: no dashboard code in the diff, so no Checks; GitHub's two jobs stamp it")
            tried[f"{n} {heads[n]} {canary}"] = TRIES
            continue
        firsts = json.loads(gh("api", f"repos/{REPO}/issues/{n}/comments", "--paginate", "--jq", f'[.[] | select(.user.login == "{OWNER}") | .body | split("\\n")[0]]').replace("]\n[", ","))
        if not (ready(heads[n], firsts, read_stamp(n, heads[n])) and still_open(n)):
            continue
        picked.append((n, heads[n]))
    return picked


def still_open(n):
    """Whether #n is still open now, read again just before a start, since the list above can predate a merge (builder, 22 Oct: a PR merged at 06:19:07Z and an explain at 06:19:09Z read it void against the canary holding it, so its lane ran a merged PR again)."""
    state = gh("api", f"repos/{REPO}/pulls/{n}", "--jq", ".state").strip()
    if state != "open":
        log(f"skip #{n}: {state or 'unknown'} since the list was read")
        return False
    return True


def held(k):
    """True while lane chk-<k>'s flock is held by a run."""
    with open(os.path.join(HERE, f"lane-chk-{k}.lock"), "a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return True
        fcntl.flock(f, fcntl.LOCK_UN)
        return False


def lane_runs(lines):
    """The (n, sha7) each lane's newest checks.log line names, by lane number."""
    runs = {}
    for line in lines:
        if m := LANE_LINE.match(line):
            runs[int(m.group(1))] = (int(m.group(2)), m.group(3))
    return runs


def overdue(n, began, now):
    """Whether a run is stuck: RUN_MAX counts work alone, from its last run-slot start (or its own start before any), never time queued for a slot (optimizer, 20 Oct: a PR was stopped 2.5 min after an 88-min wait); a run still queued past QUEUE_MAX is stopped too"""
    last = None
    try:
        for line in open(os.path.join(OPS, "run-slot.runs.log")).read().splitlines()[-3000:]:
            w = line.split()
            if len(w) >= 3 and w[2] == f"ops-checks-{n}" and w[1] in ("ask", "start", "end"):
                t = time.mktime(time.strptime(w[0], "%Y-%m-%dT%H:%M:%SZ")) - time.timezone
                if t >= began - 5:
                    last = (w[1], t)
    except OSError:
        pass
    if last is None:
        return now - began > RUN_MAX
    if last[0] == "ask":
        return now - began > QUEUE_MAX
    return now - last[1] > RUN_MAX


def reap(mine, now):
    """Stop each live run in mine whose PR is no longer open into canary, no longer carries Cloud CI (a take-back) or moved its head off the run's, or that
    is overdue(), by its own group, then drop every ended run. Returns the list it read, or None when mine was empty or the read
    failed; a read that fails or fills LIST_MAX stops nothing on its word, since a PR missing from it may only have been cut off."""
    prs = None
    if mine:
        try:
            prs = listed()
        except (RuntimeError, subprocess.TimeoutExpired, ValueError) as e:
            log(f"list for the live runs: {e}")
    whole = {p["number"]: p for p in prs} if prs is not None and len(prs) < LIST_MAX else None
    for k, (p, n, head, began, out) in list(mine.items()):
        if p.poll() is None:
            pr = whole.get(n) if whole is not None else None
            if whole is not None and not pr:
                why = "no longer open into canary, a close or a new base"
            elif pr and not labelled(pr):
                why = f"its {GO} was taken back"
            elif pr and pr["headRefOid"] != head:
                why = f"its head moved to {pr['headRefOid'][:7]}"
            elif overdue(n, began, now):
                why = f"over {RUN_MAX}s of work with no end, or {QUEUE_MAX}s queued"
            else:
                why = ""
            if why:
                os.killpg(p.pid, signal.SIGTERM)
                p.wait()
                log(f"stopped #{n}@{head[:7]} on chk-{k}: {why}")
        if p.poll() is not None:
            out.close()
            log(f"end #{n}@{head[:7]} on chk-{k} rc={p.returncode}")
            del mine[k]
    return prs


def heartbeat():
    while True:
        try:
            beat("ops-checks-go", os.getpid(), STARTED, CYCLE, state["result"], {"detail": state["detail"][:120]})
        except Exception:
            pass
        time.sleep(30)


def main():
    lock = open(os.path.join(HERE, "go.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.exit("ops-checks-go is already running")
    threading.Thread(target=heartbeat, daemon=True).start()
    tried, errors, mine = {}, 0, {}
    while True:
        try:
            prs = reap(mine, time.time())
            lanes = range(LANE_START, LANE_START + LANES)
            busy = {k for k in lanes if k in mine or held(k)}
            try:
                lines = open(os.path.join(HERE, "checks.log")).read().splitlines()[-500:]
            except OSError:
                lines = []
            logged = lane_runs(lines)
            running = {(n, head[:7]) for _, n, head, _, _ in mine.values()} | {v for k, v in logged.items() if k in busy or held(k)}  # a hand run on any lane counts, so its PR is never run twice (ops, 20 Oct: a PR ran on chk-13 and chk-9 at once)
            free = [k for k in lanes if k not in busy][:max(0, MAX_RUNS - len(busy))]
            prs = listed() if prs is None else prs
            stamp_jobs(prs)
            canary = gh("api", f"repos/{REPO}/commits/canary", "--jq", ".sha").strip() if free else ""
            picked = todo(tried, running, len(free), canary, prs, died(lines)) if free else []
            errors = 0
            for k, (n, head) in zip(free, picked):
                tried[f"{n} {head} {canary}"] = tried.get(f"{n} {head} {canary}", 0) + 1
                out = open(os.path.join(HERE, f"go-chk-{k}.out"), "w")
                # its own group and its own file, so the run outlives a restart of this job and a stop takes the whole of it
                p = subprocess.Popen(["python3", "-I", os.path.join(HERE, "parallel.py"), str(n)], stdout=out, stderr=subprocess.STDOUT, cwd=HERE, env={**os.environ, "LANE_START": str(k)}, start_new_session=True)
                mine[k] = (p, n, head, time.time(), out)
                log(f"start #{n}@{head[:7]} on chk-{k}")
            names = " ".join(sorted(f"#{n}@{h[:7]}" for n, h in running | {(n, h[:7]) for n, h in picked}))
            state.update(result="ok", detail=f"running {names}" if names else "nothing waiting on Checks")
        except Exception as e:
            errors += 1
            log(f"error: {e}")
            # one gh blip is not a failing job
            if errors >= 2:
                state.update(result=f"error: {e}"[:120], detail=str(e)[:120])
        time.sleep(CYCLE)


if __name__ == "__main__":
    main()
