#!/usr/bin/env python3
"""once.py <job> <command...>: start an ops job only when no copy of it is running, then become it (exec, so the pid stays).

A copy is running when the pid in ops/<job>.pid, or the pid in its heartbeat ops/<job>.json, is alive and its command line
still holds this job's folder (ops/<name>/, which survives a wrapper's exec and a copy run from another checkout). A held
copy prints "already running" and exits 0, so ops-up never stacks a second supervisor on a live one (two ops-fixture loops
kept a stack up after their panes closed). The check and the pid write run under a flock, so two starts at once cannot
both pass. Signals nothing: it only reads pids and execs.
"""
import fcntl, json, os, shlex, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from beat import ops_dir

OPS = ops_dir()


def command_of(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return None
    except PermissionError:
        pass
    return subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True).stdout.strip() or None


def marker_of(script):
    # the folder's last two names (ops/<name>/), so a copy of the job run from another checkout, as ops-dashboard's exec runs, still reads as this job
    folder = os.path.dirname(script)
    return "/" + "/".join(folder.split("/")[-2:]) + "/" if folder.count("/") >= 2 else folder + "/"


def running(job, marker):
    pids = []
    try:
        pids.append(int(open(os.path.join(OPS, f"{job}.pid")).read().strip()))
    except (OSError, ValueError):
        pass
    try:
        pids.append(int(json.load(open(os.path.join(OPS, f"{job}.json")))["pid"]))
    except (OSError, ValueError, KeyError, TypeError):
        pass
    for pid in pids:
        if pid > 1 and pid != os.getpid():
            cmd = command_of(pid)
            if cmd and marker in cmd:
                return pid
    return None


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: once.py <job> <command...>")
    job = sys.argv[1]
    argv = [os.path.expanduser(a) for a in (shlex.split(sys.argv[2]) if len(sys.argv) == 3 else sys.argv[2:])]
    script = next((a for a in argv if "/" in a and os.path.isfile(a) and not a.endswith(("/python3", "/bash", "/env"))), argv[0])
    marker = marker_of(script)
    with open(os.path.join(OPS, f"{job}.start.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        holder = running(job, marker)
        for _ in range(15):
            # ops-up closes an unhealthy copy's pane just before this start: give that copy a moment to exit
            if not holder:
                break
            __import__("time").sleep(1)
            holder = running(job, marker)
        if holder:
            print(f"{job} already running (pid {holder}); not starting another")
            return
        with open(os.path.join(OPS, f"{job}.pid"), "w") as f:
            f.write(f"{os.getpid()}\n")
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    main()
