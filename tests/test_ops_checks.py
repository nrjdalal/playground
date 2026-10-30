#!/usr/bin/env python3
"""scripts/ops/checks, the Checks lane: go.py's picks, outside.py's outside-author rule, and checks.py's PR body check and verify check.

Every gh call is a stub, so nothing reaches GitHub, a lane or the live state folder. Run: python3 tests/test_ops_checks.py
"""
import contextlib
import functools
import json
import os
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "ops", "checks"))
import checks  # noqa: E402
import go  # noqa: E402
import outside  # noqa: E402
import parallel  # noqa: E402
from go import lane_runs, order, ready, still_open  # noqa: E402
from outside import runs  # noqa: E402

# checks.outsideAuthors as a store that sets it would read
outside.OUTSIDE = {"outside-dev"}

read_gos = go.gos

HEAD = "abc1234ffffffff"
SHA = "a" * 40


# removed when the run ends, a direct one included
SCRATCH = tempfile.TemporaryDirectory()


def gos(*rows):
    fd, path = tempfile.mkstemp(suffix=".jsonl", dir=SCRATCH.name)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(json.dumps(r) for r in rows) + "\nnot json\n")
    return path


def stamp_read(at=HEAD, passed=(), sources=()):
    """stamp-cli's read at a head: the stamp's commit, the checks it passed, and one stamp per source given, its one check from there
    ("agent drive" for a tester, a run id for GitHub's jobs)."""
    stamps = [{"checks": {"agent-drive" if s.endswith("drive") else "verify": {"source": s.split()[0], "status": "pass"}}} for s in sources]
    return {"at": at, "passed": list(passed), "reach": [at], "stamps": stamps, "status": "green", "why": ""}


def test_ready_takes_a_5_at_the_head_with_no_stamp():
    assert ready(HEAD, ["## ReviewBot · round 2: 5/5 at abc1234"], None)
    assert ready(HEAD, ["## ReviewBot · round 2: 5/5 at abc1234"], {"error": "the parents of abc1234 did not read"})
    assert ready(HEAD, ["## ReviewBot · round 2: 5/5 at abc1234"], {"passed": [], "reach": [HEAD], "stamps": [], "why": "no stamp"})


def test_ready_takes_the_newest_verdict_at_the_head():
    assert not ready(HEAD, ["## ReviewBot · round 2: 5/5 at abc1234", "## ReviewBot · round 3: 3/5 at abc1234"], None)
    assert not ready(HEAD, ["## ReviewBot · round 2: 5/5 at 9999999"], None)


def test_ready_skips_a_head_whose_verify_holds_on_it_or_carried_past_a_clean_merge():
    five = ["## ReviewBot · round 2: 5/5 at abc1234"]
    assert not ready(HEAD, five, stamp_read(passed=["verify"], sources=["local"]))
    assert not ready(HEAD, five, stamp_read(at="9999999", passed=["verify", "test"], sources=["local"]))


def test_ready_skips_a_head_checks_already_stamped_but_not_a_tester_or_the_jobs():
    five = ["## ReviewBot · round 2: 5/5 at abc1234"]
    assert not ready(HEAD, five, stamp_read(sources=["local"]))
    assert ready(HEAD, five, stamp_read(sources=["agent drive", "1823"]))
    assert ready(HEAD, five, stamp_read(at="9999999", sources=["local"]))


def test_order_puts_the_merge_queue_first():
    assert order([5, 1273, 1262, 3], [1262, 1153, 1273]) == [1262, 1273, 3, 5]


def test_lane_runs_takes_each_lanes_newest_line():
    lines = ["2026-10-19T20:45:29Z lane chk-9: #1262 @ d9c4751", "2026-10-19T21:16:30Z #1238 @ 63cc4b2: pass x", "2026-10-19T21:52:35Z lane chk-9: #1244 @ 17da9f2", "2026-10-19T20:45:33Z lane chk-10: #1153 @ 484f640", "2026-10-19T21:00:00Z lane chk-10 error on #1153: boom"]
    assert lane_runs(lines) == {9: (1244, "17da9f2"), 10: (1153, "484f640")}


def test_still_open_skips_a_pr_merged_since_the_list():
    logged, go.log = [], lambda line: logged.append(line)
    for state, want in (("open\n", True), ("closed\n", False), ("", False)):
        go.gh = lambda *a, s=state: s
        assert still_open(1549) is want
    assert logged == ["skip #1549: closed since the list was read", "skip #1549: unknown since the list was read"]


@contextlib.contextmanager
def lanes(*rows):
    """mine as main() keeps it, one live `sleep` per (lane, pr, head), each in its own group and started here, so a stop signals only this test's children."""
    procs, outs, mine = [], [], {}
    try:
        for k, n, head in rows:
            procs.append(subprocess.Popen(["sleep", "60"], start_new_session=True))
            outs.append(open(os.devnull, "w"))
            mine[k] = (procs[-1], n, head, time.time(), outs[-1])
        yield mine
    finally:
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()
        for out in outs:
            out.close()


def reap_with(mine, listed):
    """go.reap() against a stub gh whose `gh pr list` answers listed (rows, raw text, or an exception it raises), with no run-slot log, so overdue() stops nothing; returns (log lines, gh calls)."""
    logged, calls, ops = [], [], go.OPS

    def gh(*args):
        calls.append(args)
        if isinstance(listed, Exception):
            raise listed
        return listed if isinstance(listed, str) else json.dumps(listed)
    go.gh, go.log, go.OPS = gh, logged.append, SCRATCH.name
    try:
        go.reap(mine, time.time())
    finally:
        go.OPS = ops
    return logged, calls


def test_reap_stops_a_run_whose_go_was_taken_back_or_whose_head_moved():
    # a PR's run at 3417d1d kept its lane after `ci:go --take-back` removed the label
    moved = "b" * 40
    with lanes((9, 1984, SHA), (10, 1985, SHA), (11, 1986, SHA), (12, 1987, SHA)) as mine:
        procs = {k: v[0] for k, v in mine.items()}
        logged, _ = reap_with(mine, [pr(1984, labels=()), pr(1985, head=moved), pr(1986)])
        assert list(mine) == [11] and procs[11].poll() is None
        assert [procs[k].returncode for k in (9, 10, 12)] == [-signal.SIGTERM] * 3
        assert [line for line in logged if line.startswith("stopped")] == [
            f"stopped #1984@{SHA[:7]} on chk-9: its Cloud CI was taken back",
            f"stopped #1985@{SHA[:7]} on chk-10: its head moved to {moved[:7]}",
            f"stopped #1987@{SHA[:7]} on chk-12: no longer open into canary, a close or a new base",
        ]


def test_reap_stops_nothing_on_a_list_that_fails_or_fills_its_limit():
    # a PR cut off a full or broken list is not a take-back
    full = [pr(n) for n in range(1, go.LIST_MAX + 1)]
    for listed in (RuntimeError("gh pr: HTTP 502"), "[{\"number\": 1984", full):
        with lanes((9, 1984, SHA)) as mine:
            logged, calls = reap_with(mine, listed)
            assert list(mine) == [9] and mine[9][0].poll() is None
            assert not [line for line in logged if line.startswith("stopped")]
            assert [c[:2] for c in calls] == [("pr", "list")] and calls[0][calls[0].index("--limit") + 1] == str(go.LIST_MAX)


def test_reap_reads_no_list_while_go_runs_nothing():
    _, calls = reap_with({}, [])
    assert calls == []


def todo_with(prs, path="/nonexistent", gone=None, said=(), github=None, tried=None, room=4, queue=(), first=(), read=None):
    """go.todo() against stub gh and gos.jsonl: prs is `gh pr list`'s rows, each head carries a 5/5 and then said's first lines and is open, gone holds go.gos()'s (pr, sha) pairs, a go at every head by default, github answers any other call it knows, and read is the stamp every head reads (none by default); returns (picked, gh calls)."""
    calls = []

    def gh(*args):
        calls.append(args)
        if args[:2] == ("pr", "list"):
            return json.dumps(prs)
        if args[1].endswith("/comments"):
            return json.dumps([f"## ReviewBot · round 1: 5/5 at {p['headRefOid'][:7]}" for p in prs if args[1].endswith(f"/{p['number']}/comments")] + list(said))
        if github and (out := github(args)) is not None:
            return out
        if args[1].endswith("/files"):
            return "api/hono/src/main.ts\n"
        return "open\n"

    go.gh, go.log, go.queue = gh, lambda line: None, lambda: list(queue)
    go.read_stamp = lambda n, head: read
    go.gos = lambda: {(p["number"], p["headRefOid"]) for p in prs} if gone is None else gone
    go.runs = functools.partial(outside.runs, path=path)
    return go.todo({} if tried is None else tried, set(), room, CANARY, first=first), calls


CANARY = "c" * 40


def label_local_with(labels):
    """parallel.label_local(2102) against a stub sh; returns the gh calls it made."""
    calls = []
    parallel.sh = lambda argv, **_: (calls.append(argv), (0, ""))[1]
    parallel.label_local(2102, labels)
    return calls


def test_pr_view_reads_each_label_name_whole():
    parallel.sh = lambda argv, **_: (0, f"acme {SHA} Review \u2022 5/5\tCloud CI\n")
    assert parallel.pr_view(2102) == ("acme", SHA, ["Review \u2022 5/5", "Cloud CI"])
    parallel.sh = lambda argv, **_: (0, f"acme {SHA} \n")
    assert parallel.pr_view(2102) == ("acme", SHA, [])


def test_a_checks_run_with_no_go_labels_the_pr_local_ci():
    assert label_local_with(["Review \u2022 5/5"]) == [["gh", "pr", "edit", "2102", "--repo", checks.REPO, "--add-label", "Local CI"]]


def test_a_checks_run_on_a_cloud_ci_pr_leaves_it_on_cloud_ci_alone():
    assert label_local_with(["Cloud CI"]) == []
    assert label_local_with(["Local CI"]) == []


def pr(n, head=SHA, author=checks.OWNER, labels=("Cloud CI",)):
    return {"number": n, "headRefOid": head, "author": {"login": author}, "labels": [{"name": l} for l in labels]}


def test_todo_reads_the_go_label_from_the_plain_list_never_search():
    picked, calls = todo_with([pr(1579), pr(1580, labels=()), pr(1581, labels=("other",))])
    assert picked == [(1579, SHA)]
    listed = [c for c in calls if c[:2] == ("pr", "list")]
    assert len(listed) == 1 and "labels" in listed[0][listed[0].index("--json") + 1]
    assert not any(a == "--label" or "search" in a for c in calls for a in c)


def test_todo_takes_an_outside_author_only_at_the_head_the_builder_gave_a_go():
    path = gos({"by": "builder", "pr": 1567, "sha": SHA})
    assert todo_with([pr(1567, author="outside-dev")], path)[0] == [(1567, SHA)]
    assert todo_with([pr(1567, head="b" * 40, author="outside-dev")], path)[0] == []
    assert todo_with([pr(1567, author="outside-dev")])[0] == []
    assert todo_with([pr(1567, author="someone-else")], path)[0] == []


def test_todo_takes_a_labelled_pr_only_at_the_head_its_go_named():
    assert todo_with([pr(1667)], gone={(1667, "b" * 40)})[0] == []
    assert todo_with([pr(1667)], gone=set())[0] == []
    assert todo_with([pr(1667)], gone={(1667, SHA)})[0] == [(1667, SHA)]


def test_todo_runs_no_checks_on_a_pr_whose_diff_touches_no_dashboard_code():
    # GitHub Actions' two jobs green at the head stand for the suite, and Checks runs verify alone, so a PR off the dashboard paths needs none
    def github(args):
        if args[1].endswith("/2409/files"):
            return "packages/scripts/src/pr-merge/gates.ts\nAGENTS.md\n"
        return None
    tried = {}
    assert todo_with([pr(2409), pr(2410)], github=github, tried=tried)[0] == [(2410, SHA)]
    # once a canary, so the next cycle reads no files for it
    assert tried == {f"2409 {SHA} {CANARY}": go.TRIES}


def test_todo_runs_no_checks_on_a_head_whose_stamp_carries_verify():
    # a clean canary merge carries the stamp, so a canary move starts no run
    assert todo_with([pr(2410)], read=stamp_read(at="9999999", passed=["verify"], sources=["local"]))[0] == []
    assert todo_with([pr(2410)], read=stamp_read(at="9999999", sources=["1823"]))[0] == [(2410, SHA)]


def test_stamp_jobs_posts_only_for_a_pr_with_a_go_at_its_head():
    asked = []
    go.stamp, go.log = (lambda command, n, head: (asked.append((command, n, head)), (0, ""))[1]), lambda line: None
    go.gos = lambda: {(1, SHA), (2, "b" * 40)}
    go.runs = functools.partial(outside.runs, path="/nonexistent")
    go.stamp_jobs([pr(1), pr(2), pr(3), pr(4, labels=())])
    assert asked == [("jobs", 1, SHA)]


DIED = "2026-10-25T22:25:04Z lane chk-11 error on #2084: the suite phase under run-slot left no result (exit 1): rror: init_sys_streams: can't initialize sys standard streams"


def test_todo_puts_a_pr_whose_phase_died_ahead_of_the_merge_queue():
    lines = ["2026-10-25T20:48:45Z lane chk-11: #2084 @ 07a4812", DIED, "Python runtime state: core initialized", "OSError: [Errno 9] Bad file descriptor"]
    assert todo_with([pr(2123), pr(2084)], room=1, queue=[2123, 2084], first=go.died(lines))[0] == [(2084, SHA)]


def test_died_forgets_a_pr_once_a_lane_runs_it_again():
    assert go.died([DIED, "2026-10-25T22:36:26Z lane chk-9: #2084 @ 07a4812"]) == set()
    assert go.died(["2026-10-25T22:00:00Z lane chk-11 error on #2084: worktree chk-11: boom"]) == set()


def test_gos_reads_each_go_and_skips_a_bad_line():
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "gos.jsonl"), "w") as f:
            f.write(json.dumps({"pr": 1667, "sha": SHA}) + "\nnot json\n" + json.dumps({"pr": 1668}) + "\n" + json.dumps({"pr": "1669", "sha": "b" * 40}) + "\n")
        ops, go.OPS = go.OPS, d
        try:
            assert read_gos() == {(1667, SHA), (1669, "b" * 40)}
            go.OPS = os.path.join(d, "missing")
            assert read_gos() == set()
        finally:
            go.OPS = ops


def test_the_gos_helper_leaves_no_file_behind_on_a_direct_run():
    with tempfile.TemporaryDirectory() as d:
        code = f"import sys; sys.path.insert(0, {os.path.dirname(os.path.abspath(__file__))!r}); import test_ops_checks as t; t.gos({{'pr': 1}}); t.gos({{'pr': 2}})"
        subprocess.run([sys.executable, "-c", code], env={**os.environ, "TMPDIR": d}, check=True, capture_output=True, timeout=60)
        assert os.listdir(d) == []


def test_the_owner_always_runs():
    assert runs("acme", "acme", 1, SHA, "/nonexistent")


def test_an_outside_author_runs_only_at_a_head_the_builder_gave_a_go():
    path = gos({"by": "builder", "pr": 1567, "sha": SHA})
    assert runs("outside-dev", "acme", 1567, SHA, path)
    assert not runs("outside-dev", "acme", 1567, "b" * 40, path)
    assert not runs("outside-dev", "acme", 1570, SHA, path)
    assert not runs("outside-dev", "acme", 1567, "", path)
    assert not runs("outside-dev", "acme", 1567, SHA, "/nonexistent")


def test_a_go_by_anyone_else_does_not_count():
    assert not runs("outside-dev", "acme", 1567, SHA, gos({"by": "dispatcher", "pr": 1567, "sha": SHA}))


def test_every_other_outside_author_is_refused_even_with_a_go():
    assert not runs("someone-else", "acme", 1567, SHA, gos({"by": "builder", "pr": 1567, "sha": SHA}))
    assert runs("outside-dev", "acme", 1567, SHA, gos({"by": "x7mh4d-builder", "pr": 1567, "sha": SHA}))
    assert not runs("outside-dev", "acme", 1567, SHA, gos({"by": "x7mh4d-worker", "pr": 1567, "sha": SHA}))


SKILL_BODY = "## TL;DR\n\nThe board shows each PR once. You see one row for each PR.\n\n## Summary\n\nThe board reads each PR once.\n\n## Evidence\n\n- **Before:** two rows. **After:** one.\n\n## Merge Danger\n\n**Door:** two-way\n\n## Links\n\n- Closes #1906\n"


def test_body_refusal_takes_the_pr_template():
    def fn(body):
        return checks.body_refusal(body) is None
    # the PR template: a TL;DR of 2 sentences first, then Summary, Evidence, Merge Danger and Links, in order
    assert fn(SKILL_BODY)
    assert fn(SKILL_BODY + "\n🤖 Generated with Claude Code\n")
    # a TL;DR of bullets alone, with no Outcome label anywhere, passes
    assert fn(SKILL_BODY.replace("The board shows each PR once. You see one row for each PR.", "- The board shows each PR once\n- You see one row for each PR"))
    # a TL;DR of bullets passes on 2 sentences across them, a bullet's closing stop optional, with no upper count
    def bullets(*items):
        return SKILL_BODY.replace("The board shows each PR once. You see one row for each PR.", "\n".join(items))
    assert checks.template_body(bullets("- The board shows each PR once", "- You see one row for each PR."))
    assert checks.template_body(bullets("- One.", "- Two.", "- Three.", "- Four.", "- Five."))
    assert checks.template_body(bullets("Outcome: The board reads right.", "", "- It shows each PR once"))
    assert not checks.template_body(bullets("- The board shows each PR once"))
    # a CRLF body, as GitHub's web editor saves one, reads the same
    assert checks.template_body(bullets("- The board shows each PR once", "- You see one row for each PR").replace("\n", "\r\n"))
    # a heading inside a code fence is a sample, not a section, and ## TLDR reads as ## TL;DR
    assert checks.template_body(SKILL_BODY.replace("The board reads each PR once.", "The board reads each PR once.\n\n```markdown\n## Links\n## Summary\n```"))
    assert checks.template_body(SKILL_BODY.replace("## TL;DR", "## TLDR"))
    # a short TL;DR, anything above it, a missing section or the sections out of order is no template body
    assert not fn(SKILL_BODY.replace(" You see one row for each PR.", ""))
    assert not checks.template_body("Outcome: one. Two.\n\n" + SKILL_BODY)
    assert not fn(SKILL_BODY.replace("## TL;DR\n\n", ""))
    assert not fn(SKILL_BODY.replace("## Links", "## See also"))
    assert not fn(SKILL_BODY.replace("## Evidence", "## X").replace("## Merge Danger", "## Evidence").replace("## X", "## Merge Danger"))
    # a labelled paragraph is no template body
    assert not fn("Outcome: the board reads right. It shows each PR once.\n")


def test_body_refusal_names_a_tldr_label():
    labelled = SKILL_BODY.replace("The board", "Outcome: The board")
    # a TL;DR holds no Outcome label line, and the refusal names it and the template
    assert 'labelled "Outcome:"' in checks.body_refusal(labelled)
    assert 'labelled "Outcome:"' in checks.body_refusal(SKILL_BODY.replace("The board", "**Outcome:** The board"))
    assert "extensions/core/skills/pr/SKILL.md" in checks.body_refusal(SKILL_BODY.replace("The board shows each PR once. You see one row for each PR.", "- Outcome: the board reads right\n- It shows each PR once"))
    # a quote, a numbered item, and a ### sub-heading inside the TL;DR are caught too
    for line in ("> Outcome: The board", "1. Outcome: The board", "### Why\n\nOutcome: The board"):
        assert 'labelled "Outcome:"' in checks.body_refusal(SKILL_BODY.replace("The board", line, 1))
    # a template body, or a label outside the TL;DR, passes
    assert checks.body_refusal(SKILL_BODY) is None
    assert checks.body_refusal(SKILL_BODY.replace("The board reads each PR once.", "Outcome: one row.")) is None
    assert checks.body_refusal(SKILL_BODY.replace("The board", "Outcomes vary. The board")) is None


def test_needs_verify():
    fn = checks.needs_verify
    # the web, the API and every package the dashboard imports need verify
    assert fn(["web/next/src/app/page.tsx"])
    assert fn(["api/hono/src/index.ts"])
    for pkg in ("auth", "config", "db", "env"):
        assert fn([f"packages/{pkg}/src/index.ts"]), pkg
    # one dashboard path among others is enough
    assert fn(["scripts/ops/README.md", "web/next/src/lib/time.ts"])
    # scripts, hooks, skills, docs, tests and the other packages do not
    assert not fn(["scripts/ops/runner-host/ci.sh", "scripts/hooks/no-stash.ts", "extensions/core/skills/playbook/SKILL.md"])
    assert not fn(["tests/web/next/src/lib/time.test.ts", "docs/playground/linear.md", "packages/scripts/src/pr-merge/index.ts"])
    assert not fn(["packages/redis/src/index.ts", ".github/workflows/test.yml"])
    # a prefix that only starts like a dashboard folder is not one
    assert not fn(["web/nextjs-notes.md", "api/honorific.md"])
    assert not fn([])


def test_diff_needs_verify():
    # diff_needs_verify reads the head's own changes since its merge base, so canary's later dashboard commits do not count
    with tempfile.TemporaryDirectory() as d:
        def git(*a):
            subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=d, check=True, capture_output=True)

        def commit(path, msg):
            os.makedirs(os.path.join(d, os.path.dirname(path)), exist_ok=True)
            with open(os.path.join(d, path), "a") as f:
                f.write(msg + "\n")
            git("add", "-A")
            git("commit", "-qm", msg)

        git("init", "-q", "-b", "canary")
        commit("README.md", "base")
        git("checkout", "-q", "-b", "pr")
        commit("scripts/ops/x.sh", "pr")
        git("checkout", "-q", "canary")
        commit("web/next/a.tsx", "canary moved")
        assert not checks.diff_needs_verify("canary", "pr", cwd=d)
        git("checkout", "-q", "pr")
        commit("api/hono/b.ts", "pr dashboard")
        assert checks.diff_needs_verify("canary", "pr", cwd=d)
        # a revision git does not know reads as needing verify
        assert checks.diff_needs_verify("canary", "nope", cwd=d)
        # a rename out of the dashboard paths still touches dashboard code, as pr:merge and go.py read it by both paths
        git("checkout", "-q", "-b", "moved", "canary")
        os.makedirs(os.path.join(d, "scripts"), exist_ok=True)
        git("mv", "web/next/a.tsx", "scripts/a.tsx")
        git("commit", "-qm", "move out of the dashboard")
        assert checks.diff_needs_verify("canary", "moved", cwd=d)



def test_portless_ssl_reads_an_https_stack_under_portless_ca():
    import http.server
    import ssl
    import threading
    import urllib.request

    with tempfile.TemporaryDirectory() as d:
        ca, key = os.path.join(d, "ca.pem"), os.path.join(d, "key.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", key, "-out", ca], check=True, capture_output=True)
        assert checks.portless_ssl({"PORTLESS_STATE_DIR": os.path.join(d, "missing")}) is None
        server = http.server.HTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(ca, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"https://localhost:{server.server_address[1]}/"
        try:
            with urllib.request.urlopen(url, timeout=5, context=checks.portless_ssl({"PORTLESS_STATE_DIR": d})) as r:
                assert r.status == 200
            try:
                urllib.request.urlopen(url, timeout=5)
                raise AssertionError("the system's store took portless's certificate")
            except urllib.error.URLError:
                pass
        finally:
            server.shutdown()


def test_checks_of_reads_each_line_as_a_check_and_a_fail_as_its_comment():
    lines = ["✓ verify  skipped: no dashboard code in the diff", "✓ stack  up", "✗ cursor  the cursor check `x` failed\non two lines", "✓ cursor  again", "not a line"]
    assert checks.checks_of(lines) == {"verify": ("skip", None), "stack": ("pass", None), "cursor": ("fail", "The cursor check x failed on two lines.")}
    assert checks.sentence(" ".join(["word"] * 30)).count(" ") == 19
    assert checks.sentence("  ") is None


def test_stamp_checks_adds_verify_from_the_exit_code_of_verify_all():
    lines = ["✓ health  200 at 8c61228", "✓ pages  12 routes render", "✓ pr-body  the PR body is the PR template"]
    got = checks.stamp_checks(0, "", lines)
    assert set(got) == {"health", "pages", "pr-body", "verify"} and got["verify"] == ("pass", None)
    red = checks.stamp_checks(1, "", ["✓ health  200 at 8c61228", "✗ signin  the agent login answered 404"])
    assert red["verify"] == ("fail", "Verify all exited 1.") and red["signin"][0] == "fail"
    stopped = checks.stamp_checks(None, "frozen install failed", [])
    assert stopped == {"preflight": ("fail", "Frozen install failed."), "verify": ("fail", "The preflight stopped the run.")}


def test_post_stamp_runs_the_one_writer_with_each_check_and_the_remark():
    calls = []
    saved, repo = checks.run, checks.REPO
    checks.run = lambda argv, timeout=900, env=None, cwd=None: (calls.append(argv), (0, "https://github.com/x#c1\n"))[1]
    # factory.repo as a store that sets it reads, since a box run has no origin for its default
    checks.REPO = "acme/app"
    try:
        url = checks.post_stamp(7, SHA, "red", {"verify": ("fail", "The release check failed."), "pr-body": ("pass", None)}, "The verify check failed.")
    finally:
        checks.run, checks.REPO = saved, repo
    assert url == "https://github.com/x#c1"
    assert calls == [["bun", "packages/scripts/src/pr-merge/stamp-cli.ts", "post", SHA, "red", "--pr", "7", "--repo", "acme/app",
                      "--check", "pr-body=pass", "--check", "verify=fail The ship check failed.", "--remark", "The verify check failed."]]


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print("PASS", name)
            except Exception as e:
                fails += 1
                print("FAIL", name, repr(e))
    print("FAILURES:", fails)
    sys.exit(1 if fails else 0)
