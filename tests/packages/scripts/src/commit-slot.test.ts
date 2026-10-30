import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { slotted } from "../../../../packages/scripts/src/commit-slot"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/commit-slot.ts")
const DIR = mkdtempSync(join(tmpdir(), "commit-slot-"))

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

const RUN_SLOT = "/home/u/.playground/ops/run-slot.sh"
const WORKTREE = "/repo/.claude/worktrees/pg-1314-slot-commit"
const at = (cwd: string, env: Record<string, string | undefined> = {}, runnable = true) =>
  slotted({ argv: ["bun", "run", "build"], cwd, env, executable: () => runnable, home: "/home/u" })

describe("slotted", () => {
  test("a worktree's step takes the run slot under its folder's name", () => {
    expect(at(WORKTREE)).toEqual([
      RUN_SLOT,
      "commit-pg-1314-slot-commit",
      "--",
      "bun",
      "run",
      "build",
    ])
  })

  test("a subfolder of a worktree is named for the worktree", () => {
    expect(at(`${WORKTREE}/web/next`)[1]).toBe("commit-pg-1314-slot-commit")
  })

  test("a folder name run-slot would refuse is cleaned to its characters", () => {
    expect(at("/repo/.claude/worktrees/a b+c")[1]).toBe("commit-a-b-c")
  })

  test("with no executable run-slot.sh the step runs bare", () => {
    expect(at(WORKTREE, {}, false)).toEqual(["bun", "run", "build"])
  })

  test("outside a worktree the step runs bare", () => {
    expect(at("/repo")).toEqual(["bun", "run", "build"])
  })

  test("a commit already under run-slot runs the step bare, so it never waits on its own slot", () => {
    expect(at(WORKTREE, { RUN_SLOT_NICE: "10" })).toEqual(["bun", "run", "build"])
  })

  test("a run-slot nice of 0, as ops-dashboard sets, still reads as under run-slot", () => {
    expect(at(WORKTREE, { RUN_SLOT_NICE: "0" })).toEqual(["bun", "run", "build"])
  })
})

describe("commit-slot.ts", () => {
  const home = join(DIR, "home")
  const ops = join(home, ".playground/ops")
  const worktree = join(DIR, "repo/.claude/worktrees/wt-one")
  mkdirSync(ops, { recursive: true })
  mkdirSync(worktree, { recursive: true })
  const env = () => {
    const base = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && entry[0] !== "RUN_SLOT_NICE",
      ),
    )
    return { ...base, HOME: home }
  }
  const run = (args: string[]) =>
    Bun.spawnSync(["bun", "--no-env-file", SCRIPT, ...args], {
      cwd: worktree,
      env: env(),
      stderr: "pipe",
      stdout: "pipe",
    })

  test("hands the step to run-slot.sh and keeps its exit code", () => {
    const seen = join(DIR, "seen")
    writeFileSync(join(ops, "run-slot.sh"), `#!/bin/sh\necho "$@" > '${seen}'\nexit 7\n`)
    chmodSync(join(ops, "run-slot.sh"), 0o755)
    let result: ReturnType<typeof run>
    try {
      result = run(["echo", "hi"])
    } finally {
      rmSync(join(ops, "run-slot.sh"))
    }
    expect(readFileSync(seen, "utf8")).toBe("commit-wt-one -- echo hi\n")
    expect(result.exitCode).toBe(7)
  })

  test("runs the step bare when run-slot.sh is not executable", () => {
    writeFileSync(join(ops, "run-slot.sh"), "#!/bin/sh\nexit 7\n")
    let result: ReturnType<typeof run>
    try {
      result = run(["echo", "hi"])
    } finally {
      rmSync(join(ops, "run-slot.sh"))
    }
    expect(result.stdout.toString()).toBe("hi\n")
    expect(result.exitCode).toBe(0)
  })

  test("runs the step bare with no run-slot.sh, keeping its output and exit code", () => {
    const ok = run(["echo", "hi"])
    expect(ok.stdout.toString()).toBe("hi\n")
    expect(ok.exitCode).toBe(0)
    expect(run(["sh", "-c", "exit 3"]).exitCode).toBe(3)
  })
})
