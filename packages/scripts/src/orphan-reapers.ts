// Who adopts an orphan of this process's children: pid 1, or on Linux the nearest subreaper above it (systemd --user under a desktop session), which is always one of this process's ancestors.
export const orphanReapers = (): Set<number> => {
  const reapers = new Set([1])
  for (let pid = process.ppid; pid > 1 && !reapers.has(pid);) {
    reapers.add(pid)
    pid = Number(
      Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(pid)])
        .stdout.toString()
        .trim(),
    )
  }
  return reapers
}
