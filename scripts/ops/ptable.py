"""The process table, read once with ps, and where a process sits under the cmux app. Reads only; signals nothing.

A process is under cmux when one of its ancestors runs the cmux app's own executable (CMUX_APP, by its exact path, never a name or a
pattern: the `cmux` CLI is another binary). A job orphaned by a cmux restart has been reparented to launchd, so its chain ends at pid 1.
"""
import subprocess

CMUX_APP = "/Applications/cmux.app/Contents/MacOS/cmux"


def table():
    """{pid: (ppid, executable)} for every process, or {} when ps cannot be read."""
    try:
        out = subprocess.run(["ps", "-axo", "pid=,ppid=,comm="], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return {}
    procs = {}
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            procs[int(parts[0])] = (int(parts[1]), parts[2].strip())
    return procs


def above(pid, procs, exes):
    """The pid of the nearest process at or above pid whose executable is one of exes, or None when its chain reaches launchd or leaves the table."""
    seen = set()
    while pid and pid > 1 and pid in procs and pid not in seen:
        seen.add(pid)
        ppid, exe = procs[pid]
        if exe in exes:
            return pid
        pid = ppid
    return None


def cmux_of(pid, procs):
    """The pid of the cmux app above pid (pid itself included), or None when its chain reaches launchd or leaves the table."""
    return above(pid, procs, {CMUX_APP})
