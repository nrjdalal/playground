import { afterAll } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Subprocess } from "bun"

import { slowChild } from "../../slow-child"

// run-slot.sh's fakes and the scratch machine for the run-slot*.test.ts files, split so the parallel pass spreads them; test-sandbox's --parallel loads this afresh for each file, so the afterAll is that file's own
// Load is weighed by size, so a big plan never blocks small runs: small, medium and big weigh 1, 2 and 3.
export const SCRIPT = join(import.meta.dir, "../../../scripts/ops/run-slot.sh")
// run-slot.sh's line for a look that takes no slot
export const WAITING = /^run-slot\.sh: (queued behind|waiting for) /gm
// Stops a run whose verdict is already read: SIGTERM, then SIGKILL after 5s, since a waiter on GitHub's Linux runner outlived its SIGTERM by 24s for a cause not yet known and timed the test out
export const stop = async (p: Subprocess) => {
  p.kill("SIGTERM")
  if (await Promise.race([p.exited.then(() => true), Bun.sleep(5_000).then(() => false)])) return
  p.kill("SIGKILL")
  await p.exited
}

export const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

export type Setup = {
  free?: number
  load1?: number
  load5?: number
  mergeQueue?: unknown
  off?: string[]
  peers?: string[]
  plan?: unknown
  pressure?: number
  roster?: unknown
}

// A scratch state folder and config folder, with a fake sysctl on PATH giving 15 cores, the load asked for (load5 and load15 as load1 unless given) and normal memory.
export const machine = ({
  free = 80,
  load1 = 2,
  load5 = load1,
  mergeQueue,
  off = [],
  peers = [],
  plan,
  pressure = 1,
  roster,
}: Setup = {}) => {
  const root = mkdtempSync(join(tmpdir(), "run-slot-"))
  dirs.push(root)
  const ops = join(root, "ops")
  const config = join(root, "claude")
  const bin = join(root, "bin")
  for (const dir of [ops, join(config, "playground", "bundles"), bin])
    mkdirSync(dir, { recursive: true })
  for (const name of off) writeFileSync(join(ops, name), "")
  if (roster) writeFileSync(join(config, "playground", "roster.json"), JSON.stringify(roster))
  if (plan) writeFileSync(join(config, "playground", "bundles", "plan.json"), JSON.stringify(plan))
  if (mergeQueue)
    writeFileSync(join(config, "playground", "merge-queue.json"), JSON.stringify(mergeQueue))
  writeFileSync(
    join(bin, "sysctl"),
    `#!/bin/bash
echo "$2" >> ${join(root, "sysctl.log")}
case "$2" in
  hw.ncpu) echo 15 ;;
  vm.loadavg) echo "{ ${load1}.00 ${load5}.00 ${load5}.00 }" ;;
  kern.memorystatus_level) echo ${free} ;;
  kern.memorystatus_vm_pressure_level) echo ${pressure} ;;
esac
`,
  )
  chmodSync(join(bin, "sysctl"), 0o755)
  // the settings reader answers factory.repo, the guarded orgs and slots.peers as a store that sets them would, and every other key as the real one does
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/bash\n[ "$2" = factory.repo ] && { echo '"acme/app"'; exit 0; }\n[ "$2" = --guarded-orgs ] && { echo '["acme-co"]'; exit 0; }\n[ "$2" = slots.peers ] && { echo '${JSON.stringify(peers)}'; exit 0; }\nexec ${process.execPath} "$@"\n`,
  )
  chmodSync(join(bin, "bun"), 0o755)
  // SLOW_CHILD puts a slowed python3 in the fake bin folder, which PATH reads first
  slowChild("python3", bin)
  const env = (extra: Record<string, string> = {}) => ({
    CLAUDE_CONFIG_DIR: config,
    PLAYGROUND_DATA_DIR: join(config, "playground"),
    HOME: root,
    PATH: `${bin}:${process.env.PATH}`,
    RUN_SLOT_OPS: ops,
    RUN_SLOT_POLL: "0.2",
    ...extra,
  })
  // A slot already held by this test's own process, which stays alive throughout.
  const hold = (slot: string, units: number, size: string) => {
    mkdirSync(join(ops, slot))
    writeFileSync(
      join(ops, `${slot}.holder`),
      `worker-held ${process.pid} 2026-10-18T19:00:00Z ${units} ${size}\n`,
    )
  }
  const release = (slot: string) => {
    rmSync(join(ops, slot), { force: true, recursive: true })
    rmSync(join(ops, `${slot}.holder`), { force: true })
  }
  // A waiter's ticket from a live process (this test's), as run-slot.sh writes one, its mtime `ago` seconds back.
  const ticket = (ns: number, who: string, line: string, ago = 0) => {
    mkdirSync(join(ops, "run-slot.waiters"), { recursive: true })
    const path = join(ops, "run-slot.waiters", `${ns}-${process.pid}-${who}`)
    writeFileSync(path, `${line}\n`)
    const at = Date.now() / 1000 - ago
    utimesSync(path, at, at)
  }
  const tickets = () =>
    existsSync(join(ops, "run-slot.waiters")) ? readdirSync(join(ops, "run-slot.waiters")) : []
  // Starts `touch <marker>` through run-slot (or the copy at `script`) in the background, reading its stderr as it comes. Each check waits on an event (the run's exit, a line it prints), never a wall-clock budget, so a loaded runner only makes it slower.
  // command: the words before the marker, which a fake bin in the machine's bin folder touches; touch by default
  const start = (
    who: string,
    extra: Record<string, string> = {},
    script = SCRIPT,
    command = ["touch"],
  ) => {
    const marker = join(root, `ran-${who}-${Math.random()}`)
    const p = Bun.spawn(["bash", script, who, "--", ...command, marker], {
      cwd: root,
      env: env(extra),
      stderr: "pipe",
    })
    let err = ""
    let ended = false
    void p.exited.then(() => (ended = true))
    const read = (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    const lines = (re: RegExp) => err.match(re)?.length ?? 0
    // whether `n` lines matching `re` arrived before it ended; `re` takes the g flag, since match without it returns one match's groups
    const saw = async (re: RegExp, n = 1) => {
      while (!ended && lines(re) < n) await Bun.sleep(20)
      if (ended) await read
      return lines(re) >= n
    }
    // whether it ran, read once it has ended
    const ran = async () => {
      await p.exited
      return existsSync(marker)
    }
    // whether it printed a waiting line, as a look that takes no slot does, and kept waiting through its first three looks without running; it is stopped then, and it needs a waiter that left a ticket, as every worker-* and ops-checks-* one does
    const waits = async () => {
      let waiting = await saw(WAITING)
      // a look removes at most one dead ticket in each of its two queue reads before it decides, so the fifth goes no earlier than the fourth look, after three looks decided to wait
      for (let i = 0; i < 5 && waiting; i++) waiting = await lookedAgain()
      waiting &&= !existsSync(marker)
      await stop(p)
      return waiting
    }
    // Puts a dead waiter's ticket in the queue and says whether this waiter, as the one live waiter left, removed it in a look and is still waiting; false at once if it ends first, and a ticket that never goes (a run-slot.priority pick skips the queue reads) fails by the timeout, never as a pass
    const lookedAgain = async () => {
      const gone = Bun.spawn(["true"])
      await gone.exited
      const path = join(ops, "run-slot.waiters", `1-${gone.pid}-worker-gone`)
      writeFileSync(path, "s2 21 1 small\n")
      while (!ended && existsSync(path)) await Bun.sleep(20)
      return !ended && !existsSync(marker)
    }
    return { marker, p, ran, saw, waits }
  }
  const canTake = async (slot: string, who: string, extra: Record<string, string> = {}) => {
    const p = Bun.spawn(["bash", SCRIPT, "can-take", slot, who], { cwd: root, env: env(extra) })
    return (await p.exited) === 0
  }
  const size = async (who: string, extra: Record<string, string> = {}, cwd = root) => {
    const p = Bun.spawn(["bash", SCRIPT, "size", who], {
      cwd,
      env: env(extra),
      stdout: "pipe",
    })
    await p.exited
    return (await new Response(p.stdout).text()).trim()
  }
  // Runs `touch <marker>` through run-slot and reports whether it ran, or whether it waited on its first look
  const runs = (who: string, extra: Record<string, string> = {}) => start(who, extra).ran()
  const waits = (who: string, extra: Record<string, string> = {}) => start(who, extra).waits()
  // the times run-slot.sh has read the memory pressure level, which clone-off's gate reads once a check
  const pressureReads = () =>
    existsSync(join(root, "sysctl.log"))
      ? readFileSync(join(root, "sysctl.log"), "utf8")
          .split("\n")
          .filter((l) => l === "kern.memorystatus_vm_pressure_level").length
      : 0
  // Clones the folder named by `from` (relative to the scratch root) through run-slot and reports whether the copy landed (cp -R, since -c is the Mac's alone and the clone slot reads only cp and the path): once it ends, or once clone-off's gate has held it, since a clone it lets through reads the pressure level twice and goes on, and one it holds reads it again each RUN_SLOT_POLL.
  const clones = async (from: string, who = "worker-c", prefix: string[] = []) => {
    mkdirSync(join(root, "x", "node_modules"), { recursive: true })
    const to = `copy-${Math.random()}`
    const before = pressureReads()
    const p = Bun.spawn(["bash", SCRIPT, who, "--", ...prefix, "cp", "-R", from, to], {
      cwd: from.startsWith("node_modules") ? join(root, "x") : root,
      env: env(),
      stderr: "ignore",
    })
    let ended = false
    void p.exited.then(() => (ended = true))
    while (!ended && pressureReads() - before < 3) await Bun.sleep(20)
    if (!ended) await stop(p)
    return existsSync(join(from.startsWith("node_modules") ? join(root, "x") : root, to))
  }
  return {
    bin,
    canTake,
    clones,
    env,
    hold,
    ops,
    release,
    root,
    runs,
    size,
    start,
    ticket,
    tickets,
    waits,
  }
}
