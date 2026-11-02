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


# The kernel's process table through sysctl kern.proc, which Claude Code's sandbox reads where it refuses the setuid /bin/ps: one 648-byte kinfo_proc a process, its start time at 0, pid at 40, command (16 bytes) at 243 and process group at 564.
def kinfo(*mib):
    import ctypes, ctypes.util, sys
    if sys.platform != "darwin":
        return []
    libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    names = (ctypes.c_int * (len(mib) + 2))(1, 14, *mib)
    size = ctypes.c_size_t(0)
    if libc.sysctl(names, len(names), None, ctypes.byref(size), None, 0):
        return []
    buf = ctypes.create_string_buffer(size.value + 648 * 16)
    size = ctypes.c_size_t(len(buf))
    if libc.sysctl(names, len(names), buf, ctypes.byref(size), None, 0):
        return []
    return [buf.raw[i : i + 648] for i in range(0, size.value - size.value % 648, 648)]


def started(pid):
    """ps's lstart for pid as LC_ALL=C TZ=UTC prints it, words single-spaced, or None when no such process runs."""
    import struct, time
    procs = kinfo(1, int(pid))
    if not procs:
        return None
    return " ".join(time.strftime("%a %b %e %H:%M:%S %Y", time.gmtime(struct.unpack_from("q", procs[0], 0)[0])).split())


def group(pgid):
    """[(pid, command)] for each process in process group pgid."""
    import struct
    return [(struct.unpack_from("i", k, 40)[0], k[243:260].split(b"\0")[0].decode(errors="replace")) for k in kinfo(2, int(pgid))]


# python3 -I ptable.py started <pid>...: a `<pid> <lstart>` line for each one that runs; python3 -I ptable.py group <pgid>: a `<pid> <command>` line for each member
if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["started"]:
        for pid in sys.argv[2:]:
            start = started(pid)
            if start:
                print(pid, start)
    elif sys.argv[1:2] == ["group"] and len(sys.argv) == 3:
        for pid, command in group(sys.argv[2]):
            print(pid, command)
    else:
        sys.exit("usage: ptable.py started <pid>... | group <pgid>")
