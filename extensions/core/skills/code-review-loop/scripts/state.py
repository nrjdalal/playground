#!/usr/bin/env python3
"""A PR's review state, read from GitHub and git each time, with no memory of its own.

  state.py pr <owner/repo> <n>                          one PR: head, newest verdict, open (over REST, unknown) threads, what was said since
  state.py scan <owner/repo>                            every open PR: is its head scored, and who holds it? (the recovery scan)
  state.py delta <worktree> <base> <old head> <new head>  did a push change the PR's own work, or only merge the base?
  state.py wait <owner/repo> <n> <sha>                  block until the PR's head moves off <sha> or the PR closes (REST, every 5 minutes)
  state.py touched-tests <clone> <base> <head>          the tests a change touches, one path per line, by SKILL.md's four rules

A verdict is a comment by this gh account whose first line is
`## ReviewBot · round <r>: <s>/5 at <sha7>`, the line `bun run pr:merge` reads.
"""
import json
import os
import re
import subprocess
import sys
import time

VERDICT = re.compile(r"^##\s*ReviewBot\s*·\s*round\s+(\d+):\s*(\d)/5\s+at\s+`?([0-9a-f]{7,40})", re.I)
WAIT_SECONDS = 300

PR_QUERY = """query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
number state isDraft headRefOid
comments(last:100){pageInfo{hasPreviousPage} nodes{author{login} body createdAt url}}
reviews(last:50){pageInfo{hasPreviousPage} nodes{author{login} body submittedAt state}}
reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved path line originalLine
opener:comments(first:1){nodes{body}} comments(last:1){nodes{author{login} body createdAt}}}}}}}"""

SCAN_QUERY = """query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
pullRequests(states:OPEN,first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
number title isDraft headRefOid author{login} comments(last:100){nodes{author{login} body}}}}}}"""


def verdict_of(body):
    """The (round, score, sha) a comment's first line declares, or None."""
    m = VERDICT.match((body or "").lstrip().split("\n", 1)[0])
    return (int(m.group(1)), int(m.group(2)), m.group(3).lower()) if m else None


def latest_verdict(comments, login):
    """The newest verdict among the comments `login` wrote, with the comment it came from."""
    for c in reversed(comments):
        if (c.get("author") or {}).get("login") == login and verdict_of(c.get("body")):
            return verdict_of(c["body"]), c
    return None, None


def at_head(sha, head):
    return bool(sha) and head.lower().startswith(sha.lower())


def scan_row(pr, login):
    """One open PR as the recovery scan reports it: UNREVIEWED, STALE or SCORED."""
    verdict, _ = latest_verdict(pr["comments"]["nodes"], login)
    head = pr["headRefOid"]
    if not verdict:
        status = "UNREVIEWED"
    elif at_head(verdict[2], head):
        status = f"SCORED {verdict[1]}/5"
    else:
        status = f"STALE {verdict[1]}/5 at {verdict[2][:7]}"
    return {"author": (pr.get("author") or {}).get("login"), "draft": pr["isDraft"], "head": head[:7],
            "number": pr["number"], "status": status, "title": pr["title"]}


def data_dir():
    """The factory's data folder, as dataDir() reads it: PLAYGROUND_DATA_DIR, else .playground in the home folder."""
    return os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground")


def roster_path():
    return os.path.join(data_dir(), "roster.json")


def holders(roster, repo, n):
    """The roster's agents not ended whose `pr` is this PR: who holds it now."""
    url = re.compile(rf"^https://github\.com/{re.escape(repo)}/pull/{n}(?:[/?#]|$)", re.I)
    return sorted(a["name"] for a in (roster or {}).get("agents", [])
                  if isinstance(a, dict) and isinstance(a.get("pr"), str) and url.match(a["pr"])
                  and a.get("status") != "ended" and isinstance(a.get("name"), str))


def plans_dir():
    return os.environ.get("PLAYGROUND_PLANS_DIR") or os.path.join(data_dir(), "notes", ".github", "notes", "plans")


def read_plans():
    """Every plans file's text by name; none when the folder is missing."""
    folder = plans_dir()
    try:
        names = sorted(n for n in os.listdir(folder) if n.endswith(".md"))
    except OSError:
        return {}
    texts = {}
    for name in names:
        try:
            with open(os.path.join(folder, name)) as f:
                texts[name] = f.read()
        except OSError:
            continue
    return texts


def plans_naming(plans, n):
    """The plans files that name PR #n (as `#n`, never #n0 or ##n)."""
    mention = re.compile(rf"(?<![\w#])#{n}(?!\d)")
    return [name for name, text in plans.items() if mention.search(text)]


def holder_tag(roster, plans, repo, n, author=None, me=None):
    """Who holds the PR: its agents, else the Builder's triage for another author's, else the plan that parks it, else `lost`."""
    held = holders(roster, repo, n)
    if held:
        return ", ".join(held), False
    if author and me and author != me:
        return f"outside author {author}: the builder triages (a colleague's: the dispatcher decides per CHANNEL.md's Triage; another's app PR: read-only review then the gate; skills/factory: closed)", False
    named = plans_naming(plans, n)
    if not named:
        return "no agent, in no plan: lost", True
    return f"no agent; parked in {named[0]}{f' (+{len(named) - 1})' if len(named) > 1 else ''}", False


def read_roster():
    try:
        with open(roster_path()) as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError) as e:
        return None, f"roster unreadable: {e}"


def open_threads(threads):
    """Every thread not known to be resolved; `ours` when a ReviewBot comment opened it, so ours to close."""
    out = []
    for t in threads:
        opener = (t.get("opener") or t["comments"])["nodes"]
        notes = t["comments"]["nodes"]
        if t["isResolved"] or not opener:
            continue
        ours = "ReviewBot" in (opener[0].get("body") or "")
        line = t.get("line") or t.get("originalLine")
        out.append({
            "first": first_line(opener[0]["body"]),
            "id": t["id"],
            "ours": ours,
            "replied": ours and bool(notes) and "ReviewBot" not in (notes[-1].get("body") or ""),
            "unknown": t["isResolved"] is None,
            "where": f"{t['path']}:{line}" if line else f"{t['path']} (outdated)",
        })
    return out


def cut_lists(pr):
    """The lists GitHub cut at their page size, so a missing item may only be past the page."""
    pages = {"comments": "hasPreviousPage", "reviews": "hasPreviousPage", "reviewThreads": "hasNextPage"}
    return [k for k, flag in pages.items() if pr[k].get("pageInfo", {}).get(flag)]


def said_since(comments, reviews, since):
    """Comments and reviews newer than `since` that are not our own verdicts: what the round must read first."""
    out = []
    for c in comments:
        if since and c["createdAt"] <= since:
            continue
        if verdict_of(c.get("body")):
            continue
        out.append((c["createdAt"], (c.get("author") or {}).get("login", "?"), first_line(c.get("body"))))
    for r in reviews:
        if not r.get("submittedAt") or (since and r["submittedAt"] <= since) or not (r.get("body") or "").strip():
            continue
        out.append((r["submittedAt"], (r.get("author") or {}).get("login", "?"), first_line(r["body"])))
    return sorted(out)


def first_line(body):
    return (body or "").strip().split("\n", 1)[0][:120]


def normalize(diff):
    """A diff's changed lines alone: a base merge moves blob hashes, hunk positions and the context around the PR's lines."""
    return [line for line in diff.splitlines() if not line.startswith(("index ", "@@", " "))]


def per_file(diff):
    out, name, body = {}, None, []
    for line in diff.splitlines():
        if line.startswith("diff --git a/"):
            if name:
                out[name] = normalize("\n".join(body))
            name, body = line[len("diff --git a/"):].split(" b/", 1)[0], []
        body.append(line)
    if name:
        out[name] = normalize("\n".join(body))
    return out


def delta_kind(old_diff, new_diff, own=()):
    """BASE-MERGE when the push holds no commit of the PR's own and its changed lines are unchanged, else OWN and the files."""
    old, new = per_file(old_diff), per_file(new_diff)
    moved = sorted({f for f in set(old) | set(new) if old.get(f) != new.get(f)} | set(own))
    return ("BASE-MERGE", []) if not moved else ("OWN", moved)


def author(item):
    return {"login": (item.get("user") or {}).get("login")}


def rest_threads(review_comments):
    """REST review comments grouped into threads by their first comment; REST cannot say whether one is resolved, so isResolved is None."""
    threads = {}
    for c in sorted(review_comments, key=lambda c: c["created_at"]):
        root = c.get("in_reply_to_id") or c["id"]
        threads.setdefault(root, []).append(c)
    out = []
    for root, notes in threads.items():
        first, last = notes[0], notes[-1]
        out.append({"comments": {"nodes": [{"author": author(last), "body": last["body"], "createdAt": last["created_at"]}]},
                    "id": f"comment {root}", "isResolved": None, "line": first.get("line"),
                    "opener": {"nodes": [{"body": first["body"]}]}, "originalLine": first.get("original_line"),
                    "path": first["path"]})
    return out


def rest_state(view):
    return "MERGED" if view.get("merged") else view["state"].upper()


def rest_pr(view, comments, reviews, review_comments):
    """pulls/<n> and its three lists over REST, in the shape PR_QUERY returns."""
    return {
        "comments": {"nodes": [{"author": author(c), "body": c["body"], "createdAt": c["created_at"], "url": c["html_url"]}
                               for c in comments], "pageInfo": {}},
        "headRefOid": view["head"]["sha"],
        "isDraft": view["draft"],
        "number": view["number"],
        "reviewThreads": {"nodes": rest_threads(review_comments), "pageInfo": {}},
        "reviews": {"nodes": [{"author": author(r), "body": r.get("body"), "state": r.get("state"), "submittedAt": r.get("submitted_at")}
                              for r in reviews], "pageInfo": {}},
        "state": rest_state(view),
    }


def rest_scan_pr(view, comments):
    """One open pull and its comments over REST, in the shape SCAN_QUERY returns."""
    return {"author": author(view), "comments": {"nodes": [{"author": author(c), "body": c["body"]} for c in comments]},
            "headRefOid": view["head"]["sha"], "isDraft": view["draft"], "number": view["number"], "title": view["title"]}


def spent(error):
    return "rate limit" in (error.stderr or "").lower()


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def graphql(query, **variables):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in variables.items():
        args += ["-F" if isinstance(v, int) else "-f", f"{k}={v}"]
    return json.loads(run(*args))["data"]["repository"]


def rest(path):
    """Every page of a REST list, in one gh call."""
    return [item for page in json.loads(run("gh", "api", "--paginate", "--slurp", path)) for item in page]


def login():
    return run("gh", "api", "user", "--jq", ".login").strip()


def split_repo(repo):
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        sys.exit(f"not an owner/repo: {repo}")
    return repo.split("/", 1)


def number(text):
    if not text.isdigit():
        sys.exit(f"not a PR number: {text}")
    return int(text)


def cmd_pr(repo, n):
    owner, name = split_repo(repo)
    try:
        pr = graphql(PR_QUERY, owner=owner, name=name, n=number(n))["pullRequest"]
    except subprocess.CalledProcessError as e:
        if not spent(e):
            raise
        print("GraphQL spent: read over REST; thread resolution unknown")
        base = f"repos/{repo}"
        pr = rest_pr(json.loads(run("gh", "api", f"{base}/pulls/{n}")), rest(f"{base}/issues/{n}/comments?per_page=100"),
                     rest(f"{base}/pulls/{n}/reviews?per_page=100"), rest(f"{base}/pulls/{n}/comments?per_page=100"))
    me = login()
    comments = pr["comments"]["nodes"]
    verdict, comment = latest_verdict(comments, me)
    head = pr["headRefOid"]
    print(f"PR #{pr['number']} {pr['state']}{' draft' if pr['isDraft'] else ''} head {head}")
    for cut in cut_lists(pr):
        print(f"LIST CUT: {cut} holds more than one page; read the rest on GitHub before calling anything absent")
    if verdict:
        where = "at head" if at_head(verdict[2], head) else "STALE: the head moved since"
        print(f"verdict: round {verdict[0]} {verdict[1]}/5 at {verdict[2][:7]} ({where}) {comment['url']}")
    else:
        print("verdict: none yet (round 1)")
    threads = open_threads(pr["reviewThreads"]["nodes"])
    unknown = any(t["unknown"] for t in threads)
    label = "threads, resolution unknown" if unknown else "open threads"
    print(f"{label}: {len(threads)}, {sum(t['ours'] for t in threads)} of them ours")
    for t in threads:
        who = ("ours, author replied" if t["replied"] else "ours") if t["ours"] else "someone else's"
        print(f"  {t['id']} {t['where']} ({who}{', resolution unknown' if t['unknown'] else ''}): {t['first']}")
    since = comment["createdAt"] if comment else None
    others = said_since(comments, pr["reviews"]["nodes"], since)
    print(f"said since the verdict: {len(others)}")
    for at, who, line in others:
        print(f"  {at} {who}: {line}")


def cmd_scan(repo):
    owner, name = split_repo(repo)
    try:
        prs = graphql(SCAN_QUERY, owner=owner, name=name)["pullRequests"]["nodes"]
    except subprocess.CalledProcessError as e:
        if not spent(e):
            raise
        print("GraphQL spent: read over REST")
        prs = [rest_scan_pr(view, rest(f"repos/{repo}/issues/{view['number']}/comments?per_page=100"))
               for view in rest(f"repos/{repo}/pulls?state=open&per_page=100")]
    me = login()
    roster, problem = read_roster()
    if problem:
        print(problem)
    plans = read_plans()
    rows = sorted((scan_row(pr, me) for pr in prs), key=lambda r: r["number"])
    lost = 0
    for r in rows:
        tag, is_lost = holder_tag(roster, plans, repo, r["number"], r["author"], me)
        lost += is_lost
        print(f"#{r['number']} {r['head']} {r['status']}{' draft' if r['draft'] else ''} [{tag}]: {r['title']}")
    unscored = [r for r in rows if not r["status"].startswith("SCORED")]
    print(f"RESULT: {len(rows)} open, {len(unscored)} with an unscored head, {lost} lost")


def cmd_delta(worktree, base, old, new):
    old_diff = run("git", "-C", worktree, "diff", f"{base}...{old}")
    new_diff = run("git", "-C", worktree, "diff", f"{base}...{new}")
    own = run("git", "-C", worktree, "log", "--no-merges", "--format=", "--name-only", f"{old}..{new}", f"^{base}").split()
    kind, moved = delta_kind(old_diff, new_diff, own)
    print(kind if kind == "BASE-MERGE" else f"OWN: {' '.join(moved)}")


SCAN_TS = r"ls-files|Bun\.Glob|new Glob\(|readdirSync|readdir\("
# A git grep run as a shell line or an argv, wrapped across lines or with options before the subcommand (PG-2323's old-proxy)
GIT_GREP = re.compile(r"""\bgit["'`]?(?:[\s,\[]+(?:["']?-[\w-]+["']?|\$?\{?[\w.$]+\}?|["'][^"'\n]*["'])){0,3}?[\s,\[]+["'`]?grep\b""")
SCAN_PY = r"rglob\(|\.glob\(|os\.walk|read_text\("
# Tests whose imported source scans the repo, so no grep of their own text finds them
SCANS_THROUGH_SOURCE = ("tests/packages/scripts/src/trace-count/count.test.ts",
                        "tests/packages/scripts/src/verify/dashboard-map.test.ts", "tests/scripts/hooks/no-bare-slack-link.test.ts",
                        "tests/scripts/hooks/no-playground-leak.test.ts")
# A prompt template, and the tests that pin a built prompt's digest, which name no template's path
TEMPLATE = re.compile(r"^src/(.+/)?templates/[^/]+\.md$")
DIGEST_PIN = r"sha256\(.*prompt|DIGEST"
PATH_CHAIN = re.compile(r"""["'][\w./-]+["'](?:\s*/\s*["'][\w./-]+["'])*""")


def is_test(path, python):
    name = path.rsplit("/", 1)[-1]
    return path.startswith("tests/") and (name.endswith((".test.ts", ".test.tsx")) or (python and name.startswith("test_") and name.endswith(".py")))


def mirrors(path):
    stem = os.path.splitext(path)[0]
    return {f"tests/{stem}.test.ts", f"tests/{stem}.test.tsx"}


QUOTES = ("\"", "'", "`")


def spellings(path):
    """How a test names or imports a changed file: its path without the extension, as `@/` for web/next/src, and relative to a src root quoted whole, without its extension only when the relative path holds a folder."""
    stem = os.path.splitext(path)[0]
    ext = os.path.splitext(path)[1]
    out = [stem]
    for root in ("api/hono/src/", "web/next/src/"):
        if stem.startswith(root):
            rel = stem[len(root):]
            out += ([f"{q}{rel}{q}" for q in QUOTES] if "/" in rel else []) + [f"{q}{rel}{ext}{q}" for q in QUOTES]
    return out + ([f"@/{stem[len('web/next/src/'):]}"] if stem.startswith("web/next/src/") else [])


def spelled_near(text, path, test):
    """Whether a test names a changed file from its own folder: a relative import (`./audit-fake`), or, in the folder mirroring the file's, its bare name (`"new-tester.md"`)."""
    stem = os.path.splitext(path)[0]
    folder = os.path.dirname(test)
    rel = os.path.relpath(stem, folder)
    names = [rel if rel.startswith("../") else f"./{rel}"]
    if folder == os.path.normpath(os.path.join("tests", os.path.dirname(path))):
        names.append(os.path.basename(stem))
    return any(re.search(rf"""["']{re.escape(n)}(\.\w+)?["']""", text) for n in names)


def scanned_paths(text, paths):
    """The repo paths a Python test spells in string literals, `"a/b"` or `ROOT / "a" / "b"` joined, that name a file or folder in `paths`."""
    out = set()
    for m in PATH_CHAIN.finditer(text):
        p = "/".join(re.findall(r"""["']([\w./-]+)["']""", m.group(0))).strip("/").removeprefix("./")
        if p in paths:
            out.add(p)
    return out


def covers(scanned, changed):
    return any(f == p or f.startswith(p + "/") for p in scanned for f in changed)


def folders(tree):
    return {"/".join(f.split("/")[:i]) for f in tree for i in range(1, f.count("/") + 1)}


def grep(clone, head, mode, patterns):
    """The files under tests/ at `head` holding any of `patterns`."""
    if not patterns:
        return set()
    args = ["git", "-C", clone, "grep", "-l", mode]
    for p in patterns:
        args += ["-e", p]
    out = subprocess.run([*args, head, "--", "tests"], capture_output=True, text=True)
    if out.returncode > 1:
        raise subprocess.CalledProcessError(out.returncode, args, out.stdout, out.stderr)
    return {line.split(":", 1)[1] for line in out.stdout.splitlines()}


def read_blobs(clone, head, paths):
    paths = sorted(paths)
    out = subprocess.run(["git", "-C", clone, "cat-file", "--batch"], input="".join(f"{head}:{p}\n" for p in paths).encode(),
                         capture_output=True, check=True).stdout
    texts, at = {}, 0
    for p in paths:
        end = out.index(b"\n", at)
        size = int(out[at:end].split()[2])
        texts[p] = out[end + 1:end + 1 + size].decode(errors="replace")
        at = end + 2 + size
    return texts


def cmd_touched_tests(clone, base, head):
    changed = [f for f in run("git", "-C", clone, "diff", "--name-only", "--no-renames", "-z", f"{base}...{head}").split("\0") if f]
    tree = {f for f in run("git", "-C", clone, "ls-tree", "-r", "--name-only", "-z", head).split("\0") if f}
    python = "pyproject.toml" in tree
    tests = {f for f in tree if is_test(f, python)}
    picked = {m for f in changed for m in mirrors(f)} | set(changed) | set(SCANS_THROUGH_SOURCE)
    picked |= grep(clone, head, "-F", [s for f in changed for s in spellings(f)])
    near = grep(clone, head, "-F", [os.path.basename(os.path.splitext(f)[0]) for f in changed]) & tests
    picked |= {t for t, text in read_blobs(clone, head, near).items() if any(spelled_near(text, f, t) for f in changed)}
    picked |= {f for f in grep(clone, head, "-E", [SCAN_TS]) if not f.endswith(".py")}
    grepping = {f for f in grep(clone, head, "-F", ["grep"]) & tests if not f.endswith(".py")}
    picked |= {f for f, text in read_blobs(clone, head, grepping).items() if GIT_GREP.search(text)}
    if python:
        scanners = {f for f in grep(clone, head, "-E", [SCAN_PY]) if f in tests and f.endswith(".py")}
        paths = tree | folders(tree)
        picked |= {f for f, text in read_blobs(clone, head, scanners).items() if covers(scanned_paths(text, paths), changed)}
        if any(TEMPLATE.match(f) for f in changed):
            picked |= grep(clone, head, "-E", [DIGEST_PIN])
    for f in sorted(picked & tests):
        print(f)


def split_response(text):
    head, _, body = (text or "").replace("\r\n", "\n").partition("\n\n")
    lines = head.split("\n")[1:]
    return {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in lines)}, body


def pause_after(error):
    # A rate limit waits for its own reset, from the failing call's headers; any other failure waits a poll.
    headers, _ = split_response(getattr(error, "output", "") or "")
    reset = headers.get("x-ratelimit-reset", "")
    if headers.get("x-ratelimit-remaining") == "0" and reset.isdigit():
        return max(int(reset) - int(time.time()), 0) + 5
    return WAIT_SECONDS


def cmd_wait(repo, n, sha):
    split_repo(repo)
    number(n)
    if not re.fullmatch(r"[0-9a-f]{7,40}", sha):
        sys.exit(f"not a commit SHA: {sha}")
    closed = False
    while True:
        try:
            view = json.loads(split_response(run("gh", "api", "-i", f"repos/{repo}/pulls/{n}", "--jq", "{merged, sha: .head.sha, state}"))[1])
        except (subprocess.CalledProcessError, ValueError) as e:
            pause = pause_after(e)
            print(f"gh api failed, trying again in {pause}s: {getattr(e, 'stderr', '') or e}".strip(), file=sys.stderr)
            time.sleep(pause)
            continue
        # a PR closed unmerged is read once more a poll later, since Checks closes and reopens a PR to rebuild its merge commit (PG-1701)
        if view["state"] != "open" and (view["merged"] or closed):
            print(f"CLOSED {'MERGED' if view['merged'] else 'CLOSED'}")
            return
        closed = view["state"] != "open"
        if not closed and not at_head(sha, view["sha"]):
            print(f"MOVED {view['sha']}")
            return
        time.sleep(WAIT_SECONDS)


COMMANDS = {"delta": (cmd_delta, 4), "pr": (cmd_pr, 2), "scan": (cmd_scan, 1), "touched-tests": (cmd_touched_tests, 3), "wait": (cmd_wait, 3)}


def main(argv):
    if not argv or argv[0] not in COMMANDS or len(argv) - 1 != COMMANDS[argv[0]][1]:
        sys.exit(__doc__)
    fn, _ = COMMANDS[argv[0]]
    try:
        fn(*argv[1:])
    except subprocess.CalledProcessError as e:
        sys.exit(f"{' '.join(e.cmd[:3])} failed: {(e.stderr or '').strip()}")


if __name__ == "__main__":
    main(sys.argv[1:])
