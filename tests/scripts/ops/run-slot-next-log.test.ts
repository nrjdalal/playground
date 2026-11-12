import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { waits } from "../../../packages/scripts/src/playground/focus"
import { SCRIPT, machine, runSlot, stop } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

const logLines = (m: ReturnType<typeof machine>) =>
  existsSync(join(m.ops, "run-slot.runs.log"))
    ? readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
        .split("\n")
        .filter((l) => l !== "")
    : []

// issue 1477: nothing recorded run-slot.next's writes, so a window where head named a waiter the oldest's line passed over could not be read back
describe("the oldest waiter's run-slot.next write leaves one line in run-slot.runs.log", () => {
  test("the write logs <time> next <who> <pid> with the line it wrote, and the tail matches the file", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const w = m.start("worker-n")
    while (!existsSync(join(m.ops, "run-slot.next"))) await Bun.sleep(20)
    const next = readFileSync(join(m.ops, "run-slot.next"), "utf8").trim()
    expect(next).not.toBe("")
    // the log line lands a few ms behind the file write (rlog's date substitution), so poll for it rather than read once
    let logged: string[] = []
    for (let i = 0; i < 250 && logged.length === 0; i++) {
      await Bun.sleep(20)
      logged = logLines(m).filter((l) => l.split(" ")[1] === "next")
    }
    expect(logged).toHaveLength(1)
    const [time, event, who, pid, ...rest] = logged[0].split(" ")
    expect(time).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$/)
    expect(event).toBe("next")
    expect(who).toBe("worker-n")
    expect(pid).toBe(String(w.p.pid))
    expect(rest.join(" ")).toBe(next)
    await stop(w.p)
  })

  test("a run gated on --after reads its ask and end past a next line", async () => {
    const m = machine()
    const pid = 424242
    const at = "2026-11-08T00:00:00Z"
    writeFileSync(
      join(m.ops, "run-slot.runs.log"),
      [
        `${at} ask worker-a ${pid} echo hi`,
        `${at} next worker-b 424243 worker-a - -`,
        `${at} end worker-a ${pid} rc=0 ran=1s`,
        "",
      ].join("\n"),
    )
    const marker = join(m.root, "after-ran")
    const p = runSlot(["bash", SCRIPT, "worker-a", "--after", String(pid), "--", "touch", marker], {
      cwd: m.root,
      env: m.env(),
      stderr: "ignore",
      ops: m.ops,
    })
    await p.exited
    expect(existsSync(marker)).toBe(true)
  })

  test("focus's waits counts a log holding a next line as it counts the same log without one", () => {
    const at = "2026-11-08T00:00:00Z"
    const base = [
      `${at} ask worker-f 500 bun run test`,
      `2026-11-08T00:00:05Z start worker-f 500 run-slot waited=5s`,
      `2026-11-08T00:00:07Z end worker-f 500 rc=0 ran=2s`,
    ]
    const focus = { reason: "demo", session: "worker-x", since: at, until: "2026-11-08T01:00:00Z" }
    const end = new Date("2026-11-08T00:30:00Z")
    const withNext = waits(
      `${[base[0], `${at} next worker-b 424243 worker-f - -`, ...base.slice(1)].join("\n")}\n`,
      focus,
      end,
    )
    expect(withNext).toEqual(waits(`${base.join("\n")}\n`, focus, end))
    expect(withNext).toEqual({ runs: 1, seconds: 5 })
  })

  test("unstick's taken_since reads a start past a next line, and a log of next lines alone reads untaken", async () => {
    const ops = mkdtempSync(join(tmpdir(), "next-log-unstick-"))
    // within taken_since's one-hour window, which reads the clock, so a fixed stamp from a past hour never reads
    const at = `${new Date(Date.now() - 1_800_000).toISOString().slice(0, 19)}Z`
    const write = (lines: string[]) =>
      writeFileSync(join(ops, "run-slot.runs.log"), `${lines.join("\n")}\n`)
    const drive = async (): Promise<string> => {
      const proc = Bun.spawn(
        [
          "python3",
          "-I",
          "-c",
          [
            "import importlib.util, os, sys, time",
            'spec = importlib.util.spec_from_file_location("run", sys.argv[1])',
            "run = importlib.util.module_from_spec(spec)",
            "spec.loader.exec_module(run)",
            "run.OPS = sys.argv[2]",
            "print(run.taken_since(time.time() - 3600))",
          ].join("\n"),
          join(import.meta.dir, "../../../scripts/ops/unstick/run.py"),
          ops,
        ],
        {
          env: { TZ: "UTC", HOME: process.env.HOME, ...process.env },
          stderr: "pipe",
          stdout: "pipe",
        },
      )
      await proc.exited
      const err = await new Response(proc.stderr).text()
      if (err !== "") throw new Error(`the driver wrote to stderr: ${err}`)
      return (await new Response(proc.stdout).text()).trim()
    }
    write([`${at} next worker-b 424243 worker-a - -`])
    expect(await drive()).toBe("False")
    write([
      `${at} next worker-b 424243 worker-a - -`,
      `${at} start worker-a 424242 run-slot waited=0s`,
    ])
    expect(await drive()).toBe("True")
  })
})
