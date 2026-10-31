import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cycle, holderOf, type Proc } from "../../../../../packages/scripts/src/ops-flow/flow"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A scratch CLAUDE_CONFIG_DIR with, when given, one run-slot holder.
const scratch = (options: { holder?: string } = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), "ops-flow-"))
  dirs.push(dir)
  const ops = join(dir, "playground", "ops")
  mkdirSync(ops, { recursive: true })
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
describe("ops-flow", () => {
  test("a run-slot holder over 15 minutes alerts once, naming it, its command and its age", async () => {
    const dir = scratch({ holder: "tester-deft-heron 18013 2026-10-19T00:33:00Z" })
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
    expect((await outbox(dir)).map((line) => line.to)).toEqual(["lead-builder", "lead-ops"])
    const log = await readFile(join(dir, "playground", "ops", "alerts.log"), "utf8")
    expect(log).toContain("[ops-flow → lead-ops] tester-deft-heron has held run-slot")
  })

  test("a holder under 15 minutes, or one whose pid is gone, raises nothing", async () => {
    const dir = scratch({ holder: "worker-made-up 4933 2026-10-19T00:52:53Z" })
    const procs: Proc[] = [
      { command: "bash run-slot.sh worker-made-up -- bun run test", pid: 4933 },
    ]
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
    const dir = scratch()
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

  test("a holder line that names no pid reads as no holder", () => {
    expect(holderOf("run-slot", "who notapid 2026-10-19T00:00:00Z", [])).toBeNull()
  })
})
