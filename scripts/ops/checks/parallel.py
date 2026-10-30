#!/usr/bin/env python3
"""ops-checks parallel lanes, for draining the merge queue at once, using as much memory as the task needs.

  parallel.py <pr> [<pr> ...]

Each PR gets its own lane: worktree .claude/worktrees/chk-<k> on branch live/chk-<k> (portless names it chk-<k>.*), its own
loopback Postgres playground-chk-<k>-db on a fixed port, node_modules cloned from the checks worktree (APFS copy-on-write),
and runs checks.test() there for a PR whose diff touches dashboard code: the head merged with current canary, verify all,
the PR body check, posting the stamp, green or red, with a check per step. Lanes run concurrently. Must run
inside a cmux terminal. Each lane's stack is stopped when it ends; its worktree and container stay for the next round.
"""
import fcntl, json, multiprocessing, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import checks  # noqa: E402
import outside  # noqa: E402
from beat import checkout  # noqa: E402
from go import GO  # noqa: E402

LOCAL = "Local CI"

ROOT = checkout()
BASE = os.path.join(ROOT, ".claude", "worktrees", "tester")


def sh(argv, timeout=900, cwd=None):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def prepare(k):
    wt = os.path.join(ROOT, ".claude", "worktrees", f"chk-{k}")
    db, port = f"playground-chk-{k}-db", 34100 + k
    if not os.path.isdir(wt):
        sh(["git", "-C", ROOT, "fetch", "-q", "origin", "canary"])
        code, out = sh(["git", "-C", ROOT, "worktree", "add", "-q", "-B", f"live/chk-{k}", wt, "origin/canary"])
        if code:
            raise RuntimeError(f"worktree chk-{k}: {out[-200:]}")
        # node_modules as copy-on-write clones of the checks worktree's, then a quick reconcile
        _, mods = sh(["find", BASE, "-maxdepth", "3", "-type", "d", "-name", "node_modules", "-prune"])
        for m in mods.split():
            dest = os.path.join(wt, os.path.relpath(m, BASE))
            if not os.path.exists(dest):
                sh(["cp", "-cR", m, dest], timeout=600)
    env_path = os.path.join(wt, ".env")
    if not os.path.exists(env_path):
        base_env = open(os.path.join(BASE, ".env")).read()
        pw = re.search(r"postgres(?:ql)?://postgres:([^@]+)@", base_env).group(1)
        lane_env = re.sub(r"(?m)^POSTGRES_URL=.*$", f"POSTGRES_URL=postgresql://postgres:{pw}@127.0.0.1:{port}/postgres", base_env)
        fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(lane_env)
    else:
        pw = re.search(r"postgres(?:ql)?://postgres:([^@]+)@", open(env_path).read()).group(1)
    _, running = sh(["docker", "ps", "-a", "--filter", f"name=^{db}$", "--format", "{{.Status}}"])
    if not running.strip():
        sh(["docker", "run", "-d", "--name", db, "--restart", "unless-stopped", "-e", f"POSTGRES_PASSWORD={pw}", "-p", f"127.0.0.1:{port}:5432", "postgres:alpine"])
        time.sleep(4)
    elif not running.startswith("Up"):
        sh(["docker", "start", db])
        time.sleep(3)
    # a fresh container takes a few seconds to accept connections; six starting at once take longer
    for _ in range(60):
        if sh(["docker", "exec", db, "pg_isready", "-U", "postgres"], timeout=20)[0] == 0:
            break
        time.sleep(2)
    return wt, db


BAD = os.path.join(HERE, "bad-lanes.txt")


def preflight(k, wt):
    """None when lane chk-<k> is fit to judge a PR, else why not (dispatcher, 13 Oct: a PR failed four Checks on lane faults, never its own
    code). Its packages match the lockfile (a frozen install, which also repairs a stale clone: chk-5 lacked claude-agent-sdk), the API's
    own dependency resolves, and agent-browser opens and closes a session of its own (chk-3's slash-menu could not reach its socket)."""
    code, out = sh(["bun", "install", "--cwd", wt, "--ignore-scripts", "--frozen-lockfile"], timeout=300)
    if code:
        return f"bun install: {out.strip()[-160:]}"
    code, out = sh(["bun", "-e", "require.resolve('@anthropic-ai/claude-agent-sdk')"], timeout=60, cwd=os.path.join(wt, "api", "hono"))
    if code:
        return f"packages do not resolve: {out.strip()[-160:]}"
    session = f"preflight-chk-{k}-{os.getpid()}"
    code, out = sh(["agent-browser", "--session", session, "open", "about:blank"], timeout=60)
    sh(["agent-browser", "--session", session, "close"], timeout=30)
    if code:
        return f"agent-browser cannot open a session: {out.strip()[-160:]}"
    return None


def lane(args):
    k, n, sha = args
    try:
        try:
            bad = {l.split()[0] for l in open(BAD) if l.strip() and not l.startswith("#")}
        except OSError:
            bad = set()
        if f"chk-{k}" in bad:
            checks.log(f"lane chk-{k} is out of rotation (bad-lanes.txt); #{n} not run here, no verdict posted")
            checks.notify(f"lane chk-{k} is out of rotation; #{n} needs another lane")
            return n, f"error: lane chk-{k} out of rotation"
        # one run a lane (19 Oct 04:37Z: two scripts were each given LANE_START=13, and one run's prepare replaced the tree the other was to judge);
        # a flock goes with its process however it ends, so a killed run never holds the lane
        lock = open(os.path.join(HERE, f"lane-chk-{k}.lock"), "w")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            checks.log(f"lane chk-{k} is busy with another run; #{n} waits for it")
            fcntl.flock(lock, fcntl.LOCK_EX)
        wt, db = prepare(k)
        # a lane with no dashboard code runs no stack or browser here, so it needs neither preflight
        why = preflight(k, wt) if checks.diff_needs_verify("origin/canary", sha, cwd=ROOT) else None
        if why:
            with open(BAD, "a") as f:
                f.write(f"chk-{k} {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {why}\n")
            checks.log(f"lane chk-{k} failed preflight, out of rotation; #{n} not run here, no verdict posted: {why}")
            checks.notify(f"lane chk-{k} failed preflight and is out of rotation; #{n} needs another lane: {why[:120]}")
            return n, f"error: lane chk-{k} failed preflight"
        checks.WT, checks.BRANCH, checks.DBC = wt, f"live/chk-{k}", db
        checks.DEVLOG = os.path.join(HERE, f"dev-chk-{k}.log")
        checks.PGIDS = os.path.join(HERE, f"stack-chk-{k}.pgids")
        checks.stack = None
        checks.SLOT_WHO = f"ops-checks-{n}"
        checks.log(f"lane chk-{k}: #{n} @ {sha[:7]}")
        checks.test({"number": n, "headRefOid": sha, "isDraft": False})
        return n, "done"
    except Exception as e:
        checks.stop_stack()
        checks.log(f"lane chk-{k} error on #{n}: {e}")
        checks.notify(f"parallel lane chk-{k} #{n}: {str(e)[:150]}")
        return n, f"error: {e}"


def pr_view(n):
    """(author, head, label names) of #n in one gh read, the names joined by tabs, since a name can hold a space."""
    _, got = sh(["gh", "pr", "view", str(n), "--repo", checks.REPO, "--json", "author,headRefOid,labels", "--jq", '.author.login+" "+.headRefOid+" "+([.labels[].name]|join("\\t"))'], timeout=60)
    author, _, rest = got.strip("\n").partition(" ")
    head, _, names = rest.partition(" ")
    return author, head.strip(), [name for name in names.split("\t") if name]


def label_local(n, labels):
    """Label #n Local CI unless it carries GO or LOCAL already: a run with no go is local alone, and a go's run keeps GO alone."""
    if GO in labels or LOCAL in labels:
        return
    code, out = sh(["gh", "pr", "edit", str(n), "--repo", checks.REPO, "--add-label", LOCAL], timeout=60)
    if code:
        checks.log(f"#{n}: could not label it {LOCAL}: {out.strip()[-160:]}")


def main():
    prs = [int(x) for x in sys.argv[1:]]
    # every lane merges with the canary as it is now: fetch first (a lane never fetches on its own)
    sh(["git", "-C", ROOT, "fetch", "-q", "origin"], timeout=300)
    jobs = []
    for k, n in enumerate(prs, int(os.environ.get("LANE_START", "1"))):
        author, head, labels = pr_view(n)
        # **ci**: a lane runs the PR's code here and on the box, so only the factory's own PRs run, and an outside author's in checks.outsideAuthors only at a head the Builder's go names in gos.jsonl (19 Oct: two PRs, an outside author's, were given one)
        if not outside.runs(author, checks.OWNER, n, head):
            checks.log(f"#{n} is by {author or 'an author gh could not read'}, not {checks.OWNER}; not run, no verdict posted")
            print(f"#{n}: refused: its author is {author or 'unknown'}, not {checks.OWNER}", flush=True)
            continue
        jobs.append((k, n, head))
        label_local(n, labels)
    if not jobs:
        sys.exit(1)
    # a lane takes a Mac slot only for its own verify (checks.in_slot), so lanes start at once and the box's suite never holds one
    with multiprocessing.get_context("fork").Pool(len(jobs)) as pool:
        for n, result in pool.imap_unordered(lane, jobs):
            print(f"#{n}: {result}", flush=True)


if __name__ == "__main__":
    main()
