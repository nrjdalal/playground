import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { OLD } from "../old-names"
import {
  bin,
  launchAfterRm,
  launchOf,
  opened,
  others,
  placing,
  root,
  scratch,
  script,
  Session,
  spawn,
  Spawned,
  typed,
  workers,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

describe("under the gates it spawns", () => {
  test(`a worker opens its own workspace in the ${OLD.dispatcher} checkout and is put on the roster`, async () => {
    const r = await spawn(["worker", "worker-brave-otter", "brief-x.md"], others(5))
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      "worker-brave-otter",
      "--no-focus",
    ])
    const command = launchAfterRm(r)
    expect(command).toStartWith(
      `(env PLAYGROUND_ROLE=worker claude -n worker-brave-otter --model claude-opus-5-5 --effort high --settings `,
    )
    expect(command).toContain("~/.playground/brief-x.md")
    expect(command).toContain("(to: builder)")
    expect(r.roster).toEqual([
      "set",
      "worker-brave-otter",
      "kind=worker",
      "surface=",
      "title=Plain test work",
      "task=brief-x.md",
    ])
  })

  // a manager respawned under a new name holds its kind's seat, so a new worker or runner reports to it.
  test.each([
    { mode: "worker", name: "worker-brave-otter", kind: "builder", manager: "x7mh4d-builder" },
    { mode: "runner", name: "runner-brave-otter", kind: "ops", manager: "p4nb7c-ops" },
  ])("a $mode reports to the roster's live $kind", async ({ mode, name, kind, manager }) => {
    const roster = {
      agents: [{ kind, name: manager, role: "manager", status: "working", task: "t" }],
    }
    const r = await spawn([mode, name, "b.md"], [], { ROSTER_JSON: JSON.stringify(roster) })
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain(`you report to ${manager}.`)
    expect(launchOf(r)).toContain(`(to: ${manager})`)
  })

  const kinds = {
    agents: [
      { kind: "builder", name: "x7mh4d-builder", role: "manager", status: "starting", task: "t" },
      {
        kind: "optimizer",
        name: "m2wq8z-optimizer",
        role: "manager",
        status: "starting",
        task: "t",
      },
      { kind: "worker", name: "k3v9q2-worker", role: "worker", status: "working", task: "t" },
    ],
  }
  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<[string, string[], (r: Spawned) => void]>([
    [
      "a lead",
      ["column", "lead", "x7mh4d-builder", OLD.dispatcher, "w1:p2", "l.md"],
      (lead) => {
        expect(lead.code).toBe(0)
        expect(lead.roster?.slice(0, 3)).toEqual(["set", "x7mh4d-builder", "kind=builder"])
        expect(launchAfterRm(lead)).toContain("env PLAYGROUND_ROLE=lead claude -n x7mh4d-builder")
      },
    ],
    [
      "an optimizer",
      ["manager", "m2wq8z-optimizer", "b.md"],
      (optimizer) => {
        expect(optimizer.code).toBe(0)
        expect(optimizer.roster?.slice(0, 3)).toEqual(["set", "m2wq8z-optimizer", "kind=optimizer"])
      },
    ],
    [
      "a worker refused",
      ["column", "lead", "k3v9q2-worker", OLD.dispatcher, "w1:p2", "l.md"],
      (worker) => {
        expect(worker.code).toBe(1)
        expect(worker.err).toContain("a lead is a builder, ops or planner by its roster kind")
        expect(worker.err).toContain("roster.ts set <name> kind=<kind>")
      },
    ],
  ])(
    "a lead or an optimizer under a new name starts by its roster kind: %s",
    async (_, args, check) => {
      check(await spawn(args, [], { ROSTER_JSON: JSON.stringify(kinds) }))
    },
  )

  // a manager places by its <id>-<kind> name's suffix even with no roster row, and today's names still place as their kinds.
  test.each([
    { name: "x7mh4d-ops", kind: "ops" },
    { name: "x7mh4d-planner", kind: "planner" },
    { name: OLD.ops, kind: "ops" },
  ])("a lead named $name with no roster row starts as $kind", async ({ name, kind }) => {
    const r = await spawn(["column", "lead", name, OLD.dispatcher, "w1:p2", "l.md"], [])
    expect(r.code).toBe(0)
    expect(r.roster?.slice(0, 3)).toEqual(["set", name, `kind=${kind}`])
  })

  test("an <id>-dispatcher column starts as the dispatcher, and any other name is refused", async () => {
    const r = await spawn(
      ["column", "dispatcher", "m4n7vw-dispatcher", "x7mh4d-builder", "w1:p2", "l.md"],
      [],
    )
    expect(r.code).toBe(0)
    expect(r.roster?.slice(0, 3)).toEqual(["set", "m4n7vw-dispatcher", "kind=dispatcher"])
    expect(launchAfterRm(r)).toContain("env PLAYGROUND_ROLE=dispatcher claude -n m4n7vw-dispatcher")
    const other = await spawn(
      ["column", "dispatcher", "x7mh4d-ops", OLD.dispatcher, "w1:p2", "l.md"],
      [],
    )
    expect(other.code).toBe(1)
    expect(other.err).toContain("the dispatcher is an <id>-dispatcher")
  })

  const dispatchers = {
    agents: [
      {
        kind: "dispatcher",
        name: "m4n7vw-dispatcher",
        role: "manager",
        status: "working",
        task: "t",
      },
    ],
  }
  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<[string, string[], Session[], (r: Spawned) => void]>([
    [
      "the second on glm",
      ["manager", "q8r2tx-dispatcher", "b.md", "--backend", "glm"],
      others(3),
      (r) => {
        expect(r.code).toBe(0)
        expect(launchAfterRm(r)).toContain(
          `You are q8r2tx-dispatcher, the Playground factory's dispatcher; m4n7vw-dispatcher briefs you`,
        )
        expect(r.roster).toContain("slot=2")
        expect(r.roster?.slice(0, 3)).toEqual(["set", "q8r2tx-dispatcher", "kind=dispatcher"])
      },
    ],
    [
      "the second with no backend refused",
      ["manager", "q8r2tx-dispatcher", "b.md"],
      [],
      (bare) => {
        expect(bare.code).toBe(1)
        expect(bare.err).toContain(
          "q8r2tx-dispatcher, the second dispatcher, runs on --backend glm",
        )
      },
    ],
    [
      "the first starts as the first, with no slot",
      ["manager", "m4n7vw-dispatcher", "b.md"],
      [],
      (first) => {
        expect(first.code, first.err).toBe(0)
        expect(launchAfterRm(first)).toContain(
          "You are m4n7vw-dispatcher, the Playground factory's dispatcher; you work with the owner",
        )
        expect(first.roster).not.toContain("slot=2")
      },
    ],
  ])(
    "a second dispatcher under an <id>-dispatcher name answers to the first, records slot 2 and needs a second account, and the first starts as itself: %s",
    async (_, args, sessions, check) => {
      check(await spawn(args, sessions, { ROSTER_JSON: JSON.stringify(dispatchers) }))
    },
  )

  // Claude Code makes its sessions folder only once it runs a session, so a fresh Mac has none.
  test("a Mac with no sessions folder reads no live session, and the first dispatcher starts", async () => {
    const r = await spawn(["manager", "dispatcher", "b.md"], [], {
      NO_ALIASES: "1",
      NO_REGISTRY: "1",
    })
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain("claude -n dispatcher")
  })

  test("a sessions path it cannot list still refuses", async () => {
    const r = await spawn(
      ["manager", "dispatcher", "b.md"],
      [],
      { NO_ALIASES: "1", NO_REGISTRY: "1" },
      undefined,
      undefined,
      (home) => {
        mkdirSync(join(home, ".claude"), { recursive: true })
        writeFileSync(join(home, ".claude", "sessions"), "")
      },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("spawn.sh refuses dispatcher: it cannot read the live sessions in")
  })

  const folder =
    (...parts: string[]) =>
    (home: string) =>
      mkdirSync(join(home, ...parts), { recursive: true })

  test("a worker --in a folder under the code root opens there", async () => {
    const args = ["worker", "worker-calm-heron", "brief-y.md", "--in", "{home}/code/other"]
    const r = await spawn(args, [], {}, undefined, undefined, folder("code", "other"))
    expect(r.code).toBe(0)
    expect(opened(r)?.[3]).toEndWith("/code/other")
  })

  test("a worker --in a folder outside the code root and every org's folder is refused before herdr runs", async () => {
    const args = ["worker", "worker-calm-heron", "brief-y.md", "--in", "{home}/elsewhere"]
    const r = await spawn(args, [], {}, undefined, undefined, folder("elsewhere"))
    expect(r.code).toBe(1)
    expect(r.err).toContain("elsewhere is outside")
    expect(r.err).toContain("the owner's to answer")
    expect(placing(r)).toEqual([])
  })

  test("a worker --in a folder that does not exist is refused", async () => {
    const args = ["worker", "worker-calm-heron", "brief-y.md", "--in", "{home}/code/missing"]
    const r = await spawn(args, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("--in names no folder")
    expect(placing(r)).toEqual([])
  })

  test("a runner refuses --in", async () => {
    const r = await spawn(["runner", "runner-calm-heron", "brief-r.md", "--in", "/tmp"], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--in is for a worker, not runner")
  })

  test("a runner reports to the ops lead", async () => {
    const r = await spawn(["runner", "runner-calm-heron", "brief-r.md"], workers(9))
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toContain("env PLAYGROUND_ROLE=runner claude -n runner-calm-heron")
    expect(launchOf(r)).toContain("(to: ops)")
  })

  test("a checker opens as a column right of the pane it names, nested under its worker", async () => {
    const r = await spawn(
      [
        "column",
        "reviewer",
        "reviewer-brave-otter",
        "worker-brave-otter",
        "w1:p2",
        "brief-reviewer.md",
      ],
      workers(9),
    )
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "pane",
      "split",
      "w1:p2",
      "--direction",
      "right",
      "--cwd",
      root,
      "--no-focus",
    ])
    expect(launchAfterRm(r)).toContain(
      "env PLAYGROUND_ROLE=reviewer claude -n reviewer-brave-otter",
    )
    expect(launchOf(r)).toContain("(to: worker-brave-otter)")
    expect(typed(r)).toStartWith("exec bash '")
    expect(r.roster).toEqual([
      "set",
      "reviewer-brave-otter",
      "kind=reviewer",
      "worker=worker-brave-otter",
      "title=Plain test work",
      "task=brief-reviewer.md",
    ])
  })

  // rows read "You are <name>, a ..." while no title was set; a checker now reads by its worker's title.
  const titled = {
    agents: [
      {
        name: "worker-x",
        role: "worker",
        status: "working",
        task: "t",
        title: "Fix the CSV export",
      },
    ],
  }
  const triage = {
    agents: [
      { name: "reviewer-x", role: "worker", status: "working", task: "t", title: "Review #37" },
    ],
  }
  const reviewerOf = ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"]
  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<[string, string[], Record<string, string>, (r: Spawned) => void]>([
    [
      "a tester",
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md"],
      { NO_TITLE: "1", ROSTER_JSON: JSON.stringify(titled) },
      (tester) => {
        expect(tester.code).toBe(0)
        expect(tester.roster).toContain("title=Test: Fix the CSV export")
      },
    ],
    [
      "a reviewer",
      reviewerOf,
      { NO_TITLE: "1", ROSTER_JSON: JSON.stringify(titled) },
      (reviewer) => expect(reviewer.roster).toContain("title=Review: Fix the CSV export"),
    ],
    [
      "a probe",
      ["column", "probe", "probe-api-sandbox", OLD.ops, "w1:p2", "p.md"],
      {},
      (probe) => expect(probe.roster).toContain("title=Probe: api-sandbox"),
    ],
    [
      "neither title refused",
      reviewerOf,
      { NO_TITLE: "1" },
      (untitled) => {
        expect(untitled.code).toBe(1)
        expect(untitled.cmux).toBeUndefined()
        expect(placing(untitled)).toEqual([])
        expect(untitled.err).toContain("roster.ts set worker-x title=<title>")
      },
    ],
    [
      "its own kept",
      reviewerOf,
      { NO_TITLE: "1", ROSTER_JSON: JSON.stringify(triage) },
      (triaged) =>
        expect(triaged.roster).toEqual(["set", "reviewer-x", "kind=reviewer", "worker=worker-x"]),
    ],
  ])(
    "a checker with no title takes Review: or Test: before its worker's, keeps its own, and is refused with neither; a probe keeps its words-only default: %s",
    async (_, args, env, check) => {
      check(await spawn(args, [], env))
    },
  )

  test("a worker with no title, or one past 40 characters, is refused before anything opens", async () => {
    const none = await spawn(["worker", "worker-brave-otter", "b.md"], [], { NO_TITLE: "1" })
    expect(none.code).toBe(1)
    expect(none.cmux).toBeUndefined()
    expect(placing(none)).toEqual([])
    expect(none.err).toContain('--title "<title>"')
    const long = await spawn(
      [
        "worker",
        "worker-brave-otter",
        "b.md",
        "--title",
        "A title that runs well past forty characters",
      ],
      [],
    )
    expect(long.code).toBe(1)
    expect(long.cmux).toBeUndefined()
    expect(placing(long)).toEqual([])
    expect(long.err).toContain("--title is at most 40 characters")
  })

  test.each([
    ["close", ["close", "worker-brave-otter"]],
    ["move", ["move", "worker-brave-otter"]],
    ["restore", ["restore"]],
    ["runner", ["runner", "runner-calm-heron", "b.md"]],
  ])("a %s refuses --title", async (_, args) => {
    const r = await spawn([...args, "--title", "Plain test work"], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--title is for a worker or a reviewer's or tester's column")
    expect(r.cmux).toBeUndefined()
    expect(placing(r)).toEqual([])
  })

  test("under inscope the title check reads the roster spawn.sh itself edits, ~/.claude's, so a titled entry keeps its own", async () => {
    const r = await spawn(["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"], [], {
      CLAUDE_CONFIG_DIR: "/no/such/inscope/dir",
      INSCOPE_CCD: "/no/such/inscope/dir",
      NO_TITLE: "1",
      ROSTER_JSON: JSON.stringify({
        agents: [
          {
            name: "reviewer-x",
            role: "worker",
            status: "working",
            task: "t",
            title: "Review #37",
          },
        ],
      }),
    })
    expect(r.code).toBe(0)
    expect(r.roster).toEqual(["set", "reviewer-x", "kind=reviewer", "worker=worker-x"])
  })

  // spawn.sh starts nothing in cmux, so a column beside a cmux surface:N is refused before any cmux or herdr call.
  test("a column beside a cmux surface:N is refused, naming #2076", async () => {
    const r = await spawn(["column", "tester", "tester-x", "worker-x", "surface:7", "t.md"], [])
    expect(r.code).toBe(1)
    expect(r.cmux).toBeUndefined()
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("surface:7 is a cmux surface, and spawn.sh starts nothing in cmux")
  })

  test("a resume reopens the session by name in its folder, its role read from its name", async () => {
    const r = await spawn(["resume", "reviewer-brave-otter", root], [], {}, undefined, {
      name: "reviewer-brave-otter",
      backend: "claude",
    })
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      "reviewer-brave-otter",
      "--no-focus",
    ])
    expect(launchAfterRm(r)).toContain(
      "env PLAYGROUND_ROLE=reviewer claude --resume reviewer-brave-otter -n reviewer-brave-otter --model",
    )
  })

  test("run through the skill's link, it opens in this checkout even beside a scripts folder", async () => {
    const tree = join(scratch, "linked", "in")
    mkdirSync(join(scratch, "linked", "scripts"), { recursive: true })
    mkdirSync(join(tree, ".claude", "skills"), { recursive: true })
    symlinkSync(
      join(root, "extensions", "core", "skills", "playbook"),
      join(tree, ".claude", "skills", "playbook"),
    )
    // a template string, since join() would fold the .. parts before any link is followed
    const linked = `${tree}/.claude/skills/playbook/../../../../scripts/spawn.sh`
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {}, linked)
    expect(r.code).toBe(0)
    expect(opened(r)?.[3]).toBe(root)
  })

  test(`${OLD.dispatcher}'s successor is briefed by its lead and reports to no one`, async () => {
    const r = await spawn(["column", "dispatcher", OLD.dispatcher, OLD.ops, "w1:p2", "h.md"], [])
    expect(r.code).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toContain(
      `You are ${OLD.dispatcher}, the Playground factory's dispatcher; ${OLD.ops} briefs you`,
    )
    expect(command).not.toContain("Report to")
    expect(r.roster).toEqual(["set", OLD.dispatcher, "kind=dispatcher", "task=h.md"])
  })

  test("a manager's column names it once: a lead reports to the dispatcher", async () => {
    const r = await spawn(["column", OLD.ops, "w1:p2", "h.md"], [], { BRIEF_FILE: "h.md" })
    expect(r.code).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toContain(`env PLAYGROUND_ROLE=lead claude -n ${OLD.ops}`)
    expect(command).toContain(
      `You are ${OLD.ops}, a lead in the Playground factory; you report to dispatcher`,
    )
    expect(r.roster?.slice(0, 3)).toEqual(["set", OLD.ops, "kind=ops"])
  })

  test("a fresh install's managers start under sessions.names' role words", async () => {
    const r = await spawn(["column", "ops", "w1:p2", "h.md"], [], {
      BRIEF_FILE: "h.md",
      NO_ALIASES: "1",
    })
    expect(r.code).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toContain("env PLAYGROUND_ROLE=lead claude -n ops")
    expect(command).toContain(`You are ops, a lead in the Playground factory; you report to `)
    expect(r.roster?.slice(0, 3)).toEqual(["set", "ops", "kind=ops"])
  })

  test(`a fresh install reads no old name, so ${OLD.ops} is no manager there`, async () => {
    const r = await spawn(["column", OLD.ops, "w1:p2", "h.md"], [], {
      BRIEF_FILE: "h.md",
      NO_ALIASES: "1",
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`${OLD.ops} is no manager`)
  })

  test(`${OLD.dispatcher}'s column names it once, briefed by the session running spawn.sh`, async () => {
    const r = await spawn(
      ["column", OLD.dispatcher, "w1:p2", "h.md"],
      [{ name: OLD.ops, pid: 5100 }],
      {
        BRIEF_FILE: "h.md",
        CLAUDE_PID: "5100",
      },
    )
    expect(r.code).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toContain(`env PLAYGROUND_ROLE=dispatcher claude -n ${OLD.dispatcher}`)
    expect(command).toContain(
      `You are ${OLD.dispatcher}, the Playground factory's dispatcher; ${OLD.ops} briefs you`,
    )
    expect(command).not.toContain("Report to")
    expect(r.roster?.slice(0, 3)).toEqual(["set", OLD.dispatcher, "kind=dispatcher"])
  })

  test("an <id>-dispatcher's column names it once, as the first dispatcher", async () => {
    const r = await spawn(
      ["column", "m4n7vw-dispatcher", "w1:p2", "h.md"],
      [{ name: OLD.ops, pid: 5100 }],
      { BRIEF_FILE: "h.md", CLAUDE_PID: "5100" },
    )
    expect(r.code).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toContain("env PLAYGROUND_ROLE=dispatcher claude -n m4n7vw-dispatcher")
    expect(command).toContain(`${OLD.ops} briefs you`)
    expect(command).not.toContain("Report to")
    expect(r.roster?.slice(0, 3)).toEqual(["set", "m4n7vw-dispatcher", "kind=dispatcher"])
  })

  test("an <id>-ops column names it once and reports to the dispatcher the roster seats", async () => {
    const r = await spawn(["column", "x7mh4d-ops", "w1:p2", "h.md"], [], {
      BRIEF_FILE: "h.md",
      ROSTER_JSON: JSON.stringify({
        agents: [{ kind: "dispatcher", name: "m4n7vw-dispatcher", status: "working", task: "t" }],
      }),
    })
    expect(r.code).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toContain("env PLAYGROUND_ROLE=lead claude -n x7mh4d-ops")
    expect(command).toContain("you report to m4n7vw-dispatcher")
    expect(r.roster?.slice(0, 3)).toEqual(["set", "x7mh4d-ops", "kind=ops"])
  })

  test.each([
    ["no CLAUDE_PID", {}],
    ["a registry with no entry for CLAUDE_PID", { CLAUDE_PID: "5101" }],
  ])(`${OLD.dispatcher}'s short column refuses with %s, naming the long form`, async (_, env) => {
    const r = await spawn(["column", OLD.dispatcher, "w1:p2", "h.md"], [], {
      BRIEF_FILE: "h.md",
      ...env,
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      `column dispatcher ${OLD.dispatcher} <the lead that briefs it> <pane> <brief>`,
    )
  })

  test.each(["worker-x", "reviewer-x"])(
    "a short column refuses %s, which is no manager, naming both forms",
    async (name) => {
      const r = await spawn(["column", name, "w1:p2", "h.md"], [], { BRIEF_FILE: "h.md" })
      expect(r.code).toBe(1)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("column <manager> <pane> <brief>")
      expect(r.err).toContain("column <reviewer|tester|probe|lead|dispatcher> <name> <reports-to>")
    },
  )

  test.each([`${OLD.dispatcher}-2`, "optimizer"])(
    "a short column refuses %s, pointing it to its own workspace",
    async (name) => {
      const r = await spawn(["column", name, "w1:p2", "h.md"], [], { BRIEF_FILE: "h.md" })
      expect(r.code).toBe(1)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain(`spawn.sh manager ${name} <brief>`)
    },
  )

  test("the long column refuses the second dispatcher as the first's (PG-1644)", async () => {
    const r = await spawn(
      ["column", "dispatcher", `${OLD.dispatcher}-2`, OLD.ops, "w1:p2", "h.md"],
      [],
      {
        BRIEF_FILE: "h.md",
      },
    )
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`spawn.sh manager ${OLD.dispatcher}-2 <brief>`)
  })

  test("a reviewer a lead spawns is not nested under the lead", async () => {
    const r = await spawn(
      ["column", "reviewer", "reviewer-changelog-700", OLD.builder, "w1:p2", "b.md"],
      [],
    )
    expect(r.code).toBe(0)
    expect(r.roster).toEqual([
      "set",
      "reviewer-changelog-700",
      "kind=reviewer",
      "title=Plain test work",
      "task=b.md",
    ])
  })

  // the dashboard's schema drops an agent with no task, so a spawned probe went missing from the board. One spawn a case, as in the tests beside it: six in one test passed its 20s on a loaded runner.
  const rosterWith = (agent: Record<string, string>) => ({
    ROSTER_JSON: JSON.stringify({ agents: [{ name: "probe-api", role: "worker", ...agent }] }),
  })
  test.each([
    [
      "a worker takes its brief's file name",
      ["worker", "worker-brave-otter", "b-op-x.md"],
      {},
      ["task=b-op-x.md"],
    ],
    [
      "a probe takes its brief's file name",
      ["column", "probe", "probe-api", OLD.ops, "w1:p2", "p.md"],
      {},
      ["task=p.md"],
    ],
    [
      "a resumed lead takes its role and name",
      ["resume", OLD.planner, root, "--backend", "claude"],
      {},
      [`task=lead ${OLD.planner}`],
    ],
    [
      "a resumed probe takes probe and its name",
      ["resume", "probe-api", root, "--backend", "claude"],
      {},
      ["task=probe probe-api"],
    ],
    [
      "one that holds a task takes none",
      ["column", "probe", "probe-api", OLD.ops, "w1:p2", "p.md"],
      rosterWith({ status: "working", task: "Try the card" }),
      [],
    ],
    [
      "one that holds a pr takes none",
      ["column", "probe", "probe-api", OLD.ops, "w1:p2", "p.md"],
      rosterWith({ pr: "https://github.com/acme/factory/pull/1" }),
      [],
    ],
  ] as [string, string[], Record<string, string>, string[]][])(
    "a new entry takes a task: %s",
    async (_, args, env, want) => {
      const r = await spawn(args, [], env)
      expect(r.roster?.filter((a) => a.startsWith("task="))).toEqual(want)
    },
  )

  test("a resume into a workspace of its own clears the surface a column left", async () => {
    const r = await spawn(["resume", OLD.planner, root, "--backend", "claude"], [])
    expect(r.code).toBe(0)
    expect(r.roster).toContain("surface=")
  })

  test.each([
    ["resume", "ended", ["status=starting"]],
    ["resume", "working", []],
    ["column", "ended", ["status=starting"]],
    ["column", "working", []],
  ])(
    "a %s of a %s row writes %p, so only a row close ended runs again",
    async (mode, status, want) => {
      const name = "reviewer-brave-otter"
      const r = await spawn(
        mode === "resume"
          ? ["resume", name, root]
          : ["column", "reviewer", name, "worker-x", "w1:p2", "r.md"],
        [],
        { ROSTER_JSON: JSON.stringify({ agents: [{ name, status }] }) },
        undefined,
        mode === "resume" ? { name, backend: "claude" } : undefined,
      )
      expect(r.code).toBe(0)
      expect(r.roster?.filter((arg) => arg.startsWith("status="))).toEqual(want)
    },
  )

  test("a resume by session id, as up.py --sessions prints it", async () => {
    const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"
    const r = await spawn(["resume", OLD.builder, root, id], [], {}, undefined, {
      name: OLD.builder,
      backend: "claude",
    })
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toContain(
      `env PLAYGROUND_ROLE=lead claude --resume ${id} -n ${OLD.builder}`,
    )
  })

  test("a roster write that fails after the spawn says the session started, and exits 0", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_ROSTER_BROKEN: "1" })
    expect(r.code).toBe(0)
    expect(placing(r)).not.toEqual([])
    expect(r.err).toContain("worker-brave-otter started, but its roster write failed")
  })

  test("on launchd's PATH, with no bun on it, the roster write runs bun from its install folder", async () => {
    const noBun = join(scratch, "bin-no-bun")
    mkdirSync(noBun, { recursive: true })
    for (const f of readdirSync(bin)) {
      if (f !== "bun" && !existsSync(join(noBun, f))) symlinkSync(join(bin, f), join(noBun, f))
    }
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PATH: `${noBun}:/usr/bin:/bin` },
      script,
      undefined,
      (home) => {
        mkdirSync(join(home, ".bun", "bin"), { recursive: true })
        symlinkSync(join(bin, "bun"), join(home, ".bun", "bin", "bun"))
      },
    )
    expect(r.code).toBe(0)
    expect(r.err).not.toContain("roster write failed")
    expect(r.rosterLog?.[0]).toStartWith("set worker-brave-otter kind=worker")
  })
})
