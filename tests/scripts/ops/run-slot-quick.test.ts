import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, stop, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang: 60s, twice the slowest case under SLOW_CHILD=1.5 but local CI's, which sets its own
setDefaultTimeout(60_000)

// review round 1: a big run let every smaller run pass it, so it could wait all night
describe("a waiter that has waited 20 minutes", () => {
  const held = () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 1, "small")
    return m
  }

  test("lets no newer run pass it", async () => {
    const m = held()
    m.ticket(1, "worker-big", "s2 23 3 big", 21 * 60)
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("while one that has waited less lets a run that fits go", async () => {
    const m = held()
    m.ticket(1, "worker-big", "s2 23 3 big", 19 * 60)
    expect(await m.runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })
})

// dispatcher, 18 Oct: a waiter started before a run-slot change kept the old copy's rules
describe("a waiter whose script is replaced", () => {
  test("runs the new copy with its own arguments and leaves its ticket", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    const copy = join(m.root, "run-slot.sh")
    copyFileSync(SCRIPT, copy)
    const waiter = m.start("worker-m", { RUN_SLOT_SIZE: "medium" }, copy)
    while (!m.tickets().some((t) => t.endsWith("-worker-m"))) await Bun.sleep(50)
    const out = join(m.root, "reexec")
    writeFileSync(`${copy}.new`, `#!/bin/bash\nprintf '%s\\n' "$@" > ${out}\n`)
    renameSync(`${copy}.new`, copy)
    expect(await waiter.p.exited).toBe(0)
    expect(readFileSync(out, "utf8")).toBe(`worker-m\n--\ntouch\n${waiter.marker}\n`)
    expect(m.tickets()).toEqual([])
  })

  // review round 4: the new copy takes the first ask's time, so the runs log has one ask and the whole wait
  test("its wait is logged as one ask", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    const copy = join(m.root, "run-slot.sh")
    copyFileSync(SCRIPT, copy)
    const waiter = m.start("worker-m", { RUN_SLOT_SIZE: "medium" }, copy)
    while (!m.tickets().some((t) => t.endsWith("-worker-m"))) await Bun.sleep(50)
    copyFileSync(SCRIPT, `${copy}.new`)
    renameSync(`${copy}.new`, copy)
    // the log's waited= counts whole seconds, so the wait lasts at least one
    await Promise.all([waiter.saw(/running the new copy/g), Bun.sleep(1_000)])
    m.release("run-slot")
    expect(await waiter.ran()).toBe(true)
    const log = readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
    expect(log.match(/ ask worker-m /g)).toHaveLength(1)
    expect(log).toMatch(/ start worker-m \d+ run-slot(-\d)? waited=[1-9]\d*s\n/)
  })
})

// builder, 18 Oct (a review): a clone named without a folder before node_modules missed clone-off, which passes at load1 and load5 under 30 and spawn.sh's memory gate
describe("a node_modules clone waits while clone-off stands", () => {
  const off = ["run-slot.clone-off"]
  for (const from of ["x/node_modules", "node_modules", "node_modules/", "./node_modules"])
    test(from, async () => {
      expect(await machine({ off, pressure: 4 }).clones(from)).toBe(false)
    })

  test("and the machine is loaded", async () => {
    expect(await machine({ load1: 30, off }).clones("node_modules")).toBe(false)
  })

  // optimizer, 19 Oct 03:42Z: a clone let through at load5 under 30 took load1 to 73
  test("and load1 is 30 while load5 is under it", async () => {
    expect(await machine({ load1: 30, load5: 2, off }).clones("node_modules")).toBe(false)
  })

  test("behind env and VAR=x words", async () => {
    expect(
      await machine({ off, pressure: 4 }).clones("node_modules", "worker-c", ["env", "X=1"]),
    ).toBe(false)
  })

  test("but goes on normal pressure and load1 and load5 under 30", async () => {
    expect(await machine({ load1: 29, off }).clones("node_modules")).toBe(true)
  })

  test("and on warn pressure with 8% free", async () => {
    expect(await machine({ free: 8, off, pressure: 2 }).clones("node_modules")).toBe(true)
  })

  test("but holds on warn pressure with 7% free", async () => {
    expect(await machine({ free: 7, off, pressure: 2 }).clones("node_modules")).toBe(false)
  })

  test("and runs once it is gone", async () => {
    expect(await machine().clones("node_modules")).toBe(true)
  })

  test("but for a session clone-allow's patterns name", async () => {
    const m = machine({ off, pressure: 4 })
    writeFileSync(join(m.ops, "run-slot.clone-allow"), "tester-.*\n")
    expect(await m.clones("node_modules", "tester-sloth")).toBe(true)
    expect(await m.clones("node_modules", "worker-c")).toBe(false)
  })
})

// A fake git and bun on PATH touch their last argument, so a run through run-slot shows whether it ran while a big run holds the queue's units.
describe("a quick run takes its own slot past a full queue", () => {
  // Runs argv through run-slot past a full queue and says whether it ran: once it ends, or once it prints the queue's waiting line, when it is stopped (an event, never a clock, so a loaded runner only makes it slower)
  // ran: the seconds each earlier run of the same command took, oldest first, as run-slot.runs.log records them
  // the slot the last quick() run took, from its runs log's start line
  let took = ""
  const quick = async (argv: string[], ran: number[] = []) => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    for (const bin of ["bun", "git"]) {
      writeFileSync(join(m.bin, bin), '#!/bin/bash\ntouch "${@: -1}"\n')
      chmodSync(join(m.bin, bin), 0o755)
    }
    const marker = join(m.root, "a.test.ts")
    writeFileSync(
      join(m.ops, "run-slot.runs.log"),
      ran
        .map(
          (s, i) =>
            `2026-10-31T10:00:0${i}Z ask worker-q ${900 + i} ${[...argv, marker].join(" ")}\n2026-10-31T10:00:0${i}Z ask worker-r ${800 + i} bun run lint\n2026-10-31T10:01:0${i}Z end worker-r ${800 + i} rc=0 ran=1s\n2026-10-31T10:01:0${i}Z end worker-q ${900 + i} rc=0 ran=${s}s\n`,
        )
        .join(""),
    )
    const p = Bun.spawn(["bash", SCRIPT, "worker-q", "--", ...argv, marker], {
      cwd: m.root,
      env: m.env({ RUN_SLOT_SIZE: "medium" }),
      stderr: "pipe",
    })
    let err = ""
    let ended = false
    void p.exited.then(() => (ended = true))
    void (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    while (!ended && !err.match(WAITING)) await Bun.sleep(20)
    if (!ended) await stop(p)
    took =
      readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
        .split("\n")
        .find((l) => l.split(" ")[1] === "start" && l.split(" ")[2] === "worker-q")
        ?.split(" ")[4] ?? ""
    return existsSync(marker)
  }

  // optimizer, 19 Oct: a commit run as env NODE_ENV=... git commit waited 14 min in the queue
  test("git commit", async () => {
    expect(await quick(["git", "commit"])).toBe(true)
  })

  test("env NODE_ENV=x git commit", async () => {
    expect(await quick(["env", "NODE_ENV=x", "git", "commit"])).toBe(true)
  })

  // optimizer, 20 Oct: a 1s git merge waited 26.6 min behind suites
  test("git merge", async () => {
    expect(await quick(["git", "-C", "x", "merge"])).toBe(true)
  })

  test("git pull", async () => {
    expect(await quick(["git", "pull"])).toBe(true)
  })

  // run-slot.runs.log, 20 Oct: docs:wrap and format:check ran 2s and 9s at most
  test("bun run docs:wrap", async () => {
    expect(await quick(["bun", "run", "docs:wrap"])).toBe(true)
  })

  test("bun run --cwd=<dir> format:check", async () => {
    expect(await quick(["bun", "run", "--cwd=x", "format:check"])).toBe(true)
  })

  test("but not another bun run script", async () => {
    expect(await quick(["bun", "run", "build"])).toBe(false)
  })

  // retro 2, 31 Oct: 408 of 686 CPU-lane runs ended in 10 s or less and queued 2,004 min against 17 min of running
  // a plain install also runs past this queue now, as a light run in run-slot-2, so the slot it took is the check
  test("bun install --ignore-scripts", async () => {
    expect(await quick(["bun", "install", "--ignore-scripts"])).toBe(true)
    expect(took).toBe("run-slot-quick")
  })

  // a light run of 1 unit, it fits the slot the big holder leaves, but through the queue
  test("but a bun install that runs its scripts takes a queue slot", async () => {
    await quick(["bun", "install"])
    expect(took).toBe("run-slot-2")
  })

  test("git push", async () => {
    expect(await quick(["git", "-C", "x", "push", "-u", "origin"])).toBe(true)
    expect(took).toBe("run-slot-commit")
  })

  test("a command whose last 3 runs each ended in 10 s or less", async () => {
    expect(await quick(["bun", "run", "build"], [400, 2, 10, 3])).toBe(true)
    expect(took).toBe("run-slot-quick")
  })

  test("but not one with 2 runs on record", async () => {
    expect(await quick(["bun", "run", "build"], [2, 3])).toBe(false)
  })

  // the bound on a long run after short ones: it holds the one quick slot, and its own time sends the next run of its command back to the queue
  test("nor one whose last run took over 10 s", async () => {
    expect(await quick(["bun", "run", "build"], [2, 3, 4, 11])).toBe(false)
  })

  // ops, 20 Oct: with slot-off, a 5-file run that ran 1s waited 52 min behind suites
  test("bun test naming one test file", async () => {
    expect(await quick(["env", "X=1", "bun", "test"])).toBe(true)
  })

  test("bun --cwd=<dir> test naming three test files", async () => {
    expect(await quick(["bun", "--cwd=x", "test", "b.test.ts", "c.test.tsx"])).toBe(true)
  })

  test("but not a bun test naming four", async () => {
    expect(await quick(["bun", "test", "b.test.ts", "c.test.ts", "d.test.ts"])).toBe(false)
  })

  test("nor an end-to-end test", async () => {
    expect(await quick(["bun", "test", "b.e2e.test.ts"])).toBe(false)
  })

  test("nor a bun test with a word that is no test file", async () => {
    expect(await quick(["bun", "test", "-t", "name"])).toBe(false)
  })

  test("bun run test:file naming one test file", async () => {
    expect(await quick(["bun", "run", "test:file"])).toBe(true)
  })

  test("but not bun run test naming one", async () => {
    expect(await quick(["bun", "run", "test"])).toBe(false)
  })

  // --cwd=<p> took the quick slot only by accident (the VAR=x skip ate it), while --cwd <p> read the path as a word that is no test file
  test("bun run --cwd=<dir> test:file naming one test file", async () => {
    expect(await quick(["bun", "run", "--cwd=x", "test:file"])).toBe(true)
  })

  test("bun test --cwd <dir> naming two test files", async () => {
    expect(await quick(["bun", "test", "--cwd", "x", "b.test.ts"])).toBe(true)
  })

  test("bun run --cwd <dir> test:file naming one test file", async () => {
    expect(await quick(["bun", "run", "--cwd", "x", "test:file"])).toBe(true)
  })

  test("bun --cwd=<dir> run test:file naming one test file", async () => {
    expect(await quick(["bun", "--cwd=x", "run", "test:file"])).toBe(true)
  })

  // a bare --cwd before the subcommand stays off the quick slot: bun misreads that shape and runs package.json's script instead (no-false-green)
  test("but not a bun --cwd <dir> test, which bun runs as package.json's test script", async () => {
    expect(await quick(["bun", "--cwd", "x", "test", "b.test.ts"])).toBe(false)
  })

  test("nor a bun --cwd <dir> run", async () => {
    expect(await quick(["bun", "--cwd", "x", "run", "test:file"])).toBe(false)
  })

  test("but not a bun test --cwd <dir> naming four", async () => {
    expect(await quick(["bun", "test", "--cwd", "x", "b.test.ts", "c.test.ts", "d.test.ts"])).toBe(
      false,
    )
  })

  test("nor a bun test --cwd <dir> end-to-end test", async () => {
    expect(await quick(["bun", "test", "--cwd", "x", "b.e2e.test.ts"])).toBe(false)
  })
})
