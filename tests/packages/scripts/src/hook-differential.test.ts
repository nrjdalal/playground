import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  calls,
  canaryTree,
  cwdsOf,
  replay,
  routed,
  sweep,
  type Check,
} from "../../../../packages/scripts/src/hook-differential"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/hook-differential.ts")
const DIR = mkdtempSync(join(tmpdir(), "hook-differential-"))

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

// a home whose run-slot.sh stand-in logs each ticket it is asked for and answers `room` with 7 waiters
const home = (name: string) => {
  const at = join(DIR, name)
  mkdirSync(join(at, ".playground", "ops"), { recursive: true })
  const runSlot = join(at, ".playground", "ops", "run-slot.sh")
  writeFileSync(
    runSlot,
    `#!/bin/bash\nif [ "$1" = room ]; then echo "4 4 0 7"; exit 0; fi\necho "$*" >> "${at}/tickets"\n`,
  )
  chmodSync(runSlot, 0o755)
  return at
}

const start = (at: string, env: Record<string, string> = {}) => {
  const { RUN_SLOT_NICE: _, ...rest } = process.env
  return Bun.spawnSync(["bun", SCRIPT, "replay", "--canary", "HEAD", "--hook", "no-such-hook"], {
    cwd: join(import.meta.dir, "../../../.."),
    env: { ...rest, HOME: at, ...env },
    stderr: "pipe",
    stdout: "pipe",
  })
}

describe("a start of hook-differential", () => {
  test("a bare start of the replay takes a run-slot ticket and says so on stderr with the queue's depth", () => {
    const at = home("bare")
    const run = start(at)
    expect(readFileSync(join(at, "tickets"), "utf8")).toContain(
      `-- bun ${SCRIPT} replay --canary HEAD --hook no-such-hook`,
    )
    expect(run.stderr.toString()).toContain("queued through run-slot behind 7 waiting")
  })

  test("a start inside a run-slot ticket takes no second one", () => {
    const at = home("inside")
    start(at, { RUN_SLOT_NICE: "10" })
    expect(existsSync(join(at, "tickets"))).toBe(false)
  })

  test("a sweep with no --forms prints the usage and ends with 2", () => {
    const run = Bun.spawnSync(
      ["bun", SCRIPT, "sweep", "--canary", "HEAD", "--hook", "no-extensions-write"],
      { env: { ...process.env, RUN_SLOT_NICE: "10" }, stderr: "pipe", stdout: "pipe" },
    )
    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain("usage: bun run hooks:differential")
  })
})

describe("canaryTree", () => {
  const recorder =
    (steps: string[], failing = "") =>
    (argv: string[], cwd: string) => {
      steps.push(`${cwd} :: ${argv.join(" ")}`)
      return { exitCode: argv[0] === failing ? 1 : 0, stdout: new Uint8Array() }
    }

  test("unpacks the sha's whole tree and installs it from its own lockfile with no install scripts, once", () => {
    const base = join(DIR, "trees")
    const steps: string[] = []
    const dir = canaryTree({ base, root: "/repo", run: recorder(steps), sha: "abc" })
    expect(dir).toBe(join(base, "abc"))
    expect(steps).toEqual([
      "/repo :: git archive abc",
      `${dir} :: tar -x -C ${dir}`,
      `${dir} :: bun install --frozen-lockfile --ignore-scripts`,
    ])
    canaryTree({ base, root: "/repo", run: recorder(steps), sha: "abc" })
    expect(steps).toHaveLength(3)
  })

  test("a failed install throws and leaves the tree to be installed again", () => {
    const base = join(DIR, "failed")
    const steps: string[] = []
    expect(() =>
      canaryTree({ base, root: "/repo", run: recorder(steps, "bun"), sha: "abc" }),
    ).toThrow("could not install abc")
    canaryTree({ base, root: "/repo", run: recorder(steps), sha: "abc" })
    expect(steps).toHaveLength(6)
  })
})

describe("routed", () => {
  const at = (env: Record<string, string | undefined>, runnable = true) =>
    routed({
      argv: ["bun", "x.ts"],
      cwd: "/r/.claude/worktrees/pg 1",
      env,
      executable: () => runnable,
      home: "/h",
    })

  test("a bare start takes a ticket named for its worktree", () => {
    expect(at({})).toEqual(["/h/.playground/ops/run-slot.sh", "hooks-pg-1", "--", "bun", "x.ts"])
  })

  test("a start inside a ticket, or with no executable run-slot.sh, runs as it is", () => {
    expect(at({ RUN_SLOT_NICE: "10" })).toEqual(["bun", "x.ts"])
    expect(at({}, false)).toEqual(["bun", "x.ts"])
  })
})

describe("sweep and replay", () => {
  // a hook that records every input it is given and allows a command only when it holds ALLOW
  const recorder =
    (seen: string[]): Check =>
    (raw) => {
      seen.push(raw)
      return JSON.parse(raw).tool_input.command.includes(" ALLOW") ? undefined : "refused"
    }
  const ran = join(DIR, "ran")
  const forms = [
    { command: `touch ${ran} ALLOW`, inClass: true },
    { command: `touch ${ran}`, inClass: false },
  ]

  test("each form reaches each hook only as data through check(), from the home, the data folder and a worktree, and none runs", async () => {
    const before: string[] = []
    const after: string[] = []
    const { counts } = await sweep(recorder(before), recorder(after), forms, "/h")
    expect(after.map((raw) => JSON.parse(raw))).toEqual(
      forms.flatMap(({ command }) =>
        cwdsOf("/h").map((cwd) => ({
          cwd,
          tool_input: { command },
          tool_name: "Bash",
        })),
      ),
    )
    expect(counts).toEqual({
      cases: 6,
      forms: 2,
      "newly allowed": { inClass: 0, outClass: 0 },
      "newly refused": { inClass: 0, outClass: 0 },
      same: 6,
    })
    expect(existsSync(ran)).toBe(false)
  })

  test("a form the head allows and canary refuses counts by its class", async () => {
    const refuseAll: Check = () => "refused"
    const { changed, counts } = await sweep(refuseAll, recorder([]), forms, "/h")
    expect(counts["newly allowed"]).toEqual({ inClass: 3, outClass: 0 })
    expect(changed).toEqual([])
  })

  test("the replay reads each made-up Bash call of the day's transcripts once, a sub-agent's included, and only as data", async () => {
    const projects = join(DIR, "projects")
    mkdirSync(join(projects, "p", "s", "subagents"), { recursive: true })
    const line = (command: string, timestamp: string, cwd = "/h/w") =>
      JSON.stringify({
        cwd,
        message: { content: [{ input: { command }, name: "Bash", type: "tool_use" }] },
        timestamp,
      })
    const now = new Date().toISOString()
    writeFileSync(
      join(projects, "p", "s.jsonl"),
      [
        line(`touch ${ran} ALLOW`, now),
        line(`touch ${ran} ALLOW`, now),
        line(`touch ${ran}`, "2000-01-01T00:00:00Z"),
        "not json",
      ].join("\n"),
    )
    writeFileSync(
      join(projects, "p", "s", "subagents", "a.jsonl"),
      line(`touch ${ran} ALLOW`, now, "/h/sub"),
    )
    const list = await calls(projects, Date.now() - 3600_000)
    expect(list.toSorted((x, y) => x.cwd.localeCompare(y.cwd))).toEqual([
      { command: `touch ${ran} ALLOW`, cwd: "/h/sub" },
      { command: `touch ${ran} ALLOW`, cwd: "/h/w" },
    ])
    const { counts } = await replay(() => "refused", recorder([]), list, "/h")
    expect(counts).toEqual({ calls: 2, "newly allowed": 2, "newly refused": 0, same: 0 })
    expect(existsSync(ran)).toBe(false)
  })
})
