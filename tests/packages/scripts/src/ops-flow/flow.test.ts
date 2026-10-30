import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cycle,
  gateProcess,
  holderOf,
  lastGateLine,
  readyLine,
  type Proc,
} from "../../../../../packages/scripts/src/ops-flow/flow"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A scratch CLAUDE_CONFIG_DIR with a ready line, the two gate logs and, when given, one run-slot holder.
const scratch = (options: { checks?: string[]; entries: unknown[]; holder?: string }): string => {
  const dir = mkdtempSync(join(tmpdir(), "ops-flow-"))
  dirs.push(dir)
  const ops = join(dir, "playground", "ops")
  mkdirSync(join(ops, "localci"), { recursive: true })
  mkdirSync(join(ops, "checks"), { recursive: true })
  writeFileSync(
    join(dir, "playground", "merge-queue.json"),
    JSON.stringify({ queue: options.entries }),
  )
  writeFileSync(join(ops, "localci", "localci.log"), "2026-10-19T00:00:00Z #1112: run at 995193d\n")
  writeFileSync(join(ops, "checks", "checks.log"), `${(options.checks ?? []).join("\n")}\n`)
  if (options.holder) {
    mkdirSync(join(ops, "run-slot"))
    writeFileSync(join(ops, "run-slot.holder"), `${options.holder}\n`)
  }
  return dir
}

const whoOf = async (kind: string) => ({ builder: "lead-builder", ops: "lead-ops" })[kind]!
const outbox = async (dir: string): Promise<{ text: string; to: string }[]> =>
  (
    await readFile(join(dir, "playground", "ops", "outbox", "ops-flow.jsonl"), "utf8").catch(
      () => "",
    )
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { text: string; to: string })

const at = (iso: string) => new Date(iso)
const READY = {
  goAt: "2026-10-19T00:13:00Z",
  nextGate: "Checks",
  pr: 1133,
  readyAt: "2026-10-19T00:08:14Z",
}

describe("ops-flow", () => {
  test("a ready-line PR with no gate moving for 10 minutes alerts each lead once", async () => {
    const dir = scratch({
      checks: ["2026-10-19T00:46:22Z #1133 @ 688a372: fail (test)"],
      entries: [READY],
    })
    const run = (now: string) =>
      cycle({ data: join(dir, "playground"), now: at(now), procs: [], whoOf })
    expect((await run("2026-10-19T00:55:00Z")).alerted).toBe(0)
    expect(await run("2026-10-19T00:57:00Z")).toEqual({ alerted: 2, result: "ok" })
    expect(await run("2026-10-19T00:58:00Z")).toEqual({ alerted: 0, result: "ok" })
    const lines = await outbox(dir)
    expect(lines.map((line) => line.to)).toEqual(["lead-builder", "lead-ops"])
    expect(lines[0]!.text).toBe(
      "#1133 is in the ready line with no local CI or Checks moving for 10 min (since 00:46Z). Next gate: Checks.",
    )
    const log = await readFile(join(dir, "playground", "ops", "alerts.log"), "utf8")
    expect(log).toContain("[ops-flow → lead-ops] #1133 is in the ready line")
  })

  test("a stall that clears on a gate process and comes back alerts again", async () => {
    const dir = scratch({ entries: [READY] })
    const checks: Proc[] = [{ command: "python3 -I /x/ops/checks/parallel.py 1133", pid: 7 }]
    const run = (now: string, procs: Proc[] = []) =>
      cycle({ data: join(dir, "playground"), now: at(now), procs, whoOf })
    expect((await run("2026-10-19T00:30:00Z")).alerted).toBe(2)
    expect((await run("2026-10-19T00:31:00Z", checks)).alerted).toBe(0)
    expect((await run("2026-10-19T00:40:00Z")).alerted).toBe(0)
    expect((await run("2026-10-19T00:41:00Z")).alerted).toBe(2)
    expect((await outbox(dir)).at(-1)!.text).toContain("for 10 min (since 00:31Z)")
  })

  test("a PR left out of the open set, or waiting on a review, raises nothing", async () => {
    const review = {
      nextGate: "re-gate review at b659a29, then local CI",
      pr: 1092,
      readyAt: "2026-10-18T23:59:12Z",
    }
    const dir = scratch({ entries: [READY, review] })
    const now = at("2026-10-19T02:00:00Z")
    expect(
      (await cycle({ data: join(dir, "playground"), now, open: new Set([1092]), procs: [], whoOf }))
        .alerted,
    ).toBe(0)
  })

  test("a run-slot holder over 15 minutes alerts once, naming it, its command and its age", async () => {
    const dir = scratch({ entries: [], holder: "tester-deft-heron 18013 2026-10-19T00:33:00Z" })
    const procs: Proc[] = [
      { command: "/bin/bash run-slot.sh tester-deft-heron -- bun run dev", pid: 18013 },
    ]
    const run = (now: string) =>
      cycle({ data: join(dir, "playground"), now: at(now), procs, whoOf })
    expect((await run("2026-10-19T00:47:00Z")).alerted).toBe(0)
    expect((await run("2026-10-19T00:51:30Z")).alerted).toBe(2)
    expect((await run("2026-10-19T00:52:30Z")).alerted).toBe(0)
    expect((await outbox(dir))[0]!.text).toBe(
      "tester-deft-heron has held run-slot for 18 min (since 00:33Z, pid 18013): /bin/bash run-slot.sh tester-deft-heron -- bun run dev",
    )
  })

  test("a holder under 15 minutes, or one whose pid is gone, raises nothing", async () => {
    const dir = scratch({ entries: [], holder: "ops-checks-1133 4933 2026-10-19T00:52:53Z" })
    const procs: Proc[] = [{ command: "bash run-slot.sh ops-checks-1133 -- python3", pid: 4933 }]
    expect(
      (
        await cycle({
          data: join(dir, "playground"),
          now: at("2026-10-19T01:07:00Z"),
          procs,
          whoOf,
        })
      ).alerted,
    ).toBe(0)
    expect(
      (
        await cycle({
          data: join(dir, "playground"),
          now: at("2026-10-19T02:00:00Z"),
          procs: [],
          whoOf,
        })
      ).alerted,
    ).toBe(0)
  })

  test("a model-bound holder is judged by its own limit, 2 hours, not 15 minutes", async () => {
    const dir = scratch({ entries: [] })
    const ops = join(dir, "playground", "ops")
    mkdirSync(join(ops, "run-slot-model-3"))
    writeFileSync(
      join(ops, "run-slot-model-3.holder"),
      "worker-made-up 18014 2026-10-19T00:33:00Z 0 model\n",
    )
    const procs: Proc[] = [
      {
        command: "bash run-slot.sh worker-made-up --model-bound -- bun run parity replay",
        pid: 18014,
      },
    ]
    const run = (now: string) =>
      cycle({ data: join(dir, "playground"), now: at(now), procs, whoOf })
    expect((await run("2026-10-19T01:33:00Z")).alerted).toBe(0)
    expect((await run("2026-10-19T02:34:00Z")).alerted).toBe(2)
    expect((await outbox(dir))[0]!.text).toStartWith(
      "worker-made-up has held run-slot-model-3 for 121 min (since 00:33Z, pid 18014)",
    )
  })

  test("the readers take only what they can judge", () => {
    expect(readyLine("not json")).toEqual([])
    expect(
      readyLine(
        JSON.stringify({
          queue: [
            { pr: "1", readyAt: "x" },
            { pr: 2, readyAt: "2026-10-19T00:00:00Z" },
            { goAt: null, nextGate: "review r7", pr: 1069, readyAt: null },
            { goAt: null, nextGate: "Checks queued", pr: 1090, readyAt: "2026-10-19T00:16:15Z" },
            {
              goAt: "2026-10-19T01:10:00Z",
              nextGate: "normal review round, then local CI",
              pr: 1092,
              readyAt: "2026-10-19T01:05:00Z",
            },
            { goAt: "2026-10-19T01:10:00Z", pr: 1049, readyAt: "2026-10-19T01:05:00Z" },
            {
              goAt: "2026-10-19T04:20:00Z",
              nextGate:
                "e0ddf3a (hand merge canary 4247a3f + nit); small round (even-gauge) running; then local CI + Checks",
              pr: 1169,
              readyAt: "2026-10-19T04:15:00Z",
            },
            {
              goAt: "2026-10-19T04:20:00Z",
              nextGate: "local CI around 04:30Z, then Checks",
              pr: 1170,
              readyAt: "2026-10-19T04:15:00Z",
            },
          ],
        }),
      ),
    ).toEqual([
      { goAt: undefined, nextGate: "Checks queued", pr: 1090, readyAt: "2026-10-19T00:16:15Z" },
      {
        goAt: "2026-10-19T01:10:00Z",
        nextGate: undefined,
        pr: 1049,
        readyAt: "2026-10-19T01:05:00Z",
      },
      {
        goAt: "2026-10-19T04:20:00Z",
        nextGate: "local CI around 04:30Z, then Checks",
        pr: 1170,
        readyAt: "2026-10-19T04:15:00Z",
      },
    ])
    expect(gateProcess("python3 -I /o/localci/run.py 1110", 1110)).toBe(true)
    expect(gateProcess("python3 -I /o/localci/run.py 11100", 1110)).toBe(false)
    expect(gateProcess("bash run-slot.sh ops-checks-1108-1092 -- python3", 1092)).toBe(true)
    expect(
      lastGateLine(
        ["2026-10-19T00:52:42Z lane chk-6: #11120 @ x", "2026-10-19T00:52:25Z done: #1112 green"],
        1112,
      ),
    ).toBe(Date.parse("2026-10-19T00:52:25Z"))
    expect(holderOf("run-slot", "who notapid 2026-10-19T00:00:00Z", [])).toBeNull()
  })
})
