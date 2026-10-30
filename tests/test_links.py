#!/usr/bin/env python3
"""Every relative Markdown link in the repo points at a file that exists.

The skills read each other's files (linear reads claim's rules, acme
links claim's FOLLOW-UP.md), so a renamed file would otherwise break silently.

Run: python3 tests/test_links.py
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINK = re.compile(r"\]\(([^)\s]+)\)")
FENCE = re.compile(r"```.*?```", re.S)
INLINE_CODE = re.compile(r"`[^`\n]*`")  # a link written inside inline code is an example, not a link


def main():
    files = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    checked = broken = 0
    for rel in files:
        text = INLINE_CODE.sub("", FENCE.sub("", open(os.path.join(ROOT, rel), encoding="utf-8").read()))
        for target in LINK.findall(text):
            if re.match(r"[a-z]+:", target) or target.startswith("#"):
                continue
            path = os.path.normpath(os.path.join(ROOT, os.path.dirname(rel), target.split("#")[0]))
            checked += 1
            if not os.path.exists(path):
                broken += 1
                print(f"FAIL {rel}: link to {target} does not resolve")
    print(f"{'PASS' if checked and not broken else 'FAIL'} {checked} relative links checked, {broken} broken")
    print("FAILURES:", broken + (0 if checked else 1))
    return 1 if broken or not checked else 0


if __name__ == "__main__":
    sys.exit(main())
