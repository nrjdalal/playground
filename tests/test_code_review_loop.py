#!/usr/bin/env python3
"""code-review-loop's state.py: verdicts, the recovery scan, our threads, and the base-merge test on a real git repo.

No network: the GitHub reads are fed as the GraphQL shapes the script asks for, and `delta`
runs against a scratch repository. The verdict line is also read from COMMENTS.md, so the
header the skill tells a reviewer to post is the one the script (and pr:merge) parses.

Run: python3 tests/test_code_review_loop.py
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, "extensions/core/skills/code-review-loop")
spec = importlib.util.spec_from_file_location("state", os.path.join(SKILL, "scripts/state.py"))
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)

failures = []


def check(ok, name, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        failures.append(name)
        if detail:
            print(f"     {detail}")


def comment(body, login="acme-owner", at="2026-10-07T10:00:00Z"):
    return {"author": {"login": login}, "body": body, "createdAt": at, "url": f"https://x/{at}"}


HEAD = "69a6a4c0123456789abcdef0123456789abcdef0"

# 01 the verdict line
check(state.verdict_of("## ReviewBot · round 2: 5/5 at 69a6a4c · 0 blocking, 0 should-fix, 0 nits\n\nok") == (2, 5, "69a6a4c"),
      "01 a verdict's first line gives its round, score and sha")
check(state.verdict_of("Some text\n## ReviewBot · round 2: 5/5 at 69a6a4c") is None,
      "01b a verdict below the first line is not one (pr:merge reads first lines only)")
check(state.verdict_of("ReviewBot round 2 inline findings at 69a6a4c") is None,
      "01c an inline review's body is not a verdict")

comments_md = open(os.path.join(SKILL, "references/COMMENTS.md")).read()
template = re.search(r"^## ReviewBot · round <r>: <s>/5 at <sha7>.*$", comments_md, re.M)
check(bool(template), "02 COMMENTS.md gives the verdict line")
if template:
    filled = template.group(0).replace("<r>", "3").replace("<s>", "4").replace("<sha7>", "abc1234")
    check(state.verdict_of(filled) == (3, 4, "abc1234"), "02b the verdict line COMMENTS.md gives parses", filled)
gates = open(os.path.join(ROOT, "packages/config/src/verdicts.ts")).read()
check("ReviewBot\\s*·\\s*round" in gates, "02c pr:merge still reads the same verdict header")

# 03 the newest verdict, ours only
comments = [
    comment("## ReviewBot · round 1: 3/5 at 1111111 · 1 blocking", at="2026-10-07T09:00:00Z"),
    comment("## ReviewBot · round 9: 5/5 at 69a6a4c · 0 blocking", login="someone-else", at="2026-10-07T09:30:00Z"),
    comment("## ReviewBot · round 2: 4/5 at 2222222 · 0 blocking, 1 should-fix", at="2026-10-07T10:00:00Z"),
    comment("thanks, fixed", login="acme-owner", at="2026-10-07T10:05:00Z"),
]
verdict, source = state.latest_verdict(comments, "acme-owner")
check(verdict == (2, 4, "2222222") and source["createdAt"] == "2026-10-07T10:00:00Z",
      "03 the newest verdict by this account wins; another account's never counts", verdict)

# 04 the recovery scan's three states
def pr(n, head, bodies):
    return {"number": n, "title": f"pr {n}", "isDraft": n == 3, "headRefOid": head,
            "comments": {"nodes": [comment(b) for b in bodies]}}

rows = {r["number"]: r for r in (state.scan_row(p, "acme-owner") for p in [
    pr(1, HEAD, []),
    pr(2, HEAD, ["## ReviewBot · round 1: 4/5 at 1111111 · 1 should-fix"]),
    pr(3, HEAD, ["## ReviewBot · round 2: 5/5 at 69a6a4c · 0 blocking"]),
])}
check(rows[1]["status"] == "UNREVIEWED", "04 a PR with no verdict is UNREVIEWED")
check(rows[2]["status"] == "STALE 4/5 at 1111111", "04b a verdict at an older head is STALE", rows[2]["status"])
check(rows[3]["status"] == "SCORED 5/5" and rows[3]["draft"], "04c a verdict at the head is SCORED, drafts included")

# 04d who holds a PR: the roster's agents not ended, matched by the PR's URL
roster = {"agents": [
    {"name": "worker-greed", "pr": "https://github.com/acme/archive/pull/157", "status": "working"},
    {"name": "reviewer-greed", "pr": "https://github.com/acme/archive/pull/157#issuecomment-1", "status": "working"},
    {"name": "reviewer-old", "pr": "https://github.com/acme/archive/pull/157", "status": "ended"},
    {"name": "worker-other", "pr": "https://github.com/acme/archive/pull/1570", "status": "working"},
    {"name": "worker-elsewhere", "pr": "https://github.com/someone/dispatcher/pull/157", "status": "working"},
    {"name": "no-pr", "status": "working"}, "not an agent",
]}
check(state.holders(roster, "acme/archive", 157) == ["reviewer-greed", "worker-greed"],
      "04d a PR's holders are its agents not ended, never #1570's or another repo's", state.holders(roster, "acme/archive", 157))
check(state.holders(None, "acme/archive", 157) == [], "04e no roster holds nothing")

# 04f a PR no agent holds: parked when a plan names it, lost when none does
plans = {"pg-82-sidebar.md": "- resume #71 after #120\n", "pg-84-tables.md": "#860 and ##86 and PR#86x"}
check(state.plans_naming(plans, 71) == ["pg-82-sidebar.md"], "04f a plan naming #71 parks it")
check(state.plans_naming(plans, 86) == [], "04g #860, ##86 and #86x do not name #86", state.plans_naming(plans, 86))
check(state.holder_tag(roster, plans, "acme/archive", 157) == ("reviewer-greed, worker-greed", False),
      "04h a held PR is tagged with its agents")
check(state.holder_tag(roster, plans, "acme/archive", 71) == ("no agent; parked in pg-82-sidebar.md", False),
      "04i a parked PR is not lost")
check(state.holder_tag(None, {"a.md": "#71", "b.md": "#71", "c.md": "#71"}, "acme/archive", 71)[0] == "no agent; parked in a.md (+2)",
      "04i2 a PR many plans name shows the first and a count")
check(state.holder_tag(roster, plans, "acme/archive", 99) == ("no agent, in no plan: lost", True), "04j a PR in no plan is lost")
check(state.holder_tag(roster, plans, "acme/archive", 99, "visitor", "acme-owner") == ("outside author visitor: the builder triages (a colleague's: the dispatcher decides per CHANNEL.md's Triage; another's app PR: read-only review then the gate; skills/factory: closed)", False)
      and state.holder_tag(roster, plans, "acme/archive", 99, "acme-owner", "acme-owner")[1],
      "04j2 another author's PR no agent holds is builder's to triage, never lost; our own still can be")
check(state.holder_tag(roster, plans, "acme/archive", 157, "visitor", "acme-owner") == ("reviewer-greed, worker-greed", False),
      "04j4 another author's PR an agent holds shows its holders")
check(state.scan_row({**pr(4, HEAD, []), "author": {"login": "visitor"}}, "acme-owner")["author"] == "visitor",
      "04j3 a scan row carries its PR's author")
with tempfile.TemporaryDirectory() as d:
    open(os.path.join(d, "a.md"), "w").write("#5")
    open(os.path.join(d, "b.txt"), "w").write("#5")
    os.environ["PLAYGROUND_PLANS_DIR"] = d
    check(state.read_plans() == {"a.md": "#5"}, "04k the plans are the folder's .md files")
    os.environ["PLAYGROUND_PLANS_DIR"] = os.path.join(d, "missing")
    check(state.read_plans() == {}, "04l a missing plans folder is no plans")
    del os.environ["PLAYGROUND_PLANS_DIR"]

# 05 our open threads
threads = [
    {"id": "T1", "isResolved": False, "path": "a.ts", "line": 3,
     "comments": {"nodes": [comment("Off by one.\n\nReviewBot · round 1"), comment("fixed in abc", at="2026-10-07T11:00:00Z")]}},
    {"id": "T2", "isResolved": True, "path": "b.ts", "line": 4, "comments": {"nodes": [comment("Old.\n\nReviewBot · round 1")]}},
    {"id": "T3", "isResolved": False, "path": "c.ts", "line": 5, "comments": {"nodes": [comment("a human's thread")]}},
    {"id": "T4", "isResolved": False, "path": "d.ts", "line": 6, "comments": {"nodes": [comment("Name it.\n\nReviewBot · round 2")]}},
]
opened = state.open_threads(threads)
check([t["id"] for t in opened] == ["T1", "T3", "T4"], "05 every unresolved thread is listed, anyone's", opened)
check([t["id"] for t in opened if t["ours"]] == ["T1", "T4"], "05b ours are the ones a ReviewBot comment opened")
check(opened[0]["replied"] and not opened[2]["replied"] and not opened[1]["replied"],
      "05c a thread of ours whose last word is the author's reads as replied")
long_thread = {"id": "T5", "isResolved": False, "path": "e.ts", "line": None, "originalLine": 9,
               "opener": {"nodes": [{"body": "Long one.\n\nReviewBot · round 1"}]},
               "comments": {"nodes": [comment("a reply 25 comments in")]}}
t5 = state.open_threads([long_thread])[0]
check(t5["ours"] and t5["replied"] and t5["where"] == "e.ts:9",
      "05d the opener decides ours past 20 replies, and an outdated line falls back to originalLine", t5)

# 05e wait keeps waiting through a failed read, then reports the move; 05l a rate limit sleeps to its reset
def response(body, status="200 OK", headers=""):
    return f"HTTP/2.0 {status}\r\nX-Ratelimit-Resource: core\r\n{headers}\r\n{body}"

calls, sleeps = [], []
limited = subprocess.CalledProcessError(1, ("gh",), output=response(
    '{"message": "API rate limit exceeded"}', "403 Forbidden", "X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1000600\r\n"))
def fake_run(*args):
    calls.append(args)
    if len(calls) == 1:
        raise subprocess.CalledProcessError(1, args, stderr="network down")
    if len(calls) == 2:
        raise limited
    if len(calls) == 3:
        return response('{"merged": false, "sha": "%s", "state": "open"}' % HEAD)
    return response('{"merged": false, "sha": "abcdef0123456789abcdef0123456789abcdef01", "state": "open"}')
real_run, real_sleep, real_time = state.run, state.time.sleep, state.time.time
state.run, state.time.sleep, state.time.time = fake_run, sleeps.append, lambda: 1000000
try:
    import contextlib, io
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        state.cmd_wait("acme/archive", "160", HEAD[:7])
finally:
    state.run, state.time.sleep, state.time.time = real_run, real_sleep, real_time
check(out.getvalue().strip() == "MOVED abcdef0123456789abcdef0123456789abcdef01" and "trying again" in err.getvalue() and len(calls) == 4,
      "05e wait rides out a failed read and ends on the push", out.getvalue() + err.getvalue())
check(all(c[:4] == ("gh", "api", "-i", "repos/acme/archive/pulls/160") for c in calls),
      "05f wait reads the PR over REST, so its polling spends none of the shared GraphQL budget", calls)
check(sleeps == [300, 605, 300], "05l wait polls every 300s, and after a rate limit sleeps to the failing call's reset", sleeps)

def wait_once(view):
    state.run, state.time.sleep = (lambda *a: response(view)), (lambda s: None)
    try:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            state.cmd_wait("acme/archive", "160", HEAD)
    finally:
        state.run, state.time.sleep = real_run, real_sleep
    return out.getvalue().strip()
check(wait_once('{"merged": true, "sha": "%s", "state": "closed"}' % HEAD) == "CLOSED MERGED",
      "05g a merged PR ends the wait as CLOSED MERGED")
check(wait_once('{"merged": false, "sha": "%s", "state": "closed"}' % HEAD) == "CLOSED CLOSED",
      "05h a PR closed unmerged ends the wait as CLOSED CLOSED")

def wait_through(views):
    reads, naps = [], []
    def read(*a):
        reads.append(a)
        return response(views[min(len(reads), len(views)) - 1])
    state.run, state.time.sleep = read, naps.append
    try:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            state.cmd_wait("acme/archive", "160", HEAD)
    finally:
        state.run, state.time.sleep = real_run, real_sleep
    return out.getvalue().strip(), len(reads), naps
closed, still = '{"merged": false, "sha": "%s", "state": "closed"}' % HEAD, '{"merged": false, "sha": "%s", "state": "open"}' % HEAD
moved = '{"merged": false, "sha": "abcdef0123456789abcdef0123456789abcdef01", "state": "open"}'
check(wait_through([closed, closed]) == ("CLOSED CLOSED", 2, [300]),
      "05m a PR closed unmerged is read once more a poll later before the wait ends as CLOSED CLOSED", wait_through([closed, closed]))
check(wait_through([closed, still, moved]) == ("MOVED abcdef0123456789abcdef0123456789abcdef01", 3, [300, 300]),
      "05n a close and reopen (#1701) keeps the wait running to the next push", wait_through([closed, still, moved]))
check(wait_through([closed, still, closed, closed])[:2] == ("CLOSED CLOSED", 4),
      "05o a second close after a reopen is read once more too", wait_through([closed, still, closed, closed]))

# 05i a list GitHub cut at its page size is named, never read as the whole
page = {"comments": {"pageInfo": {"hasPreviousPage": True}}, "reviews": {"pageInfo": {"hasPreviousPage": False}},
        "reviewThreads": {"pageInfo": {"hasNextPage": True}}}
check(state.cut_lists(page) == ["comments", "reviewThreads"], "05i the comment and thread lists past a page are named as cut",
      state.cut_lists(page))
check(state.cut_lists({k: {"pageInfo": {}} for k in page}) == [], "05j whole lists name nothing")
check("hasNextPage" in state.PR_QUERY and state.PR_QUERY.count("hasPreviousPage") == 2,
      "05k the PR query asks GitHub whether each list was cut")

# 06 what others said since the verdict
since = state.said_since(comments, [{"author": {"login": "bot"}, "body": "LGTM", "submittedAt": "2026-10-07T10:10:00Z"},
                                    {"author": {"login": "x"}, "body": "", "submittedAt": "2026-10-07T10:20:00Z"}],
                         "2026-10-07T09:45:00Z")
check([who for _, who, _ in since] == ["acme-owner", "bot"],
      "06 since the verdict: replies and reviews with a body, never a verdict", since)

# 07 delta: a base merge versus the PR's own push, on a real repository
def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout.strip()

with tempfile.TemporaryDirectory() as repo:
    git(repo, "init", "-q", "-b", "canary")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    git(repo, "config", "commit.gpgsign", "false")
    lines = [f"line {i}" for i in range(1, 21)]
    open(os.path.join(repo, "a.txt"), "w").write("\n".join(lines) + "\n")
    open(os.path.join(repo, "b.txt"), "w").write("b\n")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "pr")
    changed = lines[:]
    changed[14] = "line 15, fixed"
    open(os.path.join(repo, "a.txt"), "w").write("\n".join(changed) + "\n")
    git(repo, "commit", "-qam", "own change")
    old_head = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "canary")
    open(os.path.join(repo, "a.txt"), "w").write("top 1\ntop 2\n" + "\n".join(lines) + "\n")
    open(os.path.join(repo, "b.txt"), "w").write("b, from canary\n")
    git(repo, "commit", "-qam", "canary moves under the PR's file")
    git(repo, "checkout", "-q", "pr")
    git(repo, "merge", "-q", "--no-edit", "canary")
    merged = git(repo, "rev-parse", "HEAD")

    naive = git(repo, "diff", "--name-only", f"{old_head}..{merged}", "--", "a.txt")
    check(naive == "a.txt", "07 (the trap) a path-scoped range diff says the merge changed the PR's file")
    old_diff = git(repo, "diff", f"canary...{old_head}")
    new_diff = git(repo, "diff", f"canary...{merged}")
    check(old_diff != new_diff, "07b the two contributions differ byte for byte (hunk header, blob hash)")
    check(state.delta_kind(old_diff, new_diff) == ("BASE-MERGE", []), "07c a merge of the base alone is BASE-MERGE",
          state.delta_kind(old_diff, new_diff))

    open(os.path.join(repo, "c.txt"), "w").write("new\n")
    git(repo, "add", "c.txt")
    git(repo, "commit", "-qm", "own push")
    pushed = git(repo, "rev-parse", "HEAD")
    kind = state.delta_kind(old_diff, git(repo, "diff", f"canary...{pushed}"))
    check(kind == ("OWN", ["c.txt"]), "07d a push with work of its own is OWN, naming the files", kind)

    git(repo, "checkout", "-qb", "hand", old_head)
    beside = lines[:]
    beside[13] = "line 14, canary"
    git(repo, "checkout", "-q", "canary")
    open(os.path.join(repo, "a.txt"), "w").write("top 1\ntop 2\n" + "\n".join(beside) + "\n")
    git(repo, "commit", "-qam", "canary edits the line beside the PR's")
    git(repo, "checkout", "-q", "hand")
    conflicted = subprocess.run(["git", "-C", repo, "merge", "-q", "--no-edit", "canary"], capture_output=True, text=True)
    check(conflicted.returncode != 0, "07f (setup) canary's edit beside the PR's line conflicts", conflicted.stdout)
    both = beside[:]
    both[14] = "line 15, fixed"
    open(os.path.join(repo, "a.txt"), "w").write("top 1\ntop 2\n" + "\n".join(both) + "\n")
    git(repo, "commit", "-qam", "resolve by hand, keeping both sides")
    kind = state.delta_kind(old_diff, git(repo, "diff", f"canary...{git(repo, 'rev-parse', 'HEAD')}"))
    check(kind == ("BASE-MERGE", []), "07g a hand resolution that keeps both sides is BASE-MERGE (only context moved)", kind)
    dropped = beside[:]
    open(os.path.join(repo, "a.txt"), "w").write("top 1\ntop 2\n" + "\n".join(dropped) + "\n")
    git(repo, "commit", "-qam", "a resolution that drops the PR's line")
    kind = state.delta_kind(old_diff, git(repo, "diff", f"canary...{git(repo, 'rev-parse', 'HEAD')}"))
    check(kind == ("OWN", ["a.txt"]), "07h a resolution that drops the PR's own line is OWN", kind)

    out = subprocess.run([sys.executable, os.path.join(SKILL, "scripts/state.py"), "delta", repo, "canary", old_head, merged],
                         capture_output=True, text=True)
    check(out.returncode == 0 and out.stdout.strip() == "BASE-MERGE", "07e the CLI prints BASE-MERGE", out.stdout + out.stderr)

# 07i a push of the PR's own that only moves its line is OWN, though its changed lines read the same
with tempfile.TemporaryDirectory() as repo:
    git(repo, "init", "-q", "-b", "canary")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    git(repo, "config", "commit.gpgsign", "false")
    open(os.path.join(repo, "m.py"), "w").write("def f():\n    pass\n\n\ndef g():\n    pass\n")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "pr")
    open(os.path.join(repo, "m.py"), "w").write("def f():\n    check()\n    pass\n\n\ndef g():\n    pass\n")
    git(repo, "commit", "-qam", "guard f")
    old_head = git(repo, "rev-parse", "HEAD")
    open(os.path.join(repo, "m.py"), "w").write("def f():\n    pass\n\n\ndef g():\n    check()\n    pass\n")
    git(repo, "commit", "-qam", "move the guard to g")
    out = subprocess.run([sys.executable, os.path.join(SKILL, "scripts/state.py"), "delta", repo, "canary", old_head, "HEAD"],
                         capture_output=True, text=True)
    check(out.stdout.strip() == "OWN: m.py", "07i a commit of the PR's own that moves a line is OWN", out.stdout + out.stderr)

# 08 input it does not implement is refused, never ignored
for args, name in [(["scan"], "a missing argument"), (["scan", "acme/archive", "--table"], "an extra flag"),
                   (["pr", "acme/archive", "#12"], "a PR number with a #"), (["wait", "x/y", "1", "HEAD"], "a ref that is not a SHA"),
                   (["review"], "an unknown command")]:
    out = subprocess.run([sys.executable, os.path.join(SKILL, "scripts/state.py"), *args], capture_output=True, text=True)
    check(out.returncode != 0, f"08 {name} exits non-zero", out.stdout + out.stderr)

# 09 with GraphQL spent, pr and scan read REST, and a thread's resolution REST cannot see reads unknown
def rest_comment(body, login="acme-owner", at="2026-10-07T10:00:00Z"):
    return {"body": body, "created_at": at, "html_url": f"https://x/{at}", "user": {"login": login}}

view = {"draft": True, "head": {"sha": HEAD}, "merged": False, "number": 160, "state": "open", "title": "t", "user": {"login": "acme-owner"}}
review_comments = [
    {"body": "Off by one.\n\nReviewBot · round 1", "created_at": "2026-10-07T10:00:00Z", "id": 1, "in_reply_to_id": None,
     "line": 3, "original_line": 3, "path": "a.py", "user": {"login": "acme-owner"}},
    {"body": "fixed in abc", "created_at": "2026-10-07T11:00:00Z", "id": 2, "in_reply_to_id": 1, "line": 3, "original_line": 3,
     "path": "a.py", "user": {"login": "acme-owner"}},
    {"body": "a human's note", "created_at": "2026-10-07T12:00:00Z", "id": 3, "in_reply_to_id": None, "line": None,
     "original_line": 9, "path": "b.py", "user": {"login": "someone"}},
]
pr = state.rest_pr(view, [rest_comment("## ReviewBot · round 1: 3/5 at 69a6a4c · 1 blocking")],
                   [{"body": "", "state": "COMMENTED", "submitted_at": "2026-10-07T10:00:00Z", "user": {"login": "acme-owner"}}],
                   review_comments)
check(pr["state"] == "OPEN" and pr["isDraft"] and pr["headRefOid"] == HEAD and pr["number"] == 160,
      "09 the REST pull reads as the GraphQL one: state, draft, head", pr)
check(state.latest_verdict(pr["comments"]["nodes"], "acme-owner")[0] == (1, 3, "69a6a4c"), "09b a verdict reads from REST comments")
listed = state.open_threads(pr["reviewThreads"]["nodes"])
check([(t["where"], t["ours"], t["replied"], t["unknown"]) for t in listed] == [("a.py:3", True, True, True), ("b.py:9", False, False, True)],
      "09c REST review comments group into threads by their first comment, each one's resolution unknown", listed)
check(state.rest_pr(dict(view, state="closed", merged=True), [], [], [])["state"] == "MERGED", "09d a merged pull reads MERGED")
row = state.scan_row(state.rest_scan_pr(view, [rest_comment("## ReviewBot · round 2: 5/5 at 69a6a4c")]), "acme-owner")
check(row["status"] == "SCORED 5/5" and row["draft"] and row["author"] == "acme-owner", "09e a REST pull and its comments make a scan row", row)

def spent_then_rest(*args):
    calls.append(args)
    if "graphql" in args:
        raise subprocess.CalledProcessError(1, args, stderr="GraphQL: API rate limit already exceeded for user ID 1.")
    if "user" in args[2:3]:
        return "acme-owner\n"
    path = [a for a in args if a.startswith("repos/")][0]
    if path.endswith("/pulls/160"):
        return json.dumps(view)
    if "/issues/160/comments" in path:
        return json.dumps([[rest_comment("## ReviewBot · round 1: 3/5 at 69a6a4c · 1 blocking")]])
    if "/pulls/160/reviews" in path:
        return json.dumps([[]])
    if "/pulls/160/comments" in path:
        return json.dumps([review_comments])
    raise AssertionError(path)
calls = []
state.run = spent_then_rest
try:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        state.cmd_pr("acme/archive", "160")
finally:
    state.run = real_run
text = out.getvalue()
check("GraphQL spent" in text and "threads, resolution unknown: 2, 1 of them ours" in text and "round 1 3/5" in text
      and "comment 1 a.py:3 (ours, author replied, resolution unknown): Off by one." in text,
      "09f pr reads over REST when GraphQL is spent, and says so", text)
check(sum("graphql" in c for c in calls) == 1 and len(calls) == 6, "09g one read set: one GraphQL try, then four REST reads and the login", calls)

# GraphQL alone fails, with no rate limit; a REST read would answer, so a fallback taken here shows as a call past the GraphQL try
def other_failure(*args):
    calls.append(args)
    if "graphql" in args:
        raise subprocess.CalledProcessError(1, args, stderr="HTTP 502: Bad Gateway")
    return json.dumps(view) if args[-1].endswith("/pulls/160") else "[[]]"
calls = []
state.run = other_failure
try:
    raised = False
    try:
        state.cmd_pr("acme/archive", "160")
    except subprocess.CalledProcessError:
        raised = True
finally:
    state.run = real_run
check(raised and len(calls) == 1, "09h any other GraphQL failure still fails, never falls back", calls)

# 09i scan switches to REST the same way: a row per open pull, one read set, and any other failure still raises
other = dict(view, draft=False, head={"sha": "abcdef0123456789abcdef0123456789abcdef01"}, number=161, title="u")
def scan_spent(*args):
    calls.append(args)
    if "graphql" in args:
        raise subprocess.CalledProcessError(1, args, stderr="GraphQL: API rate limit already exceeded for user ID 1.")
    if "user" in args[2:3]:
        return "acme-owner\n"
    path = [a for a in args if a.startswith("repos/")][0]
    if "/pulls?state=open" in path:
        return json.dumps([[view, other]])
    if "/issues/160/comments" in path:
        return json.dumps([[rest_comment("## ReviewBot · round 2: 5/5 at 69a6a4c")]])
    if "/issues/161/comments" in path:
        return json.dumps([[]])
    raise AssertionError(path)
calls = []
config = tempfile.mkdtemp()
os.environ["CLAUDE_CONFIG_DIR"] = config
state.run = scan_spent
try:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        state.cmd_scan("acme/archive")
    raised, scan_calls, calls = False, calls, []
    state.run = other_failure
    try:
        state.cmd_scan("acme/archive")
    except subprocess.CalledProcessError:
        raised = True
finally:
    state.run = real_run
    del os.environ["CLAUDE_CONFIG_DIR"]
lines = out.getvalue().splitlines()
check(lines[0] == "GraphQL spent: read over REST" and any(l.startswith("#160 69a6a4c SCORED 5/5 draft") for l in lines)
      and any(l.startswith("#161 abcdef0 UNREVIEWED") for l in lines) and lines[-1].startswith("RESULT: 2 open, 1 with an unscored head"),
      "09i scan reads over REST when GraphQL is spent: a row per open pull, scored from its REST comments", out.getvalue())
check(sum("graphql" in c for c in scan_calls) == 1 and len(scan_calls) == 5, "09j scan's read set: one GraphQL try, the pulls, each pull's comments and the login", scan_calls)
check(raised and len(calls) == 1, "09k any other GraphQL failure still fails scan, never falls back", calls)

# 10 touched-tests: the four rules on a scratch repository, printed one path per line
def scratch_repo(repo, files):
    git(repo, "init", "-q", "-b", "canary")
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    git(repo, "config", "commit.gpgsign", "false")
    write(repo, files)
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "pr")


def write(repo, files):
    for path, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(repo, path)) or repo, exist_ok=True)
        open(os.path.join(repo, path), "w").write(text)


def touched(repo):
    out = subprocess.run([sys.executable, os.path.join(SKILL, "scripts/state.py"), "touched-tests", repo, "canary", "HEAD"],
                         capture_output=True, text=True)
    return out.returncode, out.stdout.splitlines(), out.stderr


with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {
        "api/hono/src/lib/sql.ts": "x\n",
        "scripts/plain.sh": "x\n",
        "tests/api/hono/src/routers/admin.test.ts": 'import { q } from "../../../../../api/hono/src/lib/sql"\n',
        "tests/changed.test.ts": "x\n",
        "tests/scan.test.ts": 'readdirSync("skills")\n',
        "tests/scripts/hooks/no-playground-leak.test.ts": "x\n",
        "tests/test_scan.py": 'pathlib.Path("api/hono/src").rglob("*.ts")\n',
        "tests/unrelated.test.ts": "x\n",
        "tests/web/next/src/lib/chat.test.ts": 'import { send } from "@/lib/outbox"\n',
        "tests/web/next/src/lib/outbox.test.ts": "x\n",
        "web/next/src/lib/outbox.ts": "x\n",
    })
    write(repo, {"api/hono/src/lib/sql.ts": "y\n", "scripts/plain.sh": "y\n", "tests/changed.test.ts": "y\n",
                 "web/next/src/lib/outbox.ts": "y\n"})
    git(repo, "commit", "-qam", "change")
    code, listed, err = touched(repo)
    check(code == 0, "10 touched-tests exits 0", err)
    check("tests/web/next/src/lib/outbox.test.ts" in listed, "10b rule 1: a changed file's mirror", listed)
    check("tests/changed.test.ts" in listed, "10c rule 2: a changed test file", listed)
    check({"tests/api/hono/src/routers/admin.test.ts", "tests/web/next/src/lib/chat.test.ts"} <= set(listed),
          "10d rule 3: a test importing a changed file, by its path without the extension and by @/", listed)
    check({"tests/scan.test.ts", "tests/scripts/hooks/no-playground-leak.test.ts"} <= set(listed),
          "10e rule 4: a test that scans the repo, and one whose imported source does", listed)
    check(listed == sorted(set(listed)) and len(listed) == 6 and "tests/unrelated.test.ts" not in listed,
          "10f one path per line, each once, and no test the rules leave out", listed)
    check("tests/test_scan.py" not in listed, "10g a repo with no pyproject.toml lists no Python test", listed)
    git(repo, "rm", "-q", "tests/changed.test.ts", "tests/web/next/src/lib/outbox.test.ts")
    git(repo, "commit", "-qm", "drop two tests")
    check(not {"tests/changed.test.ts", "tests/web/next/src/lib/outbox.test.ts"} & set(touched(repo)[1]),
          "10h a test missing at the head is never listed")

with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {"tests/uses-old.test.ts": 'import { a } from "@/lib/old"\n', "web/next/src/lib/old.ts": "x\n"})
    git(repo, "mv", "web/next/src/lib/old.ts", "web/next/src/lib/new.ts")
    git(repo, "commit", "-qm", "rename")
    check("tests/uses-old.test.ts" in touched(repo)[1], "10k a renamed file's old path still selects the test importing it")

with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {
        "pyproject.toml": "[project]\n",
        "src/pkg/integrations/street/form.py": "x\n",
        "src/pkg/other.py": "x\n",
        "tests/helper.py": 'pathlib.Path("src/pkg").rglob("*.py")\n',
        "tests/test_chain.py": 'ROOT = pathlib.Path(__file__).parents[1]\nfor p in (ROOT / "src" / "pkg" / "integrations").glob("**/*.py"):\n    pass\n',
        "tests/test_guard.py": 'integrations = pathlib.Path("src/pkg/integrations")\nfor path in integrations.rglob("*.py"):\n    path.read_text()\n',
        "tests/test_one_file.py": '(ROOT / "src" / "pkg" / "other.py").read_text(encoding="utf-8")\n',
        "tests/test_plain.py": "from pkg import form\n",
    })
    write(repo, {"src/pkg/integrations/street/form.py": "y\n"})
    git(repo, "commit", "-qam", "change the form")
    code, listed, err = touched(repo)
    check(code == 0 and listed == ["tests/test_chain.py", "tests/test_guard.py"],
          "10i a Python repo lists each tests/test_*.py that scans a folder holding a changed file (#5520's missed guard test)",
          listed + [err])
    write(repo, {"src/pkg/other.py": "y\n"})
    git(repo, "commit", "-qam", "change the other file")
    check("tests/test_one_file.py" in touched(repo)[1], "10j a Python test reading the changed file itself is listed")

with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {
        "pyproject.toml": "[project]\n",
        "src/pkg/templates/maintenance.md": "x\n",
        "tests/test_digests.py": 'DEVELOP_DIGESTS = {}\n',
        "tests/test_exit_goodbye.py": "assert hashlib.sha256(prompt.encode()).hexdigest() == want\n",
        "tests/test_plain.py": "from pkg import form\n",
    })
    write(repo, {"src/pkg/templates/maintenance.md": "y\n"})
    git(repo, "commit", "-qam", "change a template")
    code, listed, err = touched(repo)
    check(code == 0 and listed == ["tests/test_digests.py", "tests/test_exit_goodbye.py"],
          "10l a changed prompt template lists each test pinning a prompt's digest (a downstream repo's missed test_exit_goodbye.py)",
          listed + [err])

with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {
        "scripts/briefs/new-tester.md": "x\n",
        "tests/elsewhere/names.test.ts": 'const names = ["new-tester.md"]\nimport { fakeBun } from "./audit-fake"\n',
        "tests/packages/scripts/src/audit-canary.test.ts": 'import { fakeBun } from "./audit-fake"\n',
        "tests/packages/scripts/src/audit-fake.ts": "x\n",
        "tests/packages/scripts/src/lib/deep.test.ts": "import { fakeBun } from '../audit-fake.ts'\n",
        "tests/scripts/briefs/slots.test.ts": 'for (const name of ["new-reviewer.md", "new-tester.md"]) read(join("scripts/briefs", name))\n',
    })
    write(repo, {"scripts/briefs/new-tester.md": "y\n", "tests/packages/scripts/src/audit-fake.ts": "y\n"})
    git(repo, "commit", "-qam", "change a helper and a brief")
    code, listed, err = touched(repo)
    check(code == 0 and listed == ["tests/packages/scripts/src/audit-canary.test.ts", "tests/packages/scripts/src/lib/deep.test.ts",
                                   "tests/scripts/briefs/slots.test.ts"],
          "10m rule 3: a test importing a changed file relatively, and one in its mirrored folder naming it (#1813's audit-canary, #1831's slots)",
          listed + [err])

with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {
        "api/hono/src/lib/health.ts": "x\n",
        "api/hono/src/main.ts": "x\n",
        "tests/api/hono/src/health-longer.test.ts": 'const deeper = await read("lib/health/x")\n',
        "tests/api/hono/src/lib/health-reader.test.ts": 'const api = join(import.meta.dir, "../../../../../../api/hono/src")\nconst health = await read("lib/health")\n',
        "tests/api/hono/src/main-prose.test.ts": 'const note = "ship canary to main"\n',
        "tests/api/hono/src/main-reader.test.ts": 'const entry = await read("main.ts")\n',
        "tests/api/hono/src/routers/main-branch.test.ts": 'const want = "main"\n',
        "tests/web/next/src/components/dashboard/sidebar-footer.test.ts": 'const web = join(import.meta.dir, "../../../../../../web/next/src")\nconst dashboard = await read("components/dashboard/app-sidebar.tsx")\n',
        "web/next/src/components/dashboard/app-sidebar.tsx": "x\n",
    })
    write(repo, {"api/hono/src/lib/health.ts": "y\n", "api/hono/src/main.ts": "y\n", "web/next/src/components/dashboard/app-sidebar.tsx": "y\n"})
    git(repo, "commit", "-qam", "change three sources")
    code, listed, err = touched(repo)
    check(code == 0 and listed == ["tests/api/hono/src/lib/health-reader.test.ts", "tests/api/hono/src/main-reader.test.ts",
                                   "tests/web/next/src/components/dashboard/sidebar-footer.test.ts"],
          "10n rule 3: a test reading a changed file by its src-relative path quoted whole, with and without the extension (the sidebar-footer miss on #1884); a bare word in prose and a longer path stay out",
          listed + [err])

with tempfile.TemporaryDirectory() as repo:
    scratch_repo(repo, {
        "scripts/plain.sh": "x\n",
        "tests/api/hono/src/lib/dev/old-proxy.test.ts": 'Bun.spawnSync(["git", "grep", "-l", "-E", "old-address"], { cwd: ROOT })\n',
        "tests/dash-c.test.ts": 'spawnSync(["git", "-C", ROOT, "grep", "-l", "x"])\nconst out = await $`git -C ${ROOT} grep -l y`.text()\n',
        "tests/log-grep.test.ts": 'spawnSync(["git", "log", "--grep", "x"])\nconst out = await $`git log --oneline | grep x`.text()\n',
        "tests/new-guard.test.ts": "const found = await $`git grep -l TODO`.text()\n",
        "tests/prose.test.ts": 'const word = "grep"\n',
        "tests/wrapped.test.ts": 'const found = Bun.spawnSync(\n  [\n    "git",\n    "grep",\n    "-l",\n  ],\n  { cwd: ROOT },\n)\n',
    })
    write(repo, {"scripts/plain.sh": "y\n"})
    git(repo, "commit", "-qam", "change a script no test names")
    code, listed, err = touched(repo)
    check(code == 0 and listed == ["tests/api/hono/src/lib/dev/old-proxy.test.ts", "tests/dash-c.test.ts", "tests/new-guard.test.ts",
                                   "tests/wrapped.test.ts"],
          "10o rule 4: a test that runs git grep over the repo is listed, by argv or shell, wrapped or after -C, with no list edited (#2323's missed old-proxy); git log --grep stays out",
          listed + [err])

print(f"\n{len(failures)} failed" if failures else "\nall passed")
sys.exit(1 if failures else 0)
