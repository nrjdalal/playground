import { expect, test } from "bun:test"

import { orphanReapers } from "../../../../packages/scripts/src/orphan-reapers"

// #2350: on Linux under systemd --user an orphan goes to that subreaper, not pid 1, so endChildren's orphan guard read every one as another's and left the fixture's loop running.
test("an orphan of this run is adopted by one of orphanReapers()", async () => {
  const p = Bun.spawn(["bash", "-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { stdout: "pipe" })
  const orphan = Number((await new Response(p.stdout).text()).trim())
  await p.exited
  try {
    const ppid = Number(
      Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(orphan)])
        .stdout.toString()
        .trim(),
    )
    expect(orphanReapers().has(ppid)).toBe(true)
  } finally {
    process.kill(orphan, "SIGKILL")
  }
})
