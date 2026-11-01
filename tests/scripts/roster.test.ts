import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dataDir } from "../../packages/env/src/data-dir"
import { USAGE } from "../../scripts/roster"
import { storeWith } from "./hooks/render-set"

const script = join(import.meta.dir, "..", "..", "scripts", "roster.ts")
const scratch = mkdtempSync(join(tmpdir(), "roster-ts-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

type Agent = Record<string, unknown> & { name: string }
type RosterFile = { agents: Agent[]; backlog?: string[]; updatedAt?: string }

let dirs = 0
// A config folder of its own per case, holding the roster as earlier writes left it (none when agents is null).
// A config folder whose store sets factory.repo to acme/app, so a bare PR number never reads the checkout's origin, which a box run has none of.
const configWith = (agents: Agent[] | null, backlog?: string[]): string => {
  const dir = join(scratch, `config-${++dirs}`)
  mkdirSync(join(dir, "playground"), { recursive: true })
  storeWith(join(dir, "playground"), {}, { "factory.repo": "acme/app" })
  if (agents)
    writeFileSync(
      join(dir, "playground", "roster.json"),
      JSON.stringify({ agents, backlog, updatedAt: "2026-10-01T00:00:00Z" }),
    )
  return dir
}

// A config folder whose store sets factory.repo, the repository a bare PR number links into.
const factoryConfig = (agents: Agent[]): string => {
  const dir = configWith(agents)
  storeWith(join(dir, "playground"), {}, { "factory.repo": "acme/factory" })
  return dir
}

const run = async (config: string, args: string[]) => {
  const proc = Bun.spawn(["bun", script, ...args], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  const code = await proc.exited
  const path = join(config, "playground", "roster.json")
  return {
    code,
    err: await new Response(proc.stderr).text(),
    out: await new Response(proc.stdout).text(),
    roster: existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RosterFile) : null,
  }
}

// A UTC ISO time the given minutes from now, as `date -u +%FT%TZ` prints one.
const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")

const agentOf = (roster: RosterFile | null, name: string) =>
  roster?.agents.find((a) => a.name === name)

const WITH_PR: Agent = {
  branch: "pg-1-x",
  kind: "worker",
  lastReport: "PR opened",
  lastReportAt: "2026-10-01T00:00:00Z",
  name: "worker-greed",
  pr: "https://github.com/acme/app/pull/1",
  repo: "acme/app",
  role: "worker",
  status: "working",
  task: "Fix the export",
  title: "Export fix",
}

describe("set", () => {
  test("a new agent takes its kind and role from kind=, its name aside", async () => {
    const r = await run(configWith([]), [
      "set",
      "k3v9q2-reviewer",
      "kind=reviewer",
      "task=Review #97",
      "worker=x7mh4d-worker",
    ])
    expect(r.code).toBe(0)
    expect(agentOf(r.roster, "k3v9q2-reviewer")).toEqual({
      kind: "reviewer",
      name: "k3v9q2-reviewer",
      role: "worker",
      status: "starting",
      task: "Review #97",
      title: "",
      worker: "x7mh4d-worker",
    })
    const runner = await run(configWith([]), ["set", "x7mh4d-runner", "kind=runner", "task=t"])
    expect(agentOf(runner.roster, "x7mh4d-runner")?.role).toBe("runner")
    const builder = await run(configWith([]), ["set", "x7mh4d-builder", "kind=builder", "task=t"])
    expect(agentOf(builder.roster, "x7mh4d-builder")?.role).toBe("manager")
  })

  test("a new agent with an old name takes the kind its prefix gives", async () => {
    const r = await run(configWith([]), ["set", "runner-pride", "task=t", "workspace=workspace:3"])
    expect(agentOf(r.roster, "runner-pride")).toMatchObject({ kind: "runner", role: "runner" })
    const plain = await run(configWith([]), ["set", "dispatcher", "status=working", "task=t"])
    expect(agentOf(plain.roster, "dispatcher")).toMatchObject({ role: "manager" })
    expect(agentOf(plain.roster, "dispatcher")?.kind).toBeUndefined()
  })

  // the dashboard's schema drops an agent with no task, so a spawned probe went missing from the board.
  test("a new agent with no task, or an empty one, is refused, naming task=, and the roster is left as it was", async () => {
    const config = configWith([WITH_PR])
    const pair = "add task=<what it does>"
    for (const [args, fix] of [
      [["set", "probe-x", "kind=probe"], pair],
      [["set", "probe-x", "kind=probe", "task="], pair],
      [["set", "probe-x", "task=  "], pair],
      [["report", "probe-x", "started"], pair],
      [["assign", "probe-x", "Probe", ""], "give what it does as assign's <task> word"],
    ] as const) {
      const r = await run(config, [...args])
      expect(r.code).toBe(1)
      expect(r.err).toContain("probe-x is not on the roster yet")
      expect(r.err).toContain(fix)
      expect(r.roster).toMatchObject({ agents: [WITH_PR], updatedAt: "2026-10-01T00:00:00Z" })
    }
    const kept = await run(config, ["set", "worker-greed", "status=parked"])
    expect(kept.code).toBe(0)
    expect(agentOf(kept.roster, "worker-greed")).toEqual({ ...WITH_PR, status: "parked" })
  })

  test("a kind outside the list is refused, and the roster is left as it was", async () => {
    const config = configWith([WITH_PR])
    const r = await run(config, ["set", "worker-greed", "kind=wizard"])
    expect(r.code).toBe(2)
    expect(r.err).toContain("kind takes one of builder, dispatcher")
    expect(r.roster).toMatchObject({ agents: [WITH_PR], updatedAt: "2026-10-01T00:00:00Z" })
  })

  test("a new task on an agent holding a pr is refused, naming assign", async () => {
    const config = configWith([WITH_PR])
    const r = await run(config, ["set", "worker-greed", "task=Something else"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("worker-greed holds a pr")
    expect(r.err).toContain("roster.ts assign worker-greed")
    expect(r.roster?.agents).toEqual([WITH_PR])
    const at = inMinutes(90)
    const eta = await run(config, ["set", "worker-greed", `eta=${at}`])
    expect(eta.code).toBe(0)
    expect(agentOf(eta.roster, "worker-greed")).toEqual({ ...WITH_PR, eta: at })
  })

  // rows read by their first ask while no title was set, and set refused one on a row holding a pr.
  test("a title on an agent holding a pr is set, leaving its pr, branch and repo", async () => {
    const config = configWith([WITH_PR])
    const r = await run(config, ["set", "worker-greed", "title=Fix the CSV export"])
    expect(r.code).toBe(0)
    expect(agentOf(r.roster, "worker-greed")).toEqual({ ...WITH_PR, title: "Fix the CSV export" })
  })

  // a reviewer moved to another PR by message kept its old worker, which held that worker's ended row in the sidebar.
  test("a checker's pr or worker moves only through assign, which takes both, and set or report naming either is refused", async () => {
    const checker: Agent = {
      kind: "reviewer",
      name: "k3v9q2-reviewer",
      pr: "https://github.com/acme/app/pull/1",
      role: "worker",
      status: "working",
      task: "Review #1",
      title: "Reviewer of x7mh4d-worker",
      worker: "x7mh4d-worker",
    }
    const config = configWith([checker])
    for (const args of [
      ["set", "k3v9q2-reviewer", "pr=2"],
      ["set", "k3v9q2-reviewer", "worker=b4n8tz-worker"],
      ["set", "k3v9q2-reviewer", "worker=b4n8tz-worker", "pr=2"],
      ["report", "k3v9q2-reviewer", "on #2", "pr=2"],
      ["assign", "k3v9q2-reviewer", "Reviewer", "Review #2", "pr=2"],
      ["assign", "k3v9q2-reviewer", "Reviewer", "Review #2", "worker=b4n8tz-worker"],
    ]) {
      const r = await run(config, args)
      expect(r.code).toBe(1)
      expect(r.err).toContain(
        "roster.ts assign k3v9q2-reviewer <title> <task> worker=<worker> pr=<url>",
      )
      expect(r.roster?.agents).toEqual([checker])
    }
    for (const pairs of [["worker=x7mh4d-worker", "pr=1"], ["status=waiting"]]) {
      const same = await run(config, ["set", "k3v9q2-reviewer", ...pairs])
      expect(same.code).toBe(0)
    }
    const retask = await run(config, [
      "assign",
      "k3v9q2-reviewer",
      "Reviewer of b4n8tz-worker",
      "Review #2",
      "worker=b4n8tz-worker",
      "pr=2",
    ])
    expect(retask.code).toBe(0)
    expect(agentOf(retask.roster, "k3v9q2-reviewer")).toEqual({
      ...checker,
      pr: "https://github.com/acme/app/pull/2",
      task: "Review #2",
      title: "Reviewer of b4n8tz-worker",
      worker: "b4n8tz-worker",
    })
    const worker = await run(configWith([WITH_PR]), ["set", "worker-greed", "pr=2"])
    expect(worker.code).toBe(0)
  })

  test("a title loses a trailing (#N) and is cut to 40 characters; an empty value removes its key", async () => {
    const r = await run(configWith([]), [
      "set",
      "worker-envy",
      "task=t",
      "title=A title that runs well past forty characters (#97)",
      "kind=",
    ])
    expect(agentOf(r.roster, "worker-envy")?.title).toBe("A title that runs well past forty charac")
    expect(agentOf(r.roster, "worker-envy")).not.toHaveProperty("kind")
  })

  // code-review-loop's recovery scan holds a PR by its full URL alone, so a bare number read as lost.
  test("a bare pr number, with or without #, becomes the full URL of the call's repo, else the row's, else factory.repo's", async () => {
    const url = "https://github.com/acme/app/pull/1561"
    for (const pr of ["1561", "#1561"]) {
      const r = await run(configWith([]), ["set", "worker-envy", "task=t", `pr=${pr}`])
      expect(r.code).toBe(0)
      expect(agentOf(r.roster, "worker-envy")?.pr).toBe(url)
      const a = await run(configWith([]), ["assign", "reviewer-envy", "Review", "t", `pr=${pr}`])
      expect(a.code).toBe(0)
      expect(agentOf(a.roster, "reviewer-envy")?.pr).toBe(url)
    }
    const otherRepo = "acme-labs/acme-app"
    const call = await run(configWith([]), [
      "set",
      "worker-envy",
      "task=t",
      "pr=7",
      `repo=${otherRepo}`,
    ])
    expect(agentOf(call.roster, "worker-envy")?.pr).toBe(`https://github.com/${otherRepo}/pull/7`)
    const row = await run(configWith([{ ...WITH_PR, repo: otherRepo }]), [
      "set",
      "worker-greed",
      "pr=#8",
    ])
    expect(agentOf(row.roster, "worker-greed")?.pr).toBe(`https://github.com/${otherRepo}/pull/8`)
    const cleared = await run(factoryConfig([{ ...WITH_PR, repo: otherRepo }]), [
      "assign",
      "worker-greed",
      "Next",
      "t",
      "pr=9",
    ])
    expect(agentOf(cleared.roster, "worker-greed")?.pr).toBe(
      "https://github.com/acme/factory/pull/9",
    )
    const emptied = await run(factoryConfig([{ ...WITH_PR, repo: otherRepo }]), [
      "set",
      "worker-greed",
      "repo=",
      "pr=11",
    ])
    expect(agentOf(emptied.roster, "worker-greed")?.pr).toBe(
      "https://github.com/acme/factory/pull/11",
    )
    const full = `https://github.com/${otherRepo}/pull/10`
    const kept = await run(configWith([]), ["set", "worker-envy", "task=t", `pr=${full}`])
    expect(agentOf(kept.roster, "worker-envy")?.pr).toBe(full)
  })

  test("any other pr value is refused, naming the URL form, and the roster is left as it was", async () => {
    const config = configWith([WITH_PR])
    for (const args of [
      ["set", "worker-greed", "pr=abc"],
      ["set", "worker-greed", "pr=0"],
      ["set", "worker-greed", "pr=1561x"],
      ["set", "worker-greed", "pr=github.com/acme/app/pull/1"],
      ["set", "worker-greed", "repo=bad", "pr=7"],
      ["report", "worker-greed", "opened", "pr=#x"],
      ["assign", "worker-greed", "Next", "t", "pr=abc"],
    ]) {
      const r = await run(config, args)
      expect(r.code).toBe(2)
      expect(r.err).toContain("https://github.com/<owner>/<name>/pull/<n>")
      expect(r.roster).toMatchObject({ agents: [WITH_PR], updatedAt: "2026-10-01T00:00:00Z" })
    }
  })

  test("every write stamps updatedAt from the clock, and a missing roster starts empty", async () => {
    const before = Date.now() - 1000
    const r = await run(configWith(null), ["set", "worker-envy", "kind=worker", "task=t"])
    expect(r.code).toBe(0)
    expect(r.roster?.agents.map((a) => a.name)).toEqual(["worker-envy"])
    expect(r.roster?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(Date.parse(r.roster?.updatedAt ?? "")).toBeGreaterThanOrEqual(before)
  })

  test("with PLAYGROUND_DATA_DIR set, the row lands in that data folder, where spawn.sh reads the roster", async () => {
    const config = configWith(null)
    const data = join(scratch, `data-${++dirs}`)
    storeWith(data, {}, { "factory.repo": "acme/app" })
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: data }
    const proc = Bun.spawn(["bun", script, "set", "p4dd1r-worker", "task=t"], {
      env,
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(await proc.exited).toBe(0)
    const read = JSON.parse(readFileSync(join(dataDir(env), "roster.json"), "utf8")) as RosterFile
    expect(agentOf(read, "p4dd1r-worker")?.task).toBe("t")
    expect(existsSync(join(config, "playground", "roster.json"))).toBe(false)
  })
})

// ops-report took an ended session whose status held a sentence for one that was down.
describe("status", () => {
  const statuses = join(import.meta.dir, "..", "..", "scripts", "roster-statuses.json")

  test("is defined once, holding the words ops-report reads as finished", async () => {
    const { finished, live } = (await Bun.file(statuses).json()) as Record<string, string[]>
    expect(finished).toEqual(["closed", "done", "ended", "merged", "parked", "paused"])
    expect(live).toEqual(["starting", "waiting", "working"])
  })

  test("holds every word a roster reader compares a status with", async () => {
    const { finished, live } = (await Bun.file(statuses).json()) as Record<string, string[]>
    const root = join(import.meta.dir, "..", "..")
    // Each reader by the expression it reads a roster entry's status through.
    for (const [file, through] of [
      ["api/hono/src/lib/dashboard/agents.ts", "agent\\.status"],
      ["packages/config/src/kinds.ts", "status"],
      ["packages/scripts/src/ops-sweep/sweep.ts", "a\\.status"],
      ["packages/scripts/src/ops-tick/tick.ts", "agent\\?\\.status"],
      ["packages/scripts/src/verify/checks.ts", "a\\.status"],
      ["scripts/ops/optimizer/idle_sessions.ts", "r\\.status"],
      ["scripts/ops/up.py", 'a\\.get\\("status"\\)'],
      ["scripts/spawn.sh", 'a\\.get\\("status"\\)'],
      ["extensions/core/skills/code-review-loop/scripts/state.py", 'a\\.get\\("status"\\)'],
      ["web/next/src/components/dashboard/status-table.tsx", "agent\\.status"],
      ["web/next/src/lib/agents.ts", "agent\\.status"],
    ] as const) {
      const text = readFileSync(join(root, file), "utf8")
      const all = (pattern: string) => [...text.matchAll(new RegExp(pattern, "g"))]
      const quoted = (lists: RegExpExecArray[]) =>
        lists.flatMap((m) => [...m[1]!.matchAll(/"([a-z-]+)"/g)].map((q) => q[1]))
      const words = [
        ...all(`(?<![\\w.])${through} [!=]==? "([a-z-]+)"`).map((m) => m[1]),
        ...quoted(all(`\\[([^\\]]*)\\]\\.includes\\(${through}\\)`)),
        ...quoted(all(`${through} (?:not )?in \\(([^)]*)\\)`)),
        ...quoted(all(`(?:SEATLESS|HELD) = new Set\\(\\[(.*)\\]\\)`)),
      ]
      expect({ file, read: words.length > 0 }).toEqual({ file, read: true })
      for (const word of words)
        expect({ file, word, listed: [...live!, ...finished!].includes(word!) }).toEqual({
          file,
          word,
          listed: true,
        })
    }
  })

  test("takes every word of the list", async () => {
    const { finished, live } = (await Bun.file(statuses).json()) as Record<string, string[]>
    const config = configWith([WITH_PR])
    for (const word of [...live!, ...finished!]) {
      const r = await run(config, ["set", "worker-greed", `status=${word}`])
      expect([r.code, agentOf(r.roster, "worker-greed")?.status]).toEqual([0, word])
    }
  })

  test("refuses any other text on set, report and assign, naming report, and writes nothing", async () => {
    const config = configWith([WITH_PR])
    for (const args of [
      ["set", "worker-greed", "status=ended: #1522 merged d2868c2"],
      ["set", "worker-greed", "status="],
      ["set", "worker-greed", "status=working", "status=free text here"],
      ["report", "worker-greed", "r3 4/5", "status=fixing S1"],
      ["assign", "worker-greed", "Chore", "Do it", "status=active"],
    ]) {
      const r = await run(config, args)
      expect(r.code).toBe(2)
      expect(r.err).toContain("status takes one of starting, waiting, working, closed, done, ended")
      expect(r.err).toContain('roster.ts report worker-greed "<text>"')
      expect(r.roster).toMatchObject({ agents: [WITH_PR], updatedAt: "2026-10-01T00:00:00Z" })
    }
  })

  test("leaves a row already holding text: its other keys still write", async () => {
    const old = { ...WITH_PR, status: "#1114 r3 4/5 @7453ba1, fixing S1/S2" }
    const at = inMinutes(90)
    const r = await run(configWith([old]), ["set", "worker-greed", `eta=${at}`])
    expect(r.code).toBe(0)
    expect(agentOf(r.roster, "worker-greed")).toEqual({ ...old, eta: at })
    const report = await run(configWith([old]), [
      "report",
      "worker-greed",
      "merged",
      "status=ended",
    ])
    expect(agentOf(report.roster, "worker-greed")?.status).toBe("ended")
  })
})

// a worker sent its lead the literal placeholder <ETA>, and the roster stored it.
describe("eta", () => {
  test.each([
    ["the placeholder", "<ETA>"],
    ["a clock time alone", "13:50Z"],
    ["a time a minute past", inMinutes(-1)],
  ])("%s is refused by set, report and assign, naming the recipe", async (_case, value) => {
    for (const args of [
      ["set", "worker-greed", `eta=${value}`],
      ["report", "worker-greed", "PR opened", `eta=${value}`],
      ["assign", "worker-greed", "Export fix", "Fix the export", `eta=${value}`],
    ]) {
      const r = await run(configWith([WITH_PR]), args)
      expect(r.code).toBe(2)
      expect(r.err).toContain("an ETA is `date -u` plus your estimate, in UTC")
      expect(r.roster).toMatchObject({ agents: [WITH_PR], updatedAt: "2026-10-01T00:00:00Z" })
    }
  })

  test("a future UTC ISO time is stored, and an empty eta= clears it", async () => {
    const config = configWith([WITH_PR])
    const at = inMinutes(60)
    const set = await run(config, ["set", "worker-greed", `eta=${at}`])
    expect(set.code).toBe(0)
    expect(agentOf(set.roster, "worker-greed")?.eta).toBe(at)
    const cleared = await run(config, ["report", "worker-greed", "merged abc1234", "eta="])
    expect(cleared.code).toBe(0)
    expect(agentOf(cleared.roster, "worker-greed")).not.toHaveProperty("eta")
  })
})

describe("assign, report and backlog", () => {
  test("assign gives a new task, clearing the old one's pr, branch, repo and report, its kind kept", async () => {
    const r = await run(configWith([WITH_PR]), [
      "assign",
      "worker-greed",
      "New chore",
      "Do the new chore",
    ])
    expect(r.code).toBe(0)
    expect(agentOf(r.roster, "worker-greed")).toEqual({
      kind: "worker",
      name: "worker-greed",
      role: "worker",
      status: "working",
      task: "Do the new chore",
      title: "New chore",
    })
  })

  test("report sets lastReport and stamps lastReportAt", async () => {
    const r = await run(configWith([WITH_PR]), ["report", "worker-greed", "CI green"])
    const agent = agentOf(r.roster, "worker-greed")
    expect(agent?.lastReport).toBe("CI green")
    expect(agent?.lastReportAt).not.toBe("2026-10-01T00:00:00Z")
  })

  test("backlog appends one entry", async () => {
    const r = await run(configWith([], ["first"]), ["backlog", "Fix: second"])
    expect(r.roster?.backlog).toEqual(["first", "Fix: second"])
  })

  test("backlog-done marks one entry with its issue, the others and the length kept", async () => {
    const r = await run(configWith([], ["first", "Fix: second", "third"]), [
      "backlog-done",
      "1",
      "1402",
    ])
    expect(r.code).toBe(0)
    expect(r.roster?.backlog).toEqual(["first", "[#1402] Fix: second", "third"])
    expect(r.roster?.updatedAt).not.toBe("2026-10-01T00:00:00Z")
  })

  test("backlog-done refuses a bad index, a bad issue and a marked entry, and writes nothing", async () => {
    const backlog = ["first", "[#7] filed"]
    const config = configWith([], backlog)
    for (const [args, code, reason] of [
      [["2", "9"], 2, "takes an index from 0 to 1, not 2"],
      [["-1", "9"], 2, "takes an index from 0 to 1, not -1"],
      [["1.5", "9"], 2, "takes an index from 0 to 1, not 1.5"],
      [["x", "9"], 2, "takes an index from 0 to 1, not x"],
      [["01", "9"], 2, "takes an index from 0 to 1, not 01"],
      [["0", "0"], 2, "takes a positive issue number, not 0"],
      [["0", "#9"], 2, "takes a positive issue number, not #9"],
      [["0", "9.5"], 2, "takes a positive issue number, not 9.5"],
      [["0"], 2, "takes a positive issue number\n"],
      [["0", "9", "extra"], 2, "takes one issue number, not also extra"],
      [["1", "9"], 1, "entry 1 is already marked: [#7] filed"],
    ] as const) {
      const r = await run(config, ["backlog-done", ...args])
      expect(r.code).toBe(code)
      expect(r.err).toContain(reason)
      expect(r.roster).toMatchObject({ backlog, updatedAt: "2026-10-01T00:00:00Z" })
    }
    const empty = await run(configWith([], []), ["backlog-done", "0", "9"])
    expect([empty.code, empty.err]).toEqual([
      1,
      "roster.ts: backlog-done finds the backlog empty\n",
    ])
    for (const [args, reason] of [
      [["x", "0"], "takes a positive issue number, not 0"],
      [["0", "9", "extra"], "takes one issue number, not also extra"],
    ] as const) {
      const r = await run(configWith([], []), ["backlog-done", ...args])
      expect(r.code).toBe(2)
      expect(r.err).toContain(reason)
    }
  })

  test("backlog-done marks an entry queued with a leading [# that is no mark", async () => {
    const config = configWith([], ["[#todo] queued by hand", "[#0] zero", "[#012] padded"])
    const runs = []
    for (const at of ["0", "1", "2"]) runs.push(await run(config, ["backlog-done", at, "9"]))
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0])
    expect(runs.at(-1)?.roster?.backlog).toEqual([
      "[#9] [#todo] queued by hand",
      "[#9] [#0] zero",
      "[#9] [#012] padded",
    ])
  })
})

describe("backfill", () => {
  test("each entry with no kind takes the one its prefix gives; a set kind and any other name stay", async () => {
    const config = configWith([
      { name: "worker-greed", role: "worker", status: "working", task: "t" },
      { name: "reviewer-greed-97", role: "worker", status: "working", task: "t" },
      { name: "runner-pride", role: "runner", status: "working", task: "t" },
      { name: "probe-history", role: "worker", status: "working", task: "t" },
      { kind: "researcher", name: "worker-envy", role: "worker", status: "working", task: "t" },
      { name: "builder", role: "manager", status: "working", task: "t" },
    ])
    const r = await run(config, ["backfill"])
    expect(r.code).toBe(0)
    expect(r.roster?.agents.map((a) => [a.name, a.kind])).toEqual([
      ["worker-greed", "worker"],
      ["reviewer-greed-97", "reviewer"],
      ["runner-pride", "runner"],
      ["probe-history", "probe"],
      ["worker-envy", "researcher"],
      ["builder", undefined],
    ])
    const again = await run(config, ["backfill"])
    expect(again.roster?.agents).toEqual(r.roster?.agents ?? [])
  })
})

describe("who", () => {
  test("prints the live entry of a manager kind, else its sessions.names name, and writes nothing", async () => {
    const config = configWith([
      { name: "builder", role: "manager", status: "working", task: "t" },
      { kind: "builder", name: "x7mh4d-builder", role: "manager", status: "working", task: "t" },
    ])
    const builder = await run(config, ["who", "builder"])
    expect([builder.code, builder.out]).toEqual([0, "x7mh4d-builder\n"])
    expect(builder.roster?.updatedAt).toBe("2026-10-01T00:00:00Z")
    const ops = await run(config, ["who", "ops"])
    expect([ops.code, ops.out]).toEqual([0, "ops\n"])
    const none = await run(configWith(null), ["who", "planner"])
    expect([none.code, none.out, none.roster]).toEqual([0, "planner\n", null])
  })

  test("who dispatcher prints the primary's live name, and who dispatcher 2 the second's", async () => {
    const config = configWith([
      { kind: "dispatcher", name: "dispatcher", role: "manager", status: "working", task: "t" },
      {
        kind: "dispatcher",
        name: "q8r2tx-dispatcher",
        role: "manager",
        slot: "2",
        status: "working",
        task: "t",
      },
    ])
    const alpha = await run(config, ["who", "dispatcher"])
    expect([alpha.code, alpha.out]).toEqual([0, "dispatcher\n"])
    const bravo = await run(config, ["who", "dispatcher", "2"])
    expect([bravo.code, bravo.out]).toEqual([0, "q8r2tx-dispatcher\n"])
    const none = await run(configWith(null), ["who", "dispatcher", "2"])
    expect([none.code, none.out]).toEqual([0, "dispatcher-2\n"])
  })

  test("who takes a slot for the dispatcher alone, and only 1 or 2", async () => {
    for (const argv of [
      ["who", "dispatcher", "3"],
      ["who", "dispatcher", "Bravo"],
      ["who", "builder", "2"],
    ]) {
      const r = await run(configWith([]), argv)
      expect(r.code).toBe(2)
      expect(r.out).toBe("")
    }
  })

  test("refuses a kind that is not a manager's", async () => {
    const r = await run(configWith([]), ["who", "worker"])
    expect(r.code).toBe(2)
    expect(r.err).toContain("planner, builder, ops, optimizer, dispatcher")
    expect(r.out).toBe("")
  })
})

test("an unknown command prints the usage and writes nothing", async () => {
  const config = configWith([WITH_PR])
  const r = await run(config, ["frob", "x"])
  expect(r.code).toBe(2)
  expect(r.err.trim()).toBe(USAGE)
  expect(r.roster?.updatedAt).toBe("2026-10-01T00:00:00Z")
})

describe("name", () => {
  test("a name outside spawn.sh's word shape is refused on set, report and assign, naming it, and writes nothing", async () => {
    const config = configWith([WITH_PR])
    for (const args of [
      ["set", "worker-rail-slot 2026-10-20T14:30:00Z", "eta="],
      ["report", "worker:greed", "hello"],
      ["assign", "worker/greed", "Title", "Do it"],
      ["set", "k3m9px_worker", "task=t"],
      ["set", "--help", "task=t"],
    ]) {
      const r = await run(config, args)
      expect(r.code).toBe(2)
      expect(r.err).toContain("lowercase words joined by hyphens")
      expect(r.err).toContain(args[1]!)
      expect(r.roster).toMatchObject({ agents: [WITH_PR], updatedAt: "2026-10-01T00:00:00Z" })
    }
  })

  test("an ordinary session name still passes", async () => {
    const r = await run(configWith([]), ["set", "k3m9px-worker", "task=t"])
    expect(r.code).toBe(0)
    expect(agentOf(r.roster, "k3m9px-worker")).toMatchObject({ name: "k3m9px-worker" })
  })
})
