#!/usr/bin/env python3
"""scripts/ops/merge-train/run.py, the merge train: sync() builds packages/ only when the reset moved something under it.

Every git call is a stub, HOME is a scratch folder, and the job's heartbeat, Checks loads and main loop never run, so
nothing reaches the main checkout, a lane or the live state folder. Run: python3 tests/test_ops_merge_train.py
"""
import json
import os
import sys
import tempfile
import types
import unittest

# The live job holds run.lock and imports beat from ops/, so both are stubbed before run.py's source runs.
fcntl_stub = types.ModuleType("fcntl")
fcntl_stub.LOCK_EX, fcntl_stub.LOCK_NB = 2, 4
fcntl_stub.flock = lambda *a, **k: None
sys.modules["fcntl"] = fcntl_stub
beat_stub = types.ModuleType("beat")
beat_stub.beat = lambda *a, **k: None
beat_stub.checkout = lambda: "/checkout"
sys.modules["beat"] = beat_stub

# checks.py and parallel.py do real work when run.py loads them, and sync() needs neither, so both lines come out;
# the job's own main loop is top-level code from run.py's `while True:` on, and the test must never run it, so it is cut.
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "ops", "merge-train", "run.py")
src = open(path).read()
pairs = [
    ('checks = load("checks", os.path.join(OPS, "checks", "checks.py"))', "checks = None"),
    ('lanes = load("parallel", os.path.join(OPS, "checks", "parallel.py"))', "lanes = None"),
    ('CYCLE = checks.setting("jobs.opsMergeTrain")["schedule"].get("every", 60)', "CYCLE = 60"),
]
for old, new in pairs:
    assert src.count(old) == 1, old
    src = src.replace(old, new)
src = src[: src.index("\nwhile True:")]
# run.py keeps its lock and log in the state folder under HOME, so HOME is a scratch folder and the live one is never touched.
scratch = tempfile.TemporaryDirectory()
os.environ["HOME"] = scratch.name
os.makedirs(os.path.join(scratch.name, ".playground", "ops", "merge-train"))
ns = {"__name__": "run_under_test"}
exec(compile(src, path, "exec"), ns)

BUILD = ["bun", "run", "turbo", "run", "build", "--filter=./packages/*"]
INSTALL = ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]


class FakeSh:
    """git's answers only: diff --quiet exits 1 when the path moved, what sync() branches on."""

    def __init__(self, packages, lock):
        self.calls = []
        self.packages, self.lock = packages, lock

    def __call__(self, argv, timeout=900):
        self.calls.append(argv)
        if argv[:2] == ["git", "rev-parse"]:
            return 0, "1111111111111111111111111111111111111111\n", ""
        if argv[:2] == ["git", "diff"]:
            moved = self.lock if argv[-1] == "bun.lock" else self.packages
            return (1 if moved else 0), "", ""
        return 0, "", ""


def run_sync(fake):
    original = ns["sh"]
    ns["sh"] = fake
    try:
        ns["sync"]()
    finally:
        ns["sh"] = original
    return fake.calls


class MergeReady(unittest.TestCase):
    def ready_with(self, answer):
        told, sent = [], []
        saved = {k: ns[k] for k in ("train", "checks", "tell_lead", "log")}
        ns["train"] = lambda *args, timeout=900: answer
        ns["checks"] = types.SimpleNamespace(tell_owner=lambda n, text: told.append((n, text)))
        ns["tell_lead"], ns["log"] = sent.append, lambda line: None
        try:
            return ns["merge_ready"](), told, sent
        finally:
            ns.update(saved)

    def test_a_pr_pr_train_ready_merged_is_told_to_its_owner_and_the_lead(self):
        out = '{"merged": {"n": 7, "sha": "abcdef1234", "why": "green @ abcdef1 · local"}, "refused": []}'
        detail, told, sent = self.ready_with((0, out, ""))
        self.assertEqual(detail, "merged #7 on ready as abcdef1")
        self.assertEqual(told, [(7, "#7: merged on ready as abcdef1")])
        self.assertEqual(sent, ["merged #7 abcdef1 (merge-on-ready)"])

    def test_nothing_merged_or_a_failed_run_merges_nothing(self):
        self.assertEqual(self.ready_with((0, '{"refused": []}', ""))[0], None)
        self.assertEqual(self.ready_with((1, "", "boom"))[0], None)


class CanaryNet(unittest.TestCase):
    def net_with(self, tip, green=True, revs="", after=7200, waiting=()):
        checked, told = [], []
        saved = {k: ns[k] for k in ("sh", "take_any_slot", "free_slot", "lanes", "checks", "log", "tell_lead", "CANARY_NET", "clock", "ready_waiting")}
        self.now += after
        ns["clock"], ns["ready_waiting"] = (lambda: self.now), (lambda: list(waiting))

        def sh(argv, timeout=900):
            if "ls-remote" in argv:
                return 0, f"{tip}\trefs/heads/canary\n", ""
            if "rev-list" in argv:
                return 0, revs, ""
            return 0, "feat(PG-1): grow the capped file (#41)\n", ""

        ns["sh"], ns["tell_lead"], ns["CANARY_NET"] = sh, told.append, self.state
        ns["take_any_slot"], ns["free_slot"], ns["log"] = (lambda holder: None), (lambda: None), (lambda line: None)
        ns["lanes"] = types.SimpleNamespace(prepare=lambda k: ("/wt", "db"))
        ns["checks"] = types.SimpleNamespace(test_canary=lambda c: (checked.append(c), green)[1], stop_stack=lambda: None, notify=lambda text: None)
        try:
            return ns["canary_net"](), checked, told
        finally:
            ns.update(saved)

    def setUp(self):
        self.state = os.path.join(tempfile.mkdtemp(), "canary-net.json")
        self.now = 1_800_000_000.0

    def test_a_new_tip_inside_the_hour_waits_for_the_hour_to_pass(self):
        a, b = "a" * 40, "b" * 40
        self.assertEqual(self.net_with(a)[1], [a])
        self.assertEqual(self.net_with(b, after=1800)[:2], (None, []))
        self.assertEqual(self.net_with(b, after=1799)[:2], (None, []))
        self.assertEqual(self.net_with(b, after=1)[1], [b])

    def test_a_new_tip_yields_while_a_ready_prs_checks_wait_for_a_slot(self):
        a, b = "a" * 40, "b" * 40
        self.net_with(a)
        self.assertEqual(self.net_with(b, after=3600, waiting=[2405, 2410])[:2], (("ok", "canary's run of bbbbbbb yields to the Checks of ready #2405, #2410"), []))
        self.assertEqual(self.net_with(b, after=60)[1], [b])

    def test_a_new_tip_yields_for_at_most_an_hour_past_its_own_hour(self):
        a, b = "a" * 40, "b" * 40
        self.net_with(a)
        self.assertEqual(self.net_with(b, after=3600, waiting=[2405])[1], [])
        self.assertEqual(self.net_with(b, after=3599, waiting=[2405])[1], [])
        self.assertEqual(self.net_with(b, after=1, waiting=[2405])[1], [b])

    def test_a_red_tip_is_checked_again_at_once_whatever_the_hour_or_the_waiters(self):
        good, tip = "g" * 40, "r" * 40
        self.net_with(good)
        self.net_with(tip, green=False)
        self.assertEqual(self.net_with(tip, after=60, waiting=[2405])[1], [tip])

    def test_after_a_culprit_the_next_tip_is_checked_at_once_whatever_the_hour_or_the_waiters(self):
        tip, fix = "9" * 40, "8" * 40
        for _ in range(3):
            self.net_with(tip, green=False)
        self.assertEqual(self.net_with(fix, after=60, waiting=[2405])[1], [fix])

    def test_a_new_canary_tip_is_checked_once(self):
        tip = "a" * 40
        self.assertEqual(self.net_with(tip)[:2], (("ok", "checked canary aaaaaaa: green"), [tip]))
        self.assertEqual(self.net_with(tip)[:2], (None, []))
        self.assertEqual(self.net_with("b" * 40)[1], ["b" * 40])

    def test_a_red_tip_is_checked_again_and_a_green_rerun_clears_it(self):
        good, tip = "g" * 40, "r" * 40
        self.net_with(good)
        self.assertEqual(self.net_with(tip, green=False)[1], [tip])
        self.assertEqual(self.net_with(tip, green=True)[1], [tip])
        self.assertEqual(self.net_with(tip)[:2], (None, []))

    def test_a_red_tip_red_again_halves_to_the_merge_that_broke_canary_and_tells_the_lead(self):
        good, c1, c2, c3 = "0" * 40, "1" * 40, "2" * 40, "3" * 40
        self.net_with(good)
        self.net_with(c3, green=False)
        self.net_with(c3, green=False)
        revs = f"{c1}\n{c2}\n{c3}\n"
        self.assertEqual(self.net_with(c3, green=True, revs=revs)[1], [c2])
        self.assertEqual(self.net_with(c3, green=False, revs=f"{c3}\n")[1:], ([], ["canary turned red at 3333333 (feat(PG-1): grow the capped file (#41)): revert it in a PR that merges canary in; a green run of its own on that head passes the canary gate"]))
        self.assertEqual(self.net_with(c3)[:2], (None, []))
        self.assertEqual(self.net_with("4" * 40)[1], ["4" * 40])

    def test_a_first_red_with_no_green_before_it_names_the_tip_and_says_it_could_not_halve(self):
        tip = "9" * 40
        self.net_with(tip, green=False)
        self.net_with(tip, green=False)
        _, checked, told = self.net_with(tip)
        self.assertEqual(checked, [])
        self.assertEqual(len(told), 1)
        self.assertIn("is red at 9999999, and no earlier commit is known green, so the net could not halve", told[0])


class ReadyWaiting(unittest.TestCase):
    def test_only_a_live_checks_ticket_for_a_pr_with_a_go_or_a_ready_time_counts(self):
        root = tempfile.mkdtemp()
        queue, mq = os.path.join(root, "run-slot.waiters"), os.path.join(root, "merge-queue.json")
        os.makedirs(queue)
        live, dead = os.getpid(), 2**22 + 7
        for name in (f"1-{live}-ops-checks-2405", f"2-{live}-ops-checks-2410-2411", f"3-{dead}-ops-checks-2420", f"4-{live}-ops-checks-2430", f"5-{live}-twyy6k-worker"):
            open(os.path.join(queue, name), "w").close()
        with open(mq, "w") as f:
            json.dump({"queue": [{"pr": 2405, "goAt": "2026-10-28T13:00:00Z"}, {"pr": 2411, "readyAt": "2026-10-28T13:05:00Z"}, {"pr": 2420, "goAt": "2026-10-28T13:06:00Z"}, {"pr": 2430, "eta": "2026-10-28T15:00:00Z"}]}, f)
        saved = {k: ns[k] for k in ("WAITERS", "MERGE_QUEUE")}
        ns["WAITERS"], ns["MERGE_QUEUE"] = queue, mq
        try:
            self.assertEqual(ns["ready_waiting"](), [2405, 2411])
            os.remove(mq)
            self.assertEqual(ns["ready_waiting"](), [])
        finally:
            ns.update(saved)


class Cycle(unittest.TestCase):
    def cycle_with(self, net):
        calls = []
        saved = {k: ns[k] for k in ("sync", "train", "fingerprint", "canary_net", "merge_ready")}
        saved_state = dict(ns["state"])
        ns["sync"] = lambda: None
        ns["train"] = lambda *args, timeout=900: (0, '{"next": {"kind": "none"}}', "")
        ns["fingerprint"] = lambda: "same"
        ns["state"].update(fingerprint="same", rebuild_now=False)
        ns["canary_net"] = lambda: (calls.append("net"), net)[1]
        ns["merge_ready"] = lambda: calls.append("merge_ready")
        try:
            return ns["cycle"](), calls
        finally:
            ns.update(saved)
            ns["state"].clear()
            ns["state"].update(saved_state)

    def test_an_unchanged_fingerprint_still_runs_the_net_on_an_unchecked_tip(self):
        got, calls = self.cycle_with(("ok", "checked canary aaaaaaa: green"))
        self.assertEqual((got, calls), (("ok", "checked canary aaaaaaa: green"), ["net"]))

    def test_an_unchanged_fingerprint_with_nothing_for_the_net_scans_nothing(self):
        got, calls = self.cycle_with(None)
        self.assertEqual((got, calls), (("ok", "no train; nothing changed since the last scan"), ["net"]))

class Sync(unittest.TestCase):
    def test_a_reset_that_touches_packages_builds(self):
        calls = run_sync(FakeSh(packages=True, lock=False))
        self.assertIn(BUILD, calls)
        self.assertNotIn(INSTALL, calls)

    def test_a_reset_that_leaves_packages_skips_the_build(self):
        calls = run_sync(FakeSh(packages=False, lock=False))
        self.assertNotIn(BUILD, calls)

    def test_a_moved_lockfile_still_installs(self):
        calls = run_sync(FakeSh(packages=False, lock=True))
        self.assertIn(INSTALL, calls)
        self.assertNotIn(BUILD, calls)


if __name__ == "__main__":
    unittest.main(verbosity=2)
