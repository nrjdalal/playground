import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { OLD } from "../old-names"
import {
  bin,
  fake,
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
  TOKEN,
  typed,
  usage,
  workers,
  zai,
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

// A manager with a workspace of its own: OLD.dispatcher-2, the second dispatcher, beside OLD.dispatcher in the leads worktree.
describe("a manager starts in a workspace of its own, in the leads worktree", () => {
  const lookup = `tk="$(security find-generic-password -s playground-glm -a zai -w)" || exit 1; [ -n "$tk" ] || { echo "The playground-glm item for zai holds an empty token; save it again with playground accounts add --provider glm --label zai, then respawn." >&2; exit 1; }; ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic ANTHROPIC_AUTH_TOKEN="$tk" ANTHROPIC_DEFAULT_OPUS_MODEL='glm-5.3-flash[1m]' ANTHROPIC_DEFAULT_SONNET_MODEL='glm-5.3-flash[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash ENABLE_TOOL_SEARCH=true `
  const leads = (home: string) => join(home, "code", "factory", ".claude", "worktrees", "leads")
  const pinOf = (r: Awaited<ReturnType<typeof spawn>>, name: string) =>
    readFileSync(join(r.home, ".playground", "backends", name), "utf8").trim()

  test(`${OLD.dispatcher}-2 starts as a dispatcher on GLM, in a workspace named for it`, async () => {
    const r = await spawn(
      ["manager", `${OLD.dispatcher}-2`, `brief-${OLD.dispatcher}-2.md`, "--backend", "glm"],
      others(3),
    )
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      leads(r.home),
      "--label",
      `${OLD.dispatcher}-2`,
      "--no-focus",
    ])
    const command = launchAfterRm(r)
    expect(command).toStartWith(
      `(${lookup}env PLAYGROUND_ROLE=dispatcher claude -n ${OLD.dispatcher}-2 `,
    )
    expect(command).toContain(" --model 'glm-5.3-flash[1m]' --effort high ")
    // The second dispatcher passes work to OLD.dispatcher while it is live (brief-OLD.dispatcher-2.md), so OLD.dispatcher is who it answers to.
    expect(command).toContain(
      `You are ${OLD.dispatcher}-2, the Playground factory's dispatcher; dispatcher briefs you`,
    )
    expect(command).toContain(`~/.playground/brief-${OLD.dispatcher}-2.md`)
    expect(command).not.toContain("Report to")
    expect(pinOf(r, `${OLD.dispatcher}-2`)).toBe("glm")
    expect(r.roster).toEqual([
      "set",
      `${OLD.dispatcher}-2`,
      "kind=dispatcher",
      "surface=",
      `task=brief-${OLD.dispatcher}-2.md`,
    ])
  })

  // Only the dispatcher takes a second account, or GLM where it is set up. On Claude it runs on a second account, so OLD.dispatcher's own usage never pays for both.
  test(`${OLD.dispatcher}-2 starts on Claude as a second account with --account, on Opus`, async () => {
    const r = await spawn(
      [
        "manager",
        `${OLD.dispatcher}-2`,
        `brief-${OLD.dispatcher}-2.md`,
        "--account",
        "acme@example.net",
      ],
      [],
    )
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      leads(r.home),
      "--label",
      `${OLD.dispatcher}-2`,
      "--no-focus",
    ])
    const command = launchAfterRm(r)
    expect(command).toContain(
      `CLAUDE_CODE_OAUTH_TOKEN="$tk" env PLAYGROUND_ROLE=dispatcher claude -n ${OLD.dispatcher}-2 --model claude-opus-5-5 `,
    )
    expect(command).not.toContain("api.z.ai")
    expect(pinOf(r, `${OLD.dispatcher}-2`)).toBe("claude")
  })

  test.each([
    { label: "no --backend and no --account", extra: [] as string[] },
    { label: "--backend claude and no --account", extra: ["--backend", "claude"] },
  ])(`${OLD.dispatcher}-2 with $label is refused before herdr runs`, async ({ extra }) => {
    const r = await spawn(
      ["manager", `${OLD.dispatcher}-2`, `brief-${OLD.dispatcher}-2.md`, ...extra],
      [],
    )
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      `${OLD.dispatcher}-2, the second dispatcher, runs on --backend glm, or on Claude with --account <email>, a second account`,
    )
  })

  test(`a resume of ${OLD.dispatcher}-2 reopens it as a dispatcher on GLM, from its pin`, async () => {
    const r = await spawn(["resume", `${OLD.dispatcher}-2`, root], [], {}, undefined, {
      name: `${OLD.dispatcher}-2`,
      backend: "glm",
    })
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      `${OLD.dispatcher}-2`,
      "--no-focus",
    ])
    expect(launchAfterRm(r)).toStartWith(
      `(${lookup}env PLAYGROUND_ROLE=dispatcher claude --resume ${OLD.dispatcher}-2 -n ${OLD.dispatcher}-2 `,
    )
    expect(r.roster).toContain("kind=dispatcher")
  })

  test(`a resume of ${OLD.dispatcher}-2 whose pin reads claude, with no --account, is refused before herdr runs`, async () => {
    const r = await spawn(["resume", `${OLD.dispatcher}-2`, root], [], {}, undefined, {
      name: `${OLD.dispatcher}-2`,
      backend: "claude",
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      `${OLD.dispatcher}-2, the second dispatcher, runs on --backend glm, or on Claude with --account <email>, a second account`,
    )
  })

  test(`a resume of ${OLD.dispatcher}-2 whose pin reads claude reopens it on the --account it is given`, async () => {
    const r = await spawn(
      ["resume", `${OLD.dispatcher}-2`, root, "--account", "acme@example.net"],
      [],
      {},
      undefined,
      { name: `${OLD.dispatcher}-2`, backend: "claude" },
    )
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toContain(
      `CLAUDE_CODE_OAUTH_TOKEN="$tk" env PLAYGROUND_ROLE=dispatcher claude --resume ${OLD.dispatcher}-2 -n ${OLD.dispatcher}-2 `,
    )
  })

  const managers = [
    {
      label: `${OLD.dispatcher}-2`,
      args: ["manager", `${OLD.dispatcher}-2`, "b.md", "--backend", "glm"] as string[],
    },
    { label: "optimizer", args: ["manager", "optimizer", "b.md"] as string[] },
  ]
  const git = (dir: string, ...args: string[]) => {
    const r = Bun.spawnSync([
      "git",
      "-C",
      dir,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      ...args,
    ])
    expect(r.exitCode).toBe(0)
    return r.stdout.toString().trim()
  }
  // The factory's checkout as a fresh install leaves it: a clone on main of an origin that also has canary, with no local canary and no leads worktree yet; seed is where a later push to origin's canary is made.
  const checkout = (home: string) => {
    const seed = join(home, "seed")
    mkdirSync(seed, { recursive: true })
    git(seed, "init", "-q", "-b", "main")
    git(seed, "commit", "-q", "--allow-empty", "-m", "seed")
    git(seed, "branch", "canary")
    git(home, "init", "-q", "--bare", join(home, "origin.git"))
    git(seed, "push", "-q", join(home, "origin.git"), "main", "canary")
    git(home, "clone", "-q", join(home, "origin.git"), join(home, "code", "factory"))
  }
  // The installs the fake bun was handed, through the repo's own run-slot.
  const installs = (home: string) =>
    existsSync(join(home, "bun-install.log"))
      ? readFileSync(join(home, "bun-install.log"), "utf8").trim().split("\n")
      : []

  // A fresh checkout's first dispatcher start was refused, since nothing had made the leads worktree yet; it is cut on canary, the branch ops-tick's canary-pull keeps current, as the factory's own leads is.
  test.each(managers)(
    "$label with no leads worktree cuts one on canary, tracking origin's, and starts in it",
    async ({ args }) => {
      const r = await spawn(args, [], { NO_LEADS: "1" }, undefined, undefined, checkout)
      expect(r.err).not.toContain("is not a folder")
      expect(r.code).toBe(0)
      expect(opened(r)).toContain(leads(r.home))
      expect(readFileSync(join(leads(r.home), ".git"), "utf8")).toStartWith("gitdir: ")
      expect(git(leads(r.home), "symbolic-ref", "HEAD")).toBe("refs/heads/canary")
      expect(git(leads(r.home), "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/canary")
      expect(installs(r.home)).toEqual([
        `install --frozen-lockfile --ignore-scripts --cwd ${leads(r.home)}`,
      ])
      // canary-pull's own fast-forward then moves it to origin's newer canary.
      const seed = join(r.home, "seed")
      git(seed, "checkout", "-q", "canary")
      git(seed, "commit", "-q", "--allow-empty", "-m", "newer")
      git(seed, "push", "-q", join(r.home, "origin.git"), "canary")
      git(leads(r.home), "pull", "--ff-only", "-q")
      expect(git(leads(r.home), "rev-parse", "HEAD")).toBe(git(seed, "rev-parse", "HEAD"))
    },
  )

  // A restore runs spawn.sh from launchd, on /usr/bin:/bin with no bun, and a missing leads is cut there too.
  test("on launchd's PATH, with no bun on it, a new leads worktree installs with bun from its install folder", async () => {
    const noBun = join(scratch, "bin-no-bun")
    mkdirSync(noBun, { recursive: true })
    for (const f of readdirSync(bin)) {
      if (f !== "bun" && !existsSync(join(noBun, f))) symlinkSync(join(bin, f), join(noBun, f))
    }
    const r = await spawn(
      ["manager", "optimizer", "b.md"],
      [],
      { NO_LEADS: "1", PATH: `${noBun}:/usr/bin:/bin` },
      script,
      undefined,
      (home) => {
        checkout(home)
        mkdirSync(join(home, ".bun", "bin"), { recursive: true })
        symlinkSync(join(bin, "bun"), join(home, ".bun", "bin", "bun"))
        // run-slot where an earlier round looked for it, so a bare bun is what that round trips on
        mkdirSync(join(home, ".playground", "ops"), { recursive: true })
        symlinkSync(
          join(root, "scripts", "ops", "run-slot.sh"),
          join(home, ".playground", "ops", "run-slot.sh"),
        )
      },
    )
    expect(r.err).not.toContain("failed")
    expect(r.code).toBe(0)
    expect(installs(r.home)).toEqual([
      `install --frozen-lockfile --ignore-scripts --cwd ${leads(r.home)}`,
    ])
  })

  // A local canary made by hand tracks nothing, so canary-pull's fast-forward would fail on it.
  test("a local canary with no upstream is cut and set to track origin's", async () => {
    const r = await spawn(
      ["manager", "optimizer", "b.md"],
      [],
      { NO_LEADS: "1" },
      undefined,
      undefined,
      (home) => {
        checkout(home)
        git(join(home, "code", "factory"), "branch", "--no-track", "canary", "origin/canary")
      },
    )
    expect(r.code).toBe(0)
    expect(git(leads(r.home), "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/canary")
  })

  test.each(managers)(
    "$label whose new leads worktree fails to install is refused before herdr runs, the worktree removed for the next start",
    async ({ args }) => {
      const r = await spawn(
        args,
        [],
        { FAKE_INSTALL_FAIL: "1", NO_LEADS: "1" },
        undefined,
        undefined,
        checkout,
      )
      expect(r.code).toBe(1)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("bun install in the new leads worktree")
      expect(r.err).toContain("lockfile is frozen")
      expect(existsSync(leads(r.home))).toBe(false)
      expect(git(join(r.home, "code", "factory"), "worktree", "list")).not.toContain("leads")
    },
  )

  test.each(managers)(
    "$label with no leads worktree and no git checkout to cut it from is refused before herdr runs",
    async ({ args }) => {
      const r = await spawn(args, [], { NO_LEADS: "1" })
      expect(r.code).toBe(1)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("git worktree add")
      expect(r.err).toContain("/code/factory/.claude/worktrees/leads")
      expect(existsSync(leads(r.home))).toBe(false)
    },
  )

  test.each(managers)(
    "$label with a leads path that is not a folder is refused before herdr runs",
    async ({ args }) => {
      const r = await spawn(args, [], { NO_LEADS: "1" }, undefined, undefined, (home) => {
        checkout(home)
        mkdirSync(dirname(leads(home)), { recursive: true })
        writeFileSync(leads(home), "")
      })
      expect(r.code).toBe(1)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("/code/factory/.claude/worktrees/leads is not a folder")
    },
  )

  test(`a live ${OLD.dispatcher}-2 refuses a second start under its name`, async () => {
    const r = await spawn(
      ["manager", `${OLD.dispatcher}-2`, `brief-${OLD.dispatcher}-2.md`, "--backend", "glm"],
      [{ name: `${OLD.dispatcher}-2`, pid: 4100 }],
    )
    expect(r.code).toBe(3)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`a live session already holds the name ${OLD.dispatcher}-2 (pid 4100)`)
  })

  test("a manager of another name is refused: a worker", async () => {
    const r = await spawn(["manager", "worker-brave-otter", "b.md", "--backend", "glm"], [])
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "a manager in a workspace of its own is the first dispatcher (sessions.names' dispatcher), the second (an <id>-dispatcher, or sessions.names' dispatcher with -2), the optimizer, the builder, ops or the planner",
    )
    expect(r.err).toContain("roster.ts set <name> kind=<kind>")
  })

  test.each([
    { label: "with no brief", args: ["manager", "optimizer"] },
    { label: "with a word after the brief", args: ["manager", "optimizer", "b.md", "extra"] },
  ])("a manager $label prints the usage before herdr runs", async ({ args }) => {
    const r = await spawn([...args], [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("spawn.sh manager")
  })

  // The optimizer is a manager that reports to OLD.dispatcher and runs on Claude (brief-optimizer.md), so it starts as a lead.
  test("the optimizer starts as a lead on Claude, reporting to the dispatcher", async () => {
    const r = await spawn(["manager", "optimizer", "brief-optimizer.md"], others(3))
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      leads(r.home),
      "--label",
      "optimizer",
      "--no-focus",
    ])
    const command = launchAfterRm(r)
    expect(command).toStartWith(
      "(env PLAYGROUND_ROLE=lead claude -n optimizer --model claude-opus-5-5 --effort high ",
    )
    expect(command).toContain(
      `You are optimizer, a lead in the Playground factory; you report to dispatcher.`,
    )
    expect(command).toContain("~/.playground/brief-optimizer.md")
    expect(command).toContain("(to: dispatcher)")
    expect(pinOf(r, "optimizer")).toBe("claude")
    expect(r.roster).toEqual([
      "set",
      "optimizer",
      "kind=optimizer",
      "surface=",
      "task=brief-optimizer.md",
    ])
  })

  test("a resume of the optimizer reopens it as a lead, on the backend its pin names", async () => {
    const r = await spawn(["resume", "optimizer", root], [], {}, undefined, {
      name: "optimizer",
      backend: "claude",
    })
    expect(r.code).toBe(0)
    expect(opened(r)).toEqual([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      "optimizer",
      "--no-focus",
    ])
    expect(launchAfterRm(r)).toStartWith(
      "(env PLAYGROUND_ROLE=lead claude --resume optimizer -n optimizer --model claude-opus-5-5 ",
    )
    expect(r.roster).toContain("kind=optimizer")
  })
})

// macOS types at most MAX_CANON 1024 bytes into a pane, and a GLM worker's launch crossed it at 1,025 (OLD.ops measured 17 Oct), so the launch runs from a file and the typed line names it alone.
describe("the typed launch line stays under the 1,024-byte typed-line limit", () => {
  // A name as long as herdr takes (32 characters) and a brief longer than any factory session carries, so the cap holds for whatever the leads write.
  const NAME = "worker-a-long-name-of-many-words"
  const BRIEF =
    "briefs/a-most-unusually-long-brief-file-name-no-lead-would-write-but-spawn-takes.md"
  const email = "acme@example.net"

  // Each row is one object: bun's test.each appends its done callback after a spread tuple, and a 4th tuple element would take it.
  const rows: {
    args: string[]
    files?: Record<string, string>
    label: string
    pin?: { name: string; backend: string }
  }[] = [
    { label: "a worker", args: ["worker", NAME, BRIEF] },
    { label: "a glm worker", args: ["worker", NAME, BRIEF, "--backend", "glm"] },
    { label: "an account worker", args: ["worker", NAME, BRIEF, "--account", email] },
    {
      label: "a checker column",
      args: ["column", "reviewer", "reviewer-long-name-of-many-words", "worker-x", "w1:p2", BRIEF],
    },
    {
      label: "a resume with a brief",
      args: ["resume", NAME, root, "--brief", "handoffs/restart-brief.md"],
      pin: { name: NAME, backend: "claude" },
      files: { BRIEF_FILE: "handoffs/restart-brief.md" },
    },
  ]
  test.each(rows)(
    "$label types a short line that names a 0700 file holding the launch",
    async ({ label, args, pin, files }) => {
      const r = await spawn(args, [], files ?? {}, undefined, pin)
      expect(r.code, r.err).toBe(0)
      const line = typed(r)
      expect(line.length).toBeLessThan(1_024)
      const name = label === "a checker column" ? String(args[2]) : String(args[1])
      const file = join(r.home, ".playground", "launch", `${name}.sh`)
      expect(line).toBe(`exec bash '${file}'`)
      expect(statSync(file).mode & 0o777).toBe(0o700)
      expect(statSync(dirname(file)).mode & 0o777).toBe(0o700)
      const launch = launchOf(r)
      expect(launch).toStartWith('rm -f -- "$0"\n')
      expect(launch).toContain("PLAYGROUND_ROLE=")
      expect(launch).toContain(
        label === "a resume with a brief" ? "handoffs/restart-brief.md" : BRIEF,
      )
      expect(launch).not.toContain(TOKEN)
      expect([...placing(r).flat(), r.out, r.err].join("\n")).not.toContain(TOKEN)
    },
  )
})

describe("a launch file removes itself once its launch starts", () => {
  test("so no past launch outlives its pane to be rerun past spawn.sh's refusals", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.code).toBe(0)
    const file = join(r.home, ".playground", "launch", "worker-brave-otter.sh")
    // The harness PATH, so the launch's claude is the fake and nothing real starts.
    const run = Bun.spawn(["bash", file], {
      env: { ...process.env, HOME: r.home, PATH: `${bin}:${process.env.PATH}` },
      stderr: "ignore",
      stdout: "ignore",
    })
    await run.exited
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(join(r.home, "claude.args"), "utf8")).toContain("-n worker-brave-otter")
  })
})

// The factory's hooks read PLAYGROUND_REPO before the session's own folder, so a session spawn.sh starts runs the main checkout's guards, from a worktree or outside any OLD.dispatcher checkout.
describe("a launch names the main checkout in PLAYGROUND_REPO", () => {
  test("spawn.sh run from a worktree names the checkout the worktree belongs to, and the session gets it", async () => {
    const main = realpathSync(mkdtempSync(join(scratch, "main-917-")))
    const git = (...args: string[]) =>
      expect(Bun.spawnSync(["git", ...args], { cwd: main, stderr: "ignore" }).exitCode).toBe(0)
    mkdirSync(join(main, "scripts"))
    writeFileSync(join(main, "scripts", "spawn.sh"), readFileSync(script))
    // spawn.sh resolves its data folder through the checkout's own resolver.
    mkdirSync(join(main, "packages", "env", "src"), { recursive: true })
    for (const file of ["aliases.ts", "data-dir.ts"])
      writeFileSync(
        join(main, "packages", "env", "src", file),
        readFileSync(join(root, "packages", "env", "src", file)),
      )
    git("init", "-q", "-b", "main")
    git("add", ".")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x")
    const worktree = join(main, "wt")
    git("worktree", "add", "-q", "-b", "side", worktree)
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      join(worktree, "scripts", "spawn.sh"),
    )
    expect(r.code, r.err).toBe(0)
    expect(opened(r)?.[3]).toBe(worktree)
    const launch = launchOf(r)
    expect(launch.split("\n")).toContain(`export PLAYGROUND_REPO=${main}`)
    // a claude that records the PLAYGROUND_REPO it was started with
    const shim = join(scratch, "bin-917")
    mkdirSync(shim, { recursive: true })
    writeFileSync(
      join(shim, "claude"),
      '#!/bin/bash\nprintf %s "$PLAYGROUND_REPO" > "$HOME/claude.repo"\n',
    )
    chmodSync(join(shim, "claude"), 0o755)
    const file = join(r.home, ".playground", "launch", "worker-brave-otter.sh")
    const run = Bun.spawn(["bash", file], {
      env: {
        ...process.env,
        HOME: r.home,
        PLAYGROUND_REPO: "",
        PATH: `${shim}:${bin}:${process.env.PATH}`,
      },
      stderr: "ignore",
      stdout: "ignore",
    })
    expect(await run.exited).toBe(0)
    expect(readFileSync(join(r.home, "claude.repo"), "utf8")).toBe(main)
  })
})
