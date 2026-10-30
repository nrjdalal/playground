#!/usr/bin/env python3
"""Tests for extensions/core/skills/setup/scripts/check.sh against stub commands.

Each case builds a PATH of stub tools and a fake HOME, runs the check, and reads its
lines. Case 01 must pass with everything present; the rest remove one need at a time.

Run: python3 tests/test_setup_check.py
"""
import os
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(ROOT, "extensions", "core", "skills", "setup", "scripts", "check.sh")
REAL_GIT = shutil.which("git")
STUBS = {
    "git": f'exec "{REAL_GIT}" "$@"',  # the link check needs real git; "no git" drops this stub
    "gh": 'exit "${GH_AUTH_EXIT:-0}"',
    "python3": "exit 0",
    "npx": "exit 0",
    "uv": "exit 0",
    "pnpm": "exit 0",
    # plugin list names the home set when the case has it, or once a --fix ran link-skills.sh
    "claude": 'case "$1" in plugin) [ -n "${HOME_SET:-}" ] || [ -f "$HOME/home-set" ] || exit 0; echo "ws-home@ws" ;; *) echo "${CLAUDE_VERSION:-2.1.289} (Claude Code)" ;; esac',
}
# Plain utilities the scripts use, linked one by one into the sandbox PATH, so a real git,
# gh, python3, npx, uv, claude or brew on the machine can never stand in for a missing stub.
UTILS = ["bash", "sh", "sort", "head", "awk", "readlink", "basename", "dirname", "find", "ln", "mkdir", "rm", "cat", "sed", "tr", "grep"]
fails = 0


def check(ok, name, detail=""):
    global fails
    fails += not ok
    print(("PASS" if ok else "FAIL"), name, "" if ok else detail)


def run(drop=(), env=None, home_set=True, fix=False, script=CHECK, gitconfig=None, settings=None, extensions=None):
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir, home = os.path.join(tmp, "bin"), os.path.join(tmp, "home")
        os.makedirs(bin_dir)
        for util in UTILS:
            if shutil.which(util):
                os.symlink(shutil.which(util), os.path.join(bin_dir, util))
        os.makedirs(os.path.join(home, ".claude", "skills"))
        # Each made-up extension's setup check, under the data folder: its scope name to its script's body.
        for scope, body in (extensions or {}).items():
            folder = os.path.join(home, ".playground", "extensions", scope, "scripts", "setup")
            os.makedirs(folder)
            with open(os.path.join(folder, "check.sh"), "w") as f:
                f.write(body)
        if settings is not None:
            with open(os.path.join(home, ".claude", "settings.json"), "w") as f:
                f.write(settings)
        for name, body in STUBS.items():
            if name in drop:
                continue
            p = os.path.join(bin_dir, name)
            with open(p, "w") as f:
                f.write(f"#!/bin/sh\n{body}\n")
            os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
        if gitconfig == "include":
            with open(os.path.join(home, ".gitconfig-gh"), "w") as f:
                f.write('[credential "https://github.com"]\n\thelper = !gh auth git-credential\n')
            with open(os.path.join(home, ".gitconfig"), "w") as f:
                f.write(f"[include]\n\tpath = {home}/.gitconfig-gh\n")
        elif gitconfig == "plain":
            with open(os.path.join(home, ".gitconfig"), "w") as f:
                f.write("[credential]\n\thelper = !gh auth git-credential\n")
        elif "git-helper" not in drop:
            with open(os.path.join(home, ".gitconfig"), "w") as f:
                f.write('[credential "https://github.com"]\n\thelper = !gh auth git-credential\n')
        out = subprocess.run(["bash", script] + (["--fix"] if fix else []), capture_output=True, text=True,
                             env={"PATH": bin_dir, "HOME": home, **({"HOME_SET": "1"} if home_set else {}), **(env or {})})
        return out.returncode, out.stdout


def fake_repo(tmp):
    """A checkout holding the check and a link-skills.sh that installs the home set, and a copy
    of the check outside it, as a session's skill set holds it."""
    repo, copy = os.path.join(tmp, "repo"), os.path.join(tmp, "set", "skills", "setup", "scripts")
    os.makedirs(os.path.join(repo, "extensions", "core", "skills", "setup", "scripts"))
    os.makedirs(os.path.join(repo, "scripts"))
    os.makedirs(copy)
    shutil.copy(CHECK, os.path.join(repo, "extensions", "core", "skills", "setup", "scripts", "check.sh"))
    shutil.copy(CHECK, os.path.join(copy, "check.sh"))
    with open(os.path.join(repo, "scripts", "link-skills.sh"), "w") as f:
        f.write(': > "$HOME/home-set"\n')
    return os.path.realpath(repo), os.path.join(copy, "check.sh")


def line(out, name):
    """The check's line whose name column (printf '%-8s %-22s %s') starts with name."""
    return next((l for l in out.splitlines() if l[9:31].strip().startswith(name)), "")


def main():
    rc, out = run()
    check(rc == 0 and "MISSING" not in out, "01 everything present: exit 0, nothing missing (canary)", out)
    rc, out = run(env={"GH_AUTH_EXIT": "1"})
    check(rc == 1 and "gh auth login" in line(out, "gh login"), "03 gh logged out: tells you to log in", out)
    rc, out = run(env={"CLAUDE_VERSION": "2.1.100"})
    check(rc == 1 and line(out, "claude").startswith("MISSING"), "04 an old Claude Code is missing a need", out)
    rc, out = run(drop=("uv",))
    check(rc == 1 and line(out, "uv").startswith("MISSING"), "05 no uv: missing (an app repo's gates need it)", out)
    rc, out = run(home_set=False)
    check(rc == 1 and line(out, "skills").startswith("MISSING") and "check.sh --fix" in line(out, "skills"), "06 no home skill set is missing a need, with check.sh --fix as the fix", out)
    rc, out = run()
    check(line(out, "code-review") == "", "07 core ships code-review, so no line asks for it", out)
    rc, out = run(env={"CLAUDE_VERSION": "2.1.99"})
    check(rc == 1 and line(out, "claude").startswith("MISSING"), "04b 2.1.99 is older than 2.1.224 (a version sort, not a text sort)", out)
    rc, out = run(env={"CLAUDE_VERSION": "2.1.220"})
    check(rc == 1 and line(out, "claude").startswith("MISSING"), "04c 2.1.220 is below the 2.1.224 minimum (messages between sessions)", out)
    with tempfile.TemporaryDirectory() as tmp:
        repo, copy = fake_repo(tmp)
        rc, out = run(home_set=False, fix=True, script=os.path.join(repo, "extensions", "core", "skills", "setup", "scripts", "check.sh"))
        check(rc == 0 and line(out, "skills").startswith("ok"), "08 --fix runs the checkout's link-skills.sh, which installs the home set", out)
        rc, out = run(home_set=False, fix=True, script=copy, env={"PLAYGROUND_REPO": repo})
        check(rc == 0 and line(out, "skills").startswith("ok"), "09 run from a copy outside the checkout, as a session's skill set holds it: finds the checkout spawn.sh exports", out)
    rc, out = run(gitconfig="include")
    check(line(out, "git uses gh login").startswith("ok"), "07k gh as git's helper through an [include] file counts", out)
    rc, out = run(gitconfig="plain")
    check(line(out, "git uses gh login").startswith("ok"), "07l gh as a plain credential.helper counts", out)
    rc, out = run(drop=("git-helper",))
    check(rc == 1 and "gh auth setup-git" in line(out, "git uses gh login"), "07g git without gh's credential helper is missing a need", out)
    bypass = '{\n  "permissions": { "defaultMode": "bypassPermissions" },\n  "skipDangerousModePermissionPrompt": true\n}\n'
    rc, out = run(settings=bypass)
    check(rc == 0 and line(out, "bypass mode").startswith("ok"), "07q factory sessions in bypass: both settings keys present", out)
    rc, out = run(settings='{ "permissions": { "defaultMode": "auto" } }')
    check(rc == 0 and line(out, "bypass mode").startswith("optional") and '"defaultMode": "bypassPermissions"' in line(out, "bypass mode") and "skipDangerousModePermissionPrompt" in line(out, "bypass mode"),
          "07r another default mode: optional, the fix naming both keys", out)
    rc, out = run(settings='{ "permissions": { "defaultMode": "bypassPermissions" } }')
    check(line(out, "bypass mode").startswith("optional"), "07s bypass with its prompt still on: optional (a session would stop on the prompt)", out)
    rc, out = run()
    check(rc == 0 and line(out, "bypass mode").startswith("optional"), "07t no settings file: optional, exit 0", out)
    acme = {"acme": 'echo "ok       acme-tool              ${1:-check}"\n', "core": "echo core-ran; exit 1\n"}
    rc, out = run(extensions=acme, fix=True)
    check(rc == 0 and line(out, "acme-tool").endswith("--fix") and "core-ran" not in out, "10 each extension's own setup check runs last with the same --fix, and core's folder is not run as one", out)
    rc, out = run(extensions={"acme": 'echo "MISSING  acme-tool"; exit 1\n'})
    check(rc == 1 and line(out, "acme-tool").startswith("MISSING"), "11 an extension's missing need fails the check", out)
    rc, out = run(extensions={"acme": 'echo "mcp      acme-db mcp__acme__query, mcp__acme__list"\n'})
    skill = open(os.path.join(os.path.dirname(CHECK), "..", "SKILL.md")).read()
    check(rc == 0 and "mcp      acme-db mcp__acme__query, mcp__acme__list" in out and "`mcp <label> <tool>, <tool>...`" in skill,
          "12 an extension's mcp line reaches the skill, which loads each tool it names, and leaves the exit code alone", out)
    with tempfile.TemporaryDirectory() as tmp:
        repo, _ = fake_repo(tmp)
        rc, out = run(extensions={"acme": 'echo "ok       acme-repo              ${PLAYGROUND_REPO:-none}"\n'},
                      script=os.path.join(repo, "extensions", "core", "skills", "setup", "scripts", "check.sh"))
    check(line(out, "acme-repo").endswith(repo), "13 an extension's check gets the checkout core found as PLAYGROUND_REPO", out)
    print("FAILURES:", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
