#!/usr/bin/env python3
"""Every `docker rm` in the repo removes the container's volumes too.

A Postgres container keeps its data in an anonymous volume, and so does a Redis one (/data). `--rm` drops that volume when the
container exits, but an explicit `docker rm -f` does not, so each test run that removes its
container that way leaves a volume behind (about 200 an hour on 7 Oct). So in every text file
the repo holds, a `docker rm` or `docker container rm`, as a shell command or as an argv list
(`["docker", "rm", "-fv", name]`), carries `-v` or `--volumes`.

A line is read on its own, so an argv list split across lines is not parsed here.

Run: python3 tests/test_docker_rm_volumes.py
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SELF = os.path.relpath(os.path.abspath(__file__), ROOT)
SKIP = {"CHANGELOG.md"}
WORD = re.compile(r"[^\s\"'`,\[\]()]+")


def problems_in(rel, text):
    """Each `docker rm` in the text that keeps the container's volumes."""
    found = []
    for n, line in enumerate(text.splitlines(), 1):
        words = WORD.findall(line)
        for i, word in enumerate(words):
            if word != "docker":
                continue
            rest = words[i + 1:]
            if rest[:2] == ["container", "rm"]:
                rest = rest[2:]
            elif rest[:1] == ["rm"]:
                rest = rest[1:]
            else:
                continue
            options = []
            for token in rest:
                if not token.startswith("-"):
                    break
                options.append(token)
            if not any(o == "--volumes" or (not o.startswith("--") and "v" in o) for o in options):
                found.append(f"{rel}:{n}: docker rm without -v: {line.strip()}")
    return found


def self_test():
    """The check flags what it must and passes what it must, so a quiet scan means something."""
    bad = [
        "docker rm -f t-offline",
        "docker rm db",
        "docker container rm -f db",
        'Bun.spawnSync(["docker", "rm", "-f", container], { stderr: "ignore" })',
        'subprocess.run(["docker", "rm", "-f", cid], capture_output=True)',
        "docker rm --force db",
        "docker rm -f playground-a-redis",
    ]
    good = [
        "docker rm -fv t-offline",
        "docker rm -f -v db",
        "docker rm -fv playground-a-redis",
        "docker container rm --force --volumes db",
        'Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore" })',
        "docker run --rm -d postgres:alpine",
        "docker compose down -v",
    ]
    wrong = [f"not flagged: {line!r}" for line in bad if not problems_in("doc.md", line)]
    wrong += [f"flagged: {line!r}" for line in good if problems_in("doc.md", line)]
    return wrong


def main():
    wrong = self_test()
    for line in wrong:
        print(f"FAIL self-test {line}")
    files = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    checked = 0
    failures = []
    for rel in files:
        path = os.path.join(ROOT, rel)
        if rel in SKIP or rel == SELF or os.path.islink(path) or not os.path.isfile(path):
            continue
        try:
            text = open(path, encoding="utf-8").read()
        except UnicodeDecodeError:
            continue
        checked += 1
        failures += problems_in(rel, text)
    for failure in failures:
        print(f"FAIL {failure}")
    total = len(wrong) + len(failures) + (0 if checked else 1)
    print(f"{'PASS' if not total else 'FAIL'} {checked} files checked, {len(failures)} docker rm commands without -v")
    print("FAILURES:", total)
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
