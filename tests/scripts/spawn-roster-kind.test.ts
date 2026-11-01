import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { ID_ALPHABET } from "../../packages/config/src/kinds"
import { launchAfterRm, placing, root, scratch, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// a session's kind lives in the roster, so a name that carries no role still reads as what it is.
describe("the roster's kind", () => {
  const rosterOf = (agents: object[]) =>
    JSON.stringify({ agents, updatedAt: "2026-10-18T00:00:00Z" })

  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<{ args: string[]; kind: string }>([
    { args: ["worker", "worker-brave-otter", "b.md"], kind: "kind=worker" },
    { args: ["runner", "runner-brave-otter", "b.md"], kind: "kind=runner" },
    {
      args: ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md"],
      kind: "kind=tester",
    },
    { args: ["column", "probe", "probe-x", "ops", "w1:p2", "p.md"], kind: "kind=probe" },
    { args: ["column", "lead", "builder", "dispatcher", "w1:p2", "l.md"], kind: "kind=builder" },
    { args: ["column", "lead", "ops", "dispatcher", "w1:p2", "l.md"], kind: "kind=ops" },
    {
      args: ["column", "lead", "planner", "dispatcher", "w1:p2", "l.md"],
      kind: "kind=planner",
    },
  ])("every start writes the kind its mode gives: $kind", async ({ args, kind }) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(0)
    expect(r.roster?.[2]).toBe(kind)
  })

  const config = mkdtempSync(join(scratch, "name-"))
  const named = (kind: string): string =>
    Bun.spawnSync(["bun", join(root, "packages", "scripts", "src", "name", "index.ts"), kind], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
      stderr: "pipe",
      stdout: "pipe",
    })
      .stdout.toString()
      .trim()
  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<[string, (name: string, worker: string) => string[]]>([
    ["worker", (name) => ["worker", name, "b.md"]],
    ["runner", (name) => ["runner", name, "b.md"]],
    ["reviewer", (name, worker) => ["column", "reviewer", name, worker, "w1:p2", "r.md"]],
    ["tester", (name, worker) => ["column", "tester", name, worker, "w1:p2", "t.md"]],
    ["probe", (name) => ["column", "probe", name, "ops", "w1:p2", "p.md"]],
  ])(
    "a spawn of each kind under the name bun run name gives writes that name and its kind (#966): %s",
    async (kind, argsOf) => {
      const name = named(kind)
      const checker = kind === "reviewer" || kind === "tester"
      const worker = checker ? named("worker") : ""
      const args = argsOf(name, worker)
      expect(name).toMatch(new RegExp(`^[${ID_ALPHABET}]{6}-${kind}$`))
      const r = await spawn(args, [])
      expect(r.code, args.join(" ")).toBe(0)
      expect(r.roster?.slice(0, 3)).toEqual(["set", name, `kind=${kind}`])
      // a checker of an id-named worker links to it with no roster entry to read, and a probe with no what in its name is titled by its spawner
      if (checker) expect(r.roster).toContain(`worker=${worker}`)
      if (kind === "probe") expect(r.roster).toContain("title=Probe of ops")
    },
  )

  test("every Bash and Python reader of an <id>-<kind> name spells ID_ALPHABET as kinds.ts does", () => {
    for (const file of [
      "scripts/ops/run-slot.sh",
      "scripts/ops/unstick/run.py",
      "scripts/spawn.sh",
    ])
      expect(readFileSync(join(root, file), "utf8"), file).toContain(`[${ID_ALPHABET}]{6}-`)
  })

  test.each([
    [
      "worker",
      ["worker", "k3m9px-reviewer", "b.md"],
      "k3m9px-reviewer reads as a reviewer, not a worker",
    ],
    [
      "runner",
      ["runner", "k3m9px-worker", "b.md"],
      "k3m9px-worker reads as a worker, not a runner",
    ],
    [
      "column",
      ["column", "reviewer", "k3m9px-worker", "worker-a", "w1:p2", "r.md"],
      "k3m9px-worker reads as a worker, not a reviewer",
    ],
  ])("a %s start refuses a name that reads as another kind, naming both", async (_, args, why) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${why}: bun run name `)
    expect(placing(r)).toEqual([])
  })

  test.each([
    [
      "worker",
      ["worker", "anne-liaison", "b.md"],
      "anne-liaison gives no kind: bun run name worker",
    ],
    ["runner", ["runner", "night-watch", "b.md"], "night-watch gives no kind: bun run name runner"],
    [
      "column",
      ["column", "tester", "herdr-check", "worker-a", "w1:p2", "t.md"],
      "herdr-check gives no kind: bun run name tester",
    ],
  ])("a %s start refuses a new name that gives no kind", async (_, args, why) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${why} gives one`)
    expect(placing(r)).toEqual([])
  })

  // until the managers start by kind (a later PR), today's names still start them
  test.each<{ args: string[]; kind: string }>([
    {
      args: ["column", "dispatcher", "dispatcher", "ops", "w1:p2", "h.md"],
      kind: "dispatcher",
    },
    { args: ["column", "lead", "builder", "dispatcher", "w1:p2", "l.md"], kind: "builder" },
    { args: ["column", "lead", "ops", "dispatcher", "w1:p2", "l.md"], kind: "ops" },
    { args: ["column", "lead", "planner", "dispatcher", "w1:p2", "l.md"], kind: "planner" },
    { args: ["manager", "optimizer", "o.md"], kind: "optimizer" },
    { args: ["manager", "dispatcher-2", "b.md", "--backend", "glm"], kind: "dispatcher" },
  ])("a manager's own name still starts it: $args.2 as a $kind", async ({ args, kind }) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster?.[2]).toBe(`kind=${kind}`)
  })

  test("a resume keeps a name that gives no kind, reading its kind from the roster", async () => {
    const r = await spawn(
      ["resume", "anne-liaison", root],
      [],
      {
        ROSTER_JSON: rosterOf([
          { kind: "worker", name: "anne-liaison", role: "worker", status: "working", task: "t" },
        ]),
      },
      undefined,
      { name: "anne-liaison", backend: "claude" },
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume anne-liaison ",
    )
    expect(r.roster?.slice(0, 3)).toEqual(["set", "anne-liaison", "kind=worker"])
  })

  test("a resume keeps the roster's kind over the name's, and reads an <id>-<kind> name with no entry by its last word", async () => {
    const roster = await spawn(
      ["resume", "k3m9px-worker", root],
      [],
      {
        ROSTER_JSON: rosterOf([
          { kind: "reviewer", name: "k3m9px-worker", role: "worker", status: "working", task: "t" },
        ]),
      },
      undefined,
      { name: "k3m9px-worker", backend: "claude" },
    )
    expect(roster.code).toBe(0)
    expect(launchAfterRm(roster)).toStartWith(
      "(env PLAYGROUND_ROLE=reviewer claude --resume k3m9px-worker ",
    )
    const bare = await spawn(["resume", "k3m9px-tester", root], [], {}, undefined, {
      name: "k3m9px-tester",
      backend: "claude",
    })
    expect(bare.code).toBe(0)
    expect(launchAfterRm(bare)).toStartWith(
      "(env PLAYGROUND_ROLE=tester claude --resume k3m9px-tester ",
    )
    expect(bare.roster?.slice(0, 3)).toEqual(["set", "k3m9px-tester", "kind=tester"])
  })

  test("a resume reads the roster's kind first, so a name with no role prefix reopens as its kind", async () => {
    const r = await spawn(
      ["resume", "k3v9q2-wizard", root],
      [],
      {
        ROSTER_JSON: rosterOf([
          {
            kind: "reviewer",
            name: "k3v9q2-wizard",
            role: "worker",
            status: "working",
            task: "t",
          },
        ]),
      },
      undefined,
      { name: "k3v9q2-wizard", backend: "claude" },
    )
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toStartWith(
      "(env PLAYGROUND_ROLE=reviewer claude --resume k3v9q2-wizard ",
    )
    expect(r.roster?.slice(0, 3)).toEqual(["set", "k3v9q2-wizard", "kind=reviewer"])
  })

  test("a resume with no kind reads the old name as today, and one with neither is refused", async () => {
    const old = await spawn(["resume", "worker-greed", root], [], {}, undefined, {
      name: "worker-greed",
      backend: "claude",
    })
    expect(launchAfterRm(old)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume worker-greed ",
    )
    expect(old.roster?.slice(0, 3)).toEqual(["set", "worker-greed", "kind=worker"])
    const offList = await spawn(
      ["resume", "worker-greed", root],
      [],
      { ROSTER_JSON: rosterOf([{ kind: "wizard", name: "worker-greed" }]) },
      undefined,
      { name: "worker-greed", backend: "claude" },
    )
    expect(launchAfterRm(offList)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume worker-greed ",
    )
    const none = await spawn(["resume", "k3v9q2-wizard", root, "--backend", "claude"], [])
    expect(none.code).toBe(1)
    expect(none.err).toContain(
      "k3v9q2-wizard is not a factory session's name, and the roster gives it no kind",
    )
  })

  test("a checker whose entry holds a pr takes its title too, since roster.ts sets one there (#2161)", async () => {
    const r = await spawn(["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"], [], {
      ROSTER_JSON: rosterOf([
        { name: "reviewer-x", pr: "https://github.com/o/r/pull/1", task: "t", title: "" },
      ]),
    })
    expect(r.code).toBe(0)
    expect(r.roster).toContain("title=Plain test work")
  })

  test("a checker's worker link is written for a worker the roster gives the worker kind", async () => {
    const r = await spawn(
      ["column", "reviewer", "reviewer-x", "x7mh4d-worker", "w1:p2", "r.md"],
      [],
      {
        ROSTER_JSON: rosterOf([{ kind: "worker", name: "x7mh4d-worker" }]),
      },
    )
    expect(r.code).toBe(0)
    expect(r.roster).toContain("worker=x7mh4d-worker")
    const lead = await spawn(["column", "reviewer", "reviewer-x", "builder", "w1:p2", "r.md"], [])
    expect(lead.roster?.some((arg) => arg.startsWith("worker="))).toBe(false)
  })
})

describe("manager starts the first dispatcher in a workspace of its own", () => {
  test("on this machine's own login, as the first dispatcher, talking to the owner and reporting to no session", async () => {
    const r = await spawn(["manager", "dispatcher", "b.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster).toContain("kind=dispatcher")
    expect(r.roster).not.toContain("slot=2")
    const launch = launchAfterRm(r)
    expect(launch).toContain(
      "You are dispatcher, the Playground factory's dispatcher; you work with the owner, who talks to you here and in the Dashboard's chat.",
    )
    expect(launch).not.toContain("you report to")
    expect(launch).not.toContain("briefs you")
  })

  test("the second dispatcher still needs GLM or a second account", async () => {
    const r = await spawn(["manager", "dispatcher-2", "b.md"], [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("dispatcher-2, the second dispatcher, runs on --backend glm")
  })
})
