import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registryOf } from "../../../../../../api/hono/src/lib/dashboard/peers"
import { NO_FACTS, type Pickers } from "../../../../../../api/hono/src/lib/dashboard/transcript"
import {
  answeredSince,
  DISPATCHER,
  DISPATCHER_SECONDARY,
  DISPATCHERS,
  composeWorkers,
  dispatcherSlots,
  feedBySession,
  feedItemOf,
  herdrFeed,
  isLiveRecord,
  isProbe,
  kindOf,
  lightOf,
  liveRecords,
  type LiveProof,
  MAX_GAP_MS,
  MIN_GAP_MS,
  nameOf,
  nextGap,
  questionsBySession,
  roleOf,
  rosterFacts,
  rosterRoleOf,
  secondaryOf,
  sessionOfWorkstream,
  surfacesOf,
} from "../../../../../../api/hono/src/lib/dashboard/workers"
import { setSessionNames } from "../../../../../../packages/config/src/kinds"
import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"
import { OLD, capital } from "../../../../../old-names"
import { SEEDED_NAMES } from "../../../../../session-names"
import { slowChild } from "../../../../../slow-child"
import {
  permissionItem,
  planItem,
  questionItem,
  QUESTION_ID,
  TWO_QUESTION_ID,
  twoQuestionItem,
} from "./feed-fixtures"

// workers.ts sets the names its data folder holds when it loads; the cases name the managers' old names, as a machine past the switch does.
setSessionNames(SEEDED_NAMES)

describe("nextGap", () => {
  test("the next full read waits three times as long as the last took, at least MIN_GAP_MS", () => {
    expect(nextGap(0, 1000, true)).toBe(MIN_GAP_MS)
    expect(nextGap(0, 5000, true)).toBe(15_000)
    expect(nextGap(60_000, 5000, true)).toBe(15_000)
  })

  test("a failed read doubles the wait, up to MAX_GAP_MS", () => {
    expect(nextGap(15_000, 1000, false)).toBe(30_000)
    expect(nextGap(0, 20_000, false)).toBe(60_000)
    expect(nextGap(90_000, 20_000, false)).toBe(MAX_GAP_MS)
  })

  test("a fixture, which costs cmux nothing, sets no floor", () => {
    expect(nextGap(0, 1, true, 0)).toBe(3)
  })

  // 15 Oct: the Mac hibernated for ten minutes on 1% battery, and the read out then failed on waking, which held the next for MAX_GAP_MS while cmux answered.
  test("a read that ran a minute or more was suspended with the machine, so the next starts at once, failed or not", () => {
    expect(nextGap(60_000, 60_000, false)).toBe(0)
    expect(nextGap(60_000, 600_000, true)).toBe(0)
    expect(nextGap(0, 59_999, false)).toBe(MAX_GAP_MS)
  })
})

const b64 = (s: string) => Buffer.from(s).toString("base64")

// cmux's raw list with every record taken at its word, as listLive hands it on when it has no registry to read.
const fromCmux = (
  sessions: unknown,
  ...rest: Parameters<typeof composeWorkers> extends [unknown, ...infer R] ? R : never
) => composeWorkers(liveRecords(sessions, null), ...rest)

const session = (over: Record<string, unknown>) => ({
  agent: "claude",
  agent_lifecycle: "running",
  cwd: "/repo",
  launch_arguments: ["/bin/claude", "-n", "greed"],
  launch_backed: true,
  session_id: "s-greed",
  started_at: "2026-10-06T09:00:00.000Z",
  stored_pid_exists: true,
  surface_id: "SURF-1",
  transcript_path: "/t/s-greed.jsonl",
  updated_at: "2026-10-06T10:00:00.000Z",
  workspace_id: "W1",
  ...over,
})

const workspaces = {
  workspaces: [
    { id: "W1", ref: "workspace:40", custom_title: "greed" },
    { id: "W5", ref: "workspace:5", custom_title: DISPATCHER },
  ],
}

const question = (sessionId: string) => ({
  kind: "question",
  request_id: "R1",
  workstream_id: `cmux-feed-v1:${b64("claude")}:${b64(sessionId)}`,
  questions: [
    {
      prompt: "Lunch?",
      multi_select: false,
      options: [{ label: "Dal makhani" }, { label: "Rajma chawal" }],
    },
  ],
})

describe("nameOf", () => {
  test("reads -n, --name and --name=", () => {
    expect(nameOf(["claude", "-n", "pride"])).toBe("pride")
    expect(nameOf(["claude", "--name", "envy"])).toBe("envy")
    expect(nameOf(["claude", "--name=wrath"])).toBe("wrath")
    expect(nameOf(["claude"])).toBe("")
    expect(nameOf(undefined)).toBe("")
  })
})

describe("sessionOfWorkstream", () => {
  test("decodes the asking session from a Feed item's workstream id", () => {
    expect(sessionOfWorkstream(`cmux-feed-v1:${b64("claude")}:${b64("abc-123")}`)).toBe("abc-123")
  })
})

describe("questionsBySession", () => {
  test("keeps only pickers, keyed by the asking session, with labels in picker order", () => {
    const feed = { items: [question("s-greed"), { kind: "toolUse", workstream_id: "x" }] }
    expect(questionsBySession(feed).get("s-greed")).toEqual([
      { multiSelect: false, options: ["Dal makhani", "Rajma chawal"], prompt: "Lunch?" },
    ])
  })
})

// herdr has no Feed, so a blocked herdr session's card is the open call that raised its prompt
describe("herdrFeed", () => {
  const at = "2026-10-18T12:00:00.000Z"
  const call = (id: string, name: string, input: unknown) => ({ at, id, input, name })
  const calls = [
    call("toolu_plan", "ExitPlanMode", { plan: "# Plan\n\nShip it." }),
    call("toolu_write", "Write", { content: "x", file_path: "/tmp/a" }),
    call("toolu_ask", "AskUserQuestion", { questions: [{ question: "Go?", options: [] }] }),
    call("toolu_bash", "Bash", { command: "ls -la" }),
  ]
  const wait = (
    reason: string | null,
    tool: string | null = null,
    agentId: string | null = null,
  ) => ({
    agentId,
    reason,
    tool,
  })

  test("with no stuck record, the newest open call is the prompt", () => {
    expect(herdrFeed(calls, null)).toEqual([
      expect.objectContaining({
        detail: "ls -la",
        kind: "permission",
        requestId: "toolu_bash",
        tool: "Bash",
        whole: true,
      }),
    ])
    expect(herdrFeed(calls.slice(0, 3), wait(null))).toEqual([
      {
        at,
        kind: "question",
        questions: [{ header: null, multiSelect: false, options: [], prompt: "Go?" }],
        requestId: "toolu_ask",
      },
    ])
  })

  test("the stuck record's kind and tool pick the call, past newer ones", () => {
    expect(herdrFeed(calls, wait("plan"))).toEqual([
      {
        at,
        clipped: false,
        kind: "plan",
        plan: "# Plan\n\nShip it.",
        requestId: "toolu_plan",
        whole: true,
      },
    ])
    expect(herdrFeed(calls, wait("question"))[0]?.requestId).toBe("toolu_ask")
    expect(herdrFeed(calls, wait("permission", "Write"))[0]).toMatchObject({
      detail: "/tmp/a",
      tool: "Write",
    })
    // a permission with no tool named is the newest call that is not a picker or a plan
    expect(herdrFeed(calls.slice(0, 3), wait("permission"))[0]?.requestId).toBe("toolu_write")
  })

  test("a subagent's prompt, an elicitation, a login or a call that is not there gets no card", () => {
    expect(herdrFeed(calls, wait("permission", "Bash", "agent-1"))).toEqual([])
    expect(herdrFeed(calls, wait("elicitation"))).toEqual([])
    expect(herdrFeed(calls, wait("login"))).toEqual([])
    expect(herdrFeed(calls, wait("permission", "Edit"))).toEqual([])
    expect(herdrFeed([], null)).toEqual([])
  })
})

describe("lightOf", () => {
  test("a waiting picker or a needsInput session needs you; running works; anything else is idle", () => {
    expect(lightOf("running", [{ multiSelect: false, options: [], prompt: "?" }])).toBe("needs-you")
    expect(lightOf("needsInput", [])).toBe("needs-you")
    expect(lightOf("running", [])).toBe("working")
    expect(lightOf("idle", [])).toBe("idle")
    const permission = feedItemOf(permissionItem("s-1"))
    expect(lightOf("running", [], permission ? [permission] : [])).toBe("needs-you")
  })
})

describe("DISPATCHER", () => {
  test("is the dispatcher role word unless PLAYGROUND_DISPATCHER names a test stack's throwaway session", () => {
    expect(DISPATCHER).toBe(process.env.PLAYGROUND_DISPATCHER || "dispatcher")
  })
})

describe("DISPATCHERS", () => {
  test("the dispatcher role's names, the primary first: PLAYGROUND_DISPATCHER, then PLAYGROUND_DISPATCHER_SECONDARY (the primary's name plus -2 by default)", () => {
    expect(DISPATCHER_SECONDARY).toBe(
      process.env.PLAYGROUND_DISPATCHER_SECONDARY ||
        `${process.env.PLAYGROUND_DISPATCHER || "dispatcher"}-2`,
    )
    expect(DISPATCHERS).toEqual([DISPATCHER, DISPATCHER_SECONDARY])
  })

  // A live-reads test stack that sets only PLAYGROUND_DISPATCHER=probe-x must never give the real OLD.dispatcher-2 the role, or its composer types into it (reviewer-tidy-relay).
  test(`an unset secondary follows the primary, so a test stack's probe never reaches the real ${OLD.dispatcher}-2`, () => {
    expect(secondaryOf(OLD.dispatcher)).toBe(`${OLD.dispatcher}-2`)
    expect(secondaryOf("probe-x")).toBe("probe-x-2")
    expect(secondaryOf("probe-x", "probe-y")).toBe("probe-y")
  })

  // verify cls: the sidebar dropped 32px when the second dispatcher's row arrived under a one-row placeholder, so /api/health names how many dispatcher rows the header draws
  test("the header's dispatcher slot count: the primary's always, each other one's while a session of its name is registered or the roster lists it", () => {
    expect(dispatcherSlots([OLD.dispatcher, `${OLD.dispatcher}-2`], new Set())).toBe(1)
    expect(
      dispatcherSlots([OLD.dispatcher, `${OLD.dispatcher}-2`], new Set([`${OLD.dispatcher}-2`])),
    ).toBe(2)
    expect(
      dispatcherSlots([OLD.dispatcher, `${OLD.dispatcher}-2`], new Set([OLD.dispatcher])),
    ).toBe(1)
    expect(dispatcherSlots([OLD.dispatcher], new Set([`${OLD.dispatcher}-2`]))).toBe(1)
  })

  test("both names take the dispatcher role, whatever the roster calls them", () => {
    for (const name of DISPATCHERS) {
      expect(roleOf(name)).toBe("dispatcher")
      expect(roleOf(name, { role: "manager" })).toBe("dispatcher")
    }
  })
})

describe("roleOf", () => {
  test(`${OLD.planner}, ${OLD.builder}, ${OLD.ops} and optimizer are managers by name, and so is anyone the roster calls a manager`, () => {
    expect(roleOf(OLD.planner)).toBe("manager")
    expect(roleOf(OLD.builder)).toBe("manager")
    expect(roleOf(OLD.ops)).toBe("manager")
    expect(roleOf("optimizer")).toBe("manager")
    expect(roleOf("worker-sloth", { role: "manager" })).toBe("manager")
    expect(roleOf(OLD.builder, { role: "worker" })).toBe("manager")
    expect(roleOf("worker-sloth", { role: "worker" })).toBe("worker")
    // the roster's manager role outranks the runner- prefix
    expect(roleOf("runner-pride", { role: "manager" })).toBe("manager")
    expect(roleOf("runner-pride", { role: "runner" })).toBe("runner")
    expect(roleOf(capital(OLD.builder))).toBe("other")
  })

  test("an <id>-<kind> manager is a manager by its name alone, and an ops job is not (PG-1644)", () => {
    for (const [name, kind] of [
      ["x7mh4d-builder", "builder"],
      ["k3v9q2-ops", "ops"],
      ["q8r2tx-planner", "planner"],
      ["p2c4fj-optimizer", "optimizer"],
    ] as const)
      expect([roleOf(name), kindOf(name)]).toEqual(["manager", kind])
    expect(roleOf("ops-dashboard")).toBe("other")
    expect(roleOf("ops-localci")).toBe("other")
    expect(kindOf("ops-dashboard")).toBeNull()
  })

  test("the roster's runner role outranks a worker- or other name, but not a manager's or the dispatcher's", () => {
    expect(roleOf("linear-auto", { role: "runner" })).toBe("runner")
    expect(roleOf("worker-envy", { role: "runner" })).toBe("runner")
    expect(roleOf(OLD.builder, { role: "runner" })).toBe("manager")
    expect(roleOf(DISPATCHER, { role: "runner" })).toBe("dispatcher")
  })

  test("a kindless <id>-<kind> name takes its role from its last word, as an old name does from its prefix (#966)", () => {
    expect(roleOf("b7k2mq-reviewer")).toBe("worker")
    expect(roleOf("k3m9px-tester")).toBe("worker")
    expect(roleOf("k3m9px-worker")).toBe("worker")
    expect(roleOf("k3m9px-runner")).toBe("runner")
    expect(roleOf("x7mh4d-builder")).toBe("manager")
    expect(roleOf("k3m9px-probe", { role: "worker" })).toBe("other")
    // the roster's manager or runner role still outranks it
    expect(roleOf("b7k2mq-reviewer", { role: "runner" })).toBe("runner")
    expect(roleOf("k3m9px-wizard")).toBe("other")
    expect(roleOf("k3m9px-wizard", { role: "worker" })).toBe("worker")
  })

  test(`${OLD.dispatcher} stays the dispatcher though the roster calls it a manager`, () => {
    expect(roleOf(DISPATCHER, { role: "manager" })).toBe("dispatcher")
  })

  const SINS = ["envy", "gluttony", "greed", "lust", "pride", "sloth", "wrath"]

  test(`${OLD.dispatcher} is the dispatcher, runner-<sin> is a runner and worker-<sin> is a worker`, () => {
    expect(roleOf(DISPATCHER)).toBe("dispatcher")
    for (const sin of SINS) {
      expect(roleOf(`runner-${sin}`)).toBe("runner")
      expect(roleOf(`worker-${sin}`)).toBe("worker")
    }
  })

  test("a session's kind is the roster's first (#966), else what its name gives, else none", () => {
    expect(kindOf("b7k2mq-reviewer", { kind: "reviewer", role: "worker" })).toBe("reviewer")
    expect(kindOf("worker-greed", { kind: "researcher", role: "worker" })).toBe("researcher")
    expect(kindOf(DISPATCHER)).toBe("dispatcher")
    expect(kindOf(OLD.builder)).toBe("builder")
    expect(kindOf(OLD.ops)).toBe("ops")
    expect(kindOf(OLD.planner)).toBe("planner")
    expect(kindOf("reviewer-envy")).toBe("reviewer")
    expect(kindOf("worker-greed", { role: "worker" })).toBe("worker")
    // an <id>-<kind> name with no roster entry reads its last word, as the web's checkerOf does
    expect(kindOf("b7k2mq-reviewer")).toBe("reviewer")
    expect(kindOf("scratch-demo")).toBeNull()
  })

  test("reviewer-<sin> and tester-<sin> are workers, suffix and all, and the roster's worker role makes one of any name", () => {
    expect(roleOf("reviewer-envy")).toBe("worker")
    expect(roleOf("tester-gluttony-97")).toBe("worker")
    expect(roleOf("linear-check", { role: "worker" })).toBe("worker")
  })

  // a session's kind, written at spawn, places it whatever its name, so a name need not carry its role.
  test("the roster's kind places a session first, a name that carries no role included", () => {
    expect(roleOf("k3v9q2-reviewer", { kind: "reviewer", role: "worker" })).toBe("worker")
    expect(roleOf("k3v9q2-tester", { kind: "tester", role: "worker" })).toBe("worker")
    expect(roleOf("k3v9q2-researcher", { kind: "researcher", role: "worker" })).toBe("worker")
    expect(roleOf("k3v9q2-runner", { kind: "runner", role: "worker" })).toBe("runner")
    expect(roleOf("x7mh4d-builder", { kind: "builder", role: "worker" })).toBe("manager")
    expect(roleOf("x7mh4d-ops", { kind: "ops", role: "manager" })).toBe("manager")
    expect(roleOf("k3v9q2-probe", { kind: "probe", role: "worker" })).toBe("other")
    // the kind outranks the name's prefix, and the dispatchers and probes keep their own rules
    expect(roleOf("worker-envy", { kind: "runner", role: "worker" })).toBe("runner")
    expect(roleOf(DISPATCHER, { kind: "worker", role: "worker" })).toBe("dispatcher")
    expect(roleOf("probe-history", { kind: "worker", role: "worker" })).toBe("other")
    // with no kind, the kind its name gives places it, and a name that gives none reads by its role
    expect(roleOf("k3v9q2-reviewer")).toBe("worker")
    expect(roleOf("k3v9q2-wizard", { role: "worker" })).toBe("worker")
  })

  test("any other name is other, the old -runner suffix and a bare runner-, worker- or probe- included", () => {
    for (const name of [
      "wrath",
      "dashboard-runner",
      "runner",
      "runner-",
      "worker-",
      "probe-",
      "Runner-pride",
      "session 1a2b3c4d",
    ]) {
      expect(roleOf(name)).toBe("other")
    }
  })
})

describe("probes", () => {
  test("a probe is other whatever the roster says, and never waits on Merritt", () => {
    expect(roleOf("probe-history")).toBe("other")
    expect(roleOf("probe-history", { role: "worker" })).toBe("other")
    expect(roleOf("probe-history", { role: "manager" })).toBe("other")
    expect(isProbe("probe-history")).toBe(true)
    expect(isProbe("probe-")).toBe(false)
    expect(isProbe("k3m9px-probe")).toBe(true)
    expect(isProbe("k3m9px-worker")).toBe(false)
  })
})

describe("rosterRoleOf", () => {
  const roles = new Map([
    ["linear-auto", { role: "runner" }],
    ["runner-pride", { role: "runner" }],
    ["worker-greed", { kind: "worker", role: "worker" }],
  ] as const)

  test("the roster's kind and role for a session's name, or for its bare sin by the role-prefixed name", () => {
    expect(rosterRoleOf(roles, "linear-auto")).toEqual({ role: "runner" })
    expect(rosterRoleOf(roles, "greed")).toEqual({ kind: "worker", role: "worker" })
    expect(rosterRoleOf(roles, "pride")).toEqual({ role: "runner" })
    expect(rosterRoleOf(roles, "wrath")).toBeUndefined()
  })
})

describe("surfacesOf", () => {
  test("each terminal surface by the UUID a session record names, with its ref and title; malformed ones are left out", () => {
    const tree = {
      windows: [
        {
          workspaces: [
            {
              panes: [
                {
                  surfaces: [
                    { id: "U1", ref: "surface:1", title: OLD.dispatcher },
                    { id: "U2", ref: "surface:2" },
                    { ref: "surface:3", title: "no uuid" },
                    { id: "U4", ref: "pane:4", title: "wrong ref" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(surfacesOf(tree)).toEqual(
      new Map([
        ["U1", { ref: "surface:1", title: OLD.dispatcher }],
        ["U2", { ref: "surface:2", title: null }],
      ]),
    )
    expect(surfacesOf(null)).toEqual(new Map())
  })
})

describe("composeWorkers", () => {
  test("the two dispatchers both keep the role, the primary first on the board", () => {
    const second = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER_SECONDARY],
      session_id: "s-glm",
      started_at: "2026-10-06T08:00:00.000Z",
      surface_id: "SURF-1",
    })
    const first = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-opus",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-2",
    })
    const { workers } = fromCmux(
      { sessions: [second, first] },
      workspaces,
      { items: [] },
      new Map(),
      new Map(),
    )
    expect(workers.filter((w) => w.role === "dispatcher").map((w) => w.sessionId)).toEqual([
      "s-opus",
      "s-glm",
    ])
  })

  test("of two live sessions named for the second dispatcher, its oldest keeps the role, and the primary keeps its own", () => {
    const sessions = [
      { id: "s-glm-new", name: DISPATCHER_SECONDARY, at: "2026-10-06T10:00:00.000Z" },
      { id: "s-glm-old", name: DISPATCHER_SECONDARY, at: "2026-10-06T08:00:00.000Z" },
      { id: "s-opus", name: DISPATCHER, at: "2026-10-06T09:00:00.000Z" },
    ].map(({ at, id, name }, i) =>
      session({
        launch_arguments: ["/bin/claude", "-n", name],
        session_id: id,
        started_at: at,
        surface_id: `SURF-${i + 1}`,
      }),
    )
    const { workers } = fromCmux({ sessions }, workspaces, { items: [] }, new Map(), new Map())
    const roles = Object.fromEntries(workers.map((w) => [w.sessionId, w.role]))
    expect(roles).toEqual({
      "s-glm-new": "other",
      "s-glm-old": "dispatcher",
      "s-opus": "dispatcher",
    })
  })

  test("of two live sessions named for the dispatcher, the oldest by startedAt keeps the role and the later reads as other", () => {
    const older = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-old",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-1",
    })
    const newer = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-new",
      started_at: "2026-10-06T10:00:00.000Z",
      surface_id: "SURF-2",
    })
    const { workers } = fromCmux(
      { sessions: [newer, older] },
      workspaces,
      { items: [] },
      new Map(),
      new Map(),
    )
    const named = workers.filter((w) => w.name === DISPATCHER)
    expect(named).toHaveLength(2)
    expect(named.find((w) => w.role === "dispatcher")?.sessionId).toBe("s-old")
    expect(named.find((w) => w.role === "other")?.sessionId).toBe("s-new")
  })

  test("a tie on startedAt keeps the session whose id sorts first, whatever the array order", () => {
    const later = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-b",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-1",
    })
    const earlier = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-a",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-2",
    })
    const { workers } = fromCmux(
      { sessions: [later, earlier] },
      workspaces,
      { items: [] },
      new Map(),
      new Map(),
    )
    const named = workers.filter((w) => w.name === DISPATCHER)
    expect(named.find((w) => w.role === "dispatcher")?.sessionId).toBe("s-a")
    expect(named.find((w) => w.role === "other")?.sessionId).toBe("s-b")
  })

  test("a startedAt that does not parse never keeps the role over one that does", () => {
    const garbage = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-garbage",
      started_at: "not a time",
      surface_id: "SURF-1",
    })
    const real = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-real",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-2",
    })
    const { workers } = fromCmux(
      { sessions: [garbage, real] },
      workspaces,
      { items: [] },
      new Map(),
      new Map(),
    )
    const named = workers.filter((w) => w.name === DISPATCHER)
    expect(named.find((w) => w.role === "dispatcher")?.sessionId).toBe("s-real")
  })

  test("after the demotion the dispatcher leads the board's order", () => {
    const demoted = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-new",
      started_at: "2026-10-06T10:00:00.000Z",
      surface_id: "SURF-1",
    })
    const keeper = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-old",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-2",
    })
    const { workers } = fromCmux(
      { sessions: [demoted, keeper] },
      workspaces,
      { items: [] },
      new Map(),
      new Map(),
    )
    expect(workers.find((w) => w.name === DISPATCHER)?.role).toBe("dispatcher")
  })

  test("the session demoted to other shows its own first ask, as any other does, while the keeper still shows none", () => {
    const keeper = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-old",
      started_at: "2026-10-06T09:00:00.000Z",
      surface_id: "SURF-1",
    })
    const demoted = session({
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-new",
      started_at: "2026-10-06T10:00:00.000Z",
      surface_id: "SURF-2",
    })
    const tasks = new Map([
      ["s-old", "Run the dashboard"],
      ["s-new", "Look at the dashboard"],
    ])
    const { workers } = fromCmux({ sessions: [demoted, keeper] }, workspaces, { items: [] }, tasks)
    const bySession = new Map(workers.map((w) => [w.sessionId, w]))
    expect(bySession.get("s-new")).toMatchObject({ role: "other", task: "Look at the dashboard" })
    expect(bySession.get("s-old")).toMatchObject({ role: "dispatcher", task: null })
  })

  test("two sessions sharing a workspace are named from their own surfaces' titles, and carry their surface refs", () => {
    const tree = {
      windows: [
        {
          workspaces: [
            {
              panes: [
                {
                  surfaces: [
                    { id: "SURF-1", ref: "surface:1", title: "gluttony" },
                    { id: "SURF-2", ref: "surface:2", title: "envy" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const sessions = {
      sessions: [
        session({ launch_arguments: ["/bin/claude"] }),
        session({
          session_id: "s-envy",
          surface_id: "SURF-2",
          launch_arguments: ["/bin/claude"],
        }),
      ],
    }
    const live = fromCmux(
      sessions,
      workspaces,
      { items: [] },
      new Map(),
      new Map(),
      undefined,
      undefined,
      undefined,
      undefined,
      tree,
    )
    expect(live.workers.map((w) => [w.name, w.surface]).sort()).toEqual([
      ["envy", "surface:2"],
      ["gluttony", "surface:1"],
    ])
    expect(live.workers[0]?.workspace).toEqual({ ref: "workspace:40", title: "greed" })
  })

  test("a probe at a picker reads idle, keeping its Feed item for its own chat; the dispatcher at one still needs you", () => {
    const probe = session({
      agent_lifecycle: "needsInput",
      launch_arguments: ["/bin/claude", "-n", "probe-history"],
      session_id: "s-probe",
      surface_id: "SURF-P",
    })
    const dispatcher = session({
      agent_lifecycle: "needsInput",
      launch_arguments: ["/bin/claude", "-n", DISPATCHER],
      session_id: "s-boss",
      surface_id: "SURF-D",
      workspace_id: "W5",
    })
    const { workers } = fromCmux(
      { sessions: [probe, dispatcher] },
      workspaces,
      { items: [questionItem("s-probe"), questionItem("s-boss")] },
      new Map(),
    )
    const by = new Map(workers.map((w) => [w.sessionId, w]))
    expect(by.get("s-probe")).toMatchObject({ light: "idle", role: "other" })
    expect(by.get("s-probe")?.feed).toHaveLength(1)
    expect(by.get("s-boss")).toMatchObject({ light: "needs-you", role: "dispatcher" })
  })

  test("one row per live Claude session; dead and non-Claude sessions are left out", () => {
    const sessions = {
      sessions: [
        session({}),
        session({ session_id: "dead", stored_pid_exists: false }),
        session({ session_id: "codex", agent: "codex" }),
      ],
    }
    const { workers } = fromCmux(sessions, workspaces, { items: [] }, new Map())
    expect(workers.map((w) => w.sessionId)).toEqual(["s-greed"])
  })

  test("a row carries its name, workspace, light, task and picker, and maps its transcript and surface", () => {
    const sessions = { sessions: [session({})] }
    const live = fromCmux(
      sessions,
      workspaces,
      { items: [question("s-greed")] },
      new Map([["s-greed", "Pick lunch"]]),
    )
    expect(live.workers[0]).toMatchObject({
      light: "needs-you",
      name: "greed",
      role: "other",
      task: "Pick lunch",
      title: null,
      workspace: { ref: "workspace:40", title: "greed" },
    })
    expect(live.workers[0]?.questions).toHaveLength(1)
    expect(live.transcripts.get("s-greed")).toBe("/t/s-greed.jsonl")
    expect(live.surfaces.get("s-greed")).toBe("SURF-1")
  })

  // The dispatcher is OLD.dispatcher unless a test stack's PLAYGROUND_DISPATCHER renames it, so the fixture takes whichever name this run has.
  test(`${OLD.dispatcher} is the dispatcher: listed first, with no task, whatever its first ask was`, () => {
    const sessions = {
      sessions: [
        session({}),
        session({
          session_id: `s-${OLD.dispatcher}`,
          launch_arguments: ["/bin/claude"],
          workspace_id: "W5",
          agent_lifecycle: "idle",
        }),
      ],
    }
    const { workers } = fromCmux(
      sessions,
      workspaces,
      { items: [] },
      new Map([[`s-${OLD.dispatcher}`, "I don't want this 80/20 rule"]]),
    )
    expect(workers.map((w) => [w.name, w.role, w.task])).toEqual([
      [DISPATCHER, "dispatcher", null],
      ["greed", "other", null],
    ])
  })

  test("a session named runner-<sin> is a runner and keeps its task, in the board's usual order", () => {
    const sessions = {
      sessions: [
        session({}),
        session({
          session_id: "s-runner-pride",
          launch_arguments: ["/bin/claude", "-n", "runner-pride"],
          agent_lifecycle: "idle",
        }),
      ],
    }
    const { workers } = fromCmux(
      sessions,
      workspaces,
      { items: [] },
      new Map([["s-runner-pride", "Keep the dashboard on the newest canary"]]),
    )
    expect(workers.map((w) => [w.name, w.role, w.task])).toEqual([
      ["greed", "other", null],
      ["runner-pride", "runner", "Keep the dashboard on the newest canary"],
    ])
  })

  test("a session's live /rename name leads, whatever it was launched as or its workspace is titled", () => {
    const sessions = {
      sessions: [
        session({}),
        session({
          session_id: "s-dashboard",
          launch_arguments: ["/bin/claude", "-n", "dashboard-runner"],
          workspace_id: "W50",
          surface_id: "SURF-50",
        }),
      ],
    }
    const titled = {
      workspaces: [
        ...workspaces.workspaces,
        { id: "W50", ref: "workspace:50", custom_title: "something-else" },
      ],
    }
    const live = new Map([
      ["s-greed", "worker-greed"],
      ["s-dashboard", "runner-pride"],
    ])
    const { workers } = fromCmux(sessions, titled, { items: [] }, new Map(), live)
    expect(workers.map((w) => [w.name, w.role])).toEqual([
      ["runner-pride", "runner"],
      ["worker-greed", "worker"],
    ])
  })

  test("without a live name, the launch name beats the workspace title", () => {
    const sessions = {
      sessions: [
        session({
          session_id: "s-dashboard",
          launch_arguments: ["/bin/claude", "-n", "dashboard-runner"],
          workspace_id: "W50",
        }),
      ],
    }
    const titled = {
      workspaces: [{ id: "W50", ref: "workspace:50", custom_title: "runner-pride" }],
    }
    const { workers } = fromCmux(
      sessions,
      titled,
      { items: [] },
      new Map(),
      new Map([["s-dashboard", null]]),
    )
    expect(workers.map((w) => w.name)).toEqual(["dashboard-runner"])
  })

  test(`${OLD.dispatcher}, launched with no name, stays the dispatcher by its live name even when its workspace is shared`, () => {
    const sessions = {
      sessions: [
        session({
          session_id: `s-${OLD.dispatcher}`,
          launch_arguments: ["/bin/claude"],
          workspace_id: "W5",
          surface_id: "L1",
        }),
        session({
          session_id: "s-hand0001",
          launch_arguments: ["/bin/claude"],
          workspace_id: "W5",
          surface_id: "L2",
        }),
      ],
    }
    const live = new Map([[`s-${OLD.dispatcher}`, DISPATCHER]])
    const { workers } = fromCmux(sessions, workspaces, { items: [] }, new Map(), live)
    expect(workers.map((w) => [w.name, w.role])).toEqual([
      [DISPATCHER, "dispatcher"],
      ["session repo", "other"],
    ])
  })

  test("a workspace's title still names a lone session that has neither a live nor a launch name, a nested headless run not counting as a second", () => {
    const sessions = {
      sessions: [
        session({
          session_id: `s-${OLD.dispatcher}`,
          launch_arguments: ["/bin/claude"],
          workspace_id: "W5",
          surface_id: "L1",
        }),
        // OLD.dispatcher's own `claude -p` trial, run in its terminal
        session({
          session_id: "s-trial",
          launch_arguments: ["/bin/claude", "-p"],
          launch_backed: false,
          workspace_id: "W5",
          surface_id: "L1",
        }),
      ],
    }
    const { workers } = fromCmux(sessions, workspaces, { items: [] }, new Map())
    expect(workers.map((w) => [w.name, w.role])).toEqual([[DISPATCHER, "dispatcher"]])
  })

  test("two sessions sharing a renamed workspace keep their own launch names", () => {
    const sessions = {
      sessions: [
        session({
          session_id: "s-a",
          launch_arguments: ["/bin/claude", "-n", "worker-envy"],
          surface_id: "A",
        }),
        session({
          session_id: "s-b",
          launch_arguments: ["/bin/claude", "-n", "worker-lust"],
          surface_id: "B",
        }),
      ],
    }
    const shared = { workspaces: [{ id: "W1", ref: "workspace:40", custom_title: "runner-sloth" }] }
    const { workers } = fromCmux(sessions, shared, { items: [] }, new Map())
    expect(workers.map((w) => [w.name, w.role])).toEqual([
      ["worker-envy", "worker"],
      ["worker-lust", "worker"],
    ])
  })

  test("in a shared renamed workspace, a session launched without a name is named for its folder, not the workspace's role", () => {
    const sessions = {
      sessions: [
        session({
          session_id: "s-runner",
          launch_arguments: ["/bin/claude", "-n", "dashboard-runner"],
          surface_id: "A",
        }),
        session({
          cwd: "/Users/me/acme-app/",
          session_id: "s-hand0001",
          launch_arguments: ["/bin/claude"],
          surface_id: "B",
        }),
      ],
    }
    const shared = { workspaces: [{ id: "W1", ref: "workspace:50", custom_title: "runner-pride" }] }
    const { workers } = fromCmux(sessions, shared, { items: [] }, new Map())
    expect(workers.map((w) => [w.name, w.role])).toEqual([
      ["dashboard-runner", "other"],
      ["session acme-app", "other"],
    ])
  })

  test("an unnamed session in a folder named for a role takes none, and one with no folder keeps its id", () => {
    const unnamed = (cwd: string, id: string) =>
      session({ cwd, session_id: id, launch_arguments: ["/bin/claude"], surface_id: id })
    const sessions = {
      sessions: [
        unnamed(`/Users/me/${OLD.dispatcher}`, "s-hand0001"),
        unnamed("/w/worker-foo", "s-hand0003"),
        unnamed("/w/runner-foo", "s-hand0004"),
        unnamed("/w/probe-foo", "s-hand0005"),
        session({
          cwd: "",
          session_id: "s-hand0002",
          launch_arguments: ["/bin/claude"],
          surface_id: "C",
        }),
      ],
    }
    const shared = { workspaces: [{ id: "W1", ref: "workspace:50", custom_title: "runner-pride" }] }
    const { workers } = fromCmux(sessions, shared, { items: [] }, new Map())
    expect(workers.map((w) => [w.name, w.role, isProbe(w.name)])).toEqual([
      [`session ${OLD.dispatcher}`, "other", false],
      ["session probe-foo", "other", false],
      ["session runner-foo", "other", false],
      ["session s-hand00", "other", false],
      ["session worker-foo", "other", false],
    ])
  })

  test("a row carries the triaged title and the ETA the roster gives its full name", () => {
    const sessions = {
      sessions: [session({ launch_arguments: ["/bin/claude", "-n", "worker-greed"] })],
    }
    const roster = {
      etas: new Map([["worker-greed", "2026-10-06T12:20:00Z"]]),
      roles: new Map(),
      titles: new Map([["worker-greed", `Message ${OLD.dispatcher} from the dashboard`]]),
    }
    const { workers } = fromCmux(
      sessions,
      { workspaces: [] },
      { items: [] },
      new Map(),
      new Map(),
      roster,
    )
    expect(workers.map((w) => [w.name, w.title, w.eta])).toEqual([
      ["worker-greed", `Message ${OLD.dispatcher} from the dashboard`, "2026-10-06T12:20:00Z"],
    ])
  })

  test("a session launched under its bare sin takes the roster's role for its role-prefixed name", () => {
    const roster = {
      etas: new Map(),
      roles: new Map([["worker-greed", { role: "worker" as const }]]),
      titles: new Map(),
    }
    const { workers } = fromCmux(
      { sessions: [session({})] },
      { workspaces: [] },
      { items: [] },
      new Map(),
      new Map(),
      roster,
    )
    expect(workers.map((w) => [w.name, w.role])).toEqual([["greed", "worker"]])
  })

  test("a row carries when its transcript last changed, and null when that is unknown", () => {
    const sessions = {
      sessions: [session({}), session({ session_id: "s-envy", surface_id: "SURF-2" })],
    }
    const { workers } = fromCmux(
      sessions,
      { workspaces: [] },
      { items: [] },
      new Map(),
      new Map(),
      undefined,
      new Map(),
      Date.now(),
      new Map([["s-greed", "2026-10-06T08:00:00.000Z"]]),
    )
    expect(workers.map((w) => [w.sessionId, w.lastActiveAt])).toEqual([
      ["s-greed", "2026-10-06T08:00:00.000Z"],
      ["s-envy", null],
    ])
  })

  test("a blank name at one step falls through to the next", () => {
    const sessions = {
      sessions: [session({ launch_arguments: ["/bin/claude", "-n", "worker-sloth"] })],
    }
    const { workers } = fromCmux(
      sessions,
      { workspaces: [] },
      { items: [] },
      new Map(),
      new Map([["s-greed", "  "]]),
    )
    expect(workers.map((w) => w.name)).toEqual(["worker-sloth"])
  })

  test("a name is trimmed before it is classified", () => {
    const sessions = {
      sessions: [session({ launch_arguments: ["/bin/claude", "-n", " runner-pride "] })],
    }
    const { workers } = fromCmux(sessions, { workspaces: [] }, { items: [] }, new Map())
    expect(workers.map((w) => [w.name, w.role])).toEqual([["runner-pride", "runner"]])
  })

  test("the board lists the dispatcher, then the managers, then everyone else; managers keep their tasks", () => {
    const named = (sessionId: string, name: string, lifecycle = "running") =>
      session({
        session_id: sessionId,
        launch_arguments: ["/bin/claude", "-n", name],
        surface_id: sessionId,
        agent_lifecycle: lifecycle,
      })
    const sessions = {
      sessions: [
        named("s-greed", "worker-greed", "needsInput"),
        named("s-boy", OLD.ops),
        named("s-planner", "planner"),
        named("s-kid", OLD.builder, "idle"),
        named("s-plan", OLD.planner),
        session({
          session_id: `s-${OLD.dispatcher}`,
          launch_arguments: ["/bin/claude"],
          workspace_id: "W5",
          surface_id: "L",
        }),
      ],
    }
    const roster = {
      etas: new Map(),
      roles: new Map([["planner", { role: "manager" as const }]]),
      titles: new Map(),
    }
    const tasks = new Map([["s-kid", "Run the review queue"]])
    const { workers } = fromCmux(sessions, workspaces, { items: [] }, tasks, new Map(), roster)
    expect(workers.map((w) => w.role)).toEqual([
      "dispatcher",
      "manager",
      "manager",
      "manager",
      "manager",
      "worker",
    ])
    expect(workers[0]?.name).toBe(DISPATCHER)
    expect(
      workers
        .slice(1, 5)
        .map((w) => w.name)
        .toSorted(),
    ).toEqual([OLD.ops, OLD.builder, OLD.planner, "planner"])
    expect(workers.find((w) => w.name === OLD.builder)?.task).toBe("Run the review queue")
  })

  test("workers that need you sort before working ones, then idle, then by name", () => {
    const sessions = {
      sessions: [
        session({
          session_id: "a",
          launch_arguments: ["c", "-n", "sloth"],
          agent_lifecycle: "idle",
        }),
        session({ session_id: "b", launch_arguments: ["c", "-n", "envy"] }),
        session({
          session_id: "c",
          launch_arguments: ["c", "-n", "wrath"],
          agent_lifecycle: "needsInput",
        }),
        session({ session_id: "d", launch_arguments: ["c", "-n", "greed"] }),
      ],
    }
    const { workers } = fromCmux(sessions, workspaces, { items: [] }, new Map())
    expect(workers.map((w) => w.name)).toEqual(["wrath", "envy", "greed", "sloth"])
  })

  test("a headless run nested in a worker's terminal is not a second worker; a lone unlaunched session still shows", () => {
    const sessions = {
      sessions: [
        session({}),
        session({ session_id: "nested", launch_arguments: [], launch_backed: false }),
        session({
          session_id: "lone",
          launch_arguments: [],
          launch_backed: false,
          surface_id: "SURF-9",
          workspace_id: "W5",
        }),
      ],
    }
    const { workers } = fromCmux(sessions, workspaces, { items: [] }, new Map())
    expect(workers.map((w) => w.sessionId).sort()).toEqual(["lone", "s-greed"])
  })

  test("garbage in yields no rows rather than a throw", () => {
    expect(fromCmux(null, "x", 3, new Map()).workers).toEqual([])
  })
})

describe("rosterFacts", () => {
  const agent = (name: string, role: "manager" | "runner" | "worker", title?: string) => ({
    name,
    role,
    status: "working",
    task: "t",
    ...(title === undefined ? {} : { title }),
  })

  test("maps each agent's full name to its kind and role, and to its trimmed title when it has one", () => {
    const roster = {
      updatedAt: "2026-10-06T03:39:00.000+05:30",
      agents: [
        agent("worker-greed", "worker", ` Message ${OLD.dispatcher} from the dashboard `),
        agent("worker-envy", "worker", "  "),
        agent(OLD.builder, "manager"),
      ],
    }
    const facts = rosterFacts(roster)
    expect(facts.titles).toEqual(
      new Map([["worker-greed", `Message ${OLD.dispatcher} from the dashboard`]]),
    )
    expect(facts.roles).toEqual(
      new Map([
        ["worker-greed", { role: "worker" }],
        ["worker-envy", { role: "worker" }],
        [OLD.builder, { role: "manager" }],
      ]),
    )
    const kinded = rosterFacts({
      ...roster,
      agents: [{ ...agent("k3v9q2-reviewer", "worker"), kind: "reviewer" }],
    })
    expect(kinded.roles.get("k3v9q2-reviewer")).toEqual({ kind: "reviewer", role: "worker" })
  })

  test("maps each agent's full name to its ETA when it has one", () => {
    const roster = {
      updatedAt: "2026-10-06T03:39:00.000+05:30",
      agents: [
        { ...agent("worker-greed", "worker"), eta: "2026-10-06T12:20:00Z" },
        agent("worker-envy", "worker"),
      ],
    }
    expect(rosterFacts(roster).etas).toEqual(new Map([["worker-greed", "2026-10-06T12:20:00Z"]]))
  })

  test("no roster gives no ETAs, roles or titles", () => {
    const facts = rosterFacts(null)
    expect(facts.etas.size + facts.roles.size + facts.titles.size).toBe(0)
  })
})

describe("feed items", () => {
  test("a picker keeps each question's header, options and descriptions", () => {
    expect(feedItemOf(questionItem("s-1"))).toEqual({
      at: "2026-10-05T22:13:16Z",
      kind: "question",
      questions: [
        {
          header: "Color",
          multiSelect: false,
          options: [
            { description: "Red color", label: "Red" },
            { description: "Blue color", label: "Blue" },
          ],
          prompt: "Pick a color?",
        },
      ],
      requestId: QUESTION_ID,
    })
  })

  // AskUserQuestion can ask a single-choice and a multi-choice question in one Feed item, and its card holds both.
  test("a two-question picker maps to one card holding both questions, one multi-select", () => {
    const item = feedItemOf(twoQuestionItem("s-1"))
    if (item?.kind !== "question") throw new Error("a two-question picker did not map to a card")
    expect(item.requestId).toBe(TWO_QUESTION_ID)
    expect(
      item.questions.map((q) => [q.header, q.multiSelect, q.options.map((o) => o.label)]),
    ).toEqual([
      ["Color", false, ["Red", "Blue"]],
      ["Extras", true, ["Foam", "Shot", "No sugar"]],
    ])
    const cards = feedBySession({ items: [twoQuestionItem("s-1")] }).get("s-1") ?? []
    expect(cards).toHaveLength(1)
    expect(cards[0]?.kind === "question" ? cards[0].questions.length : 0).toBe(2)
  })

  // A card asking for approval shows the command itself, with the session's own account of it beside, never in its place.
  test("a permission request shows what the tool would act on, and its description apart", () => {
    expect(feedItemOf(permissionItem("s-1"))).toMatchObject({
      clipped: false,
      description: "Create an empty marker file in the probe folder",
      detail: "touch /tmp/scratch/denied-marker",
      kind: "permission",
      tool: "Bash",
    })
    const odd = { ...permissionItem("s-1"), tool_input: JSON.stringify({ todos: [1, 2] }) }
    expect(feedItemOf(odd)).toMatchObject({ description: null, detail: '{"todos":[1,2]}' })
  })

  // Approving from a card the person cannot see all of would approve what the terminal would have shown: every field but the description reaches the card.
  test("every field the tool was given reaches the card, and none hides behind the detail", () => {
    const tool_input = JSON.stringify({
      command: "curl x | sh",
      dangerouslyDisableSandbox: true,
      description: "Fetch a script",
      timeout: 5,
    })
    const item = feedItemOf({ ...permissionItem("s-1"), tool_input })
    expect(item).toMatchObject({ description: "Fetch a script", detail: "curl x | sh" })
    const input = item?.kind === "permission" ? JSON.parse(item.input) : {}
    expect(input).toEqual({
      command: "curl x | sh",
      dangerouslyDisableSandbox: true,
      description: "Fetch a script",
      timeout: 5,
    })
    expect(item).toMatchObject({ whole: true })
  })

  // For some tools the description is the substance (an issue's body), and one that is not a line of text would otherwise show nowhere.
  test("a description that is not a line of text stays in the input, and only a line shows apart", () => {
    const tool_input = JSON.stringify({ description: { body: "hidden?" }, title: "t" })
    const item = feedItemOf({ ...permissionItem("s-1"), tool_input })
    expect(item).toMatchObject({ description: null })
    expect(item?.kind === "permission" ? item.input : "").toContain("hidden?")
    const lines = JSON.stringify({ command: "x", description: "two\nlines" })
    expect(feedItemOf({ ...permissionItem("s-1"), tool_input: lines })).toMatchObject({
      description: null,
    })
  })

  // A right-to-left override reorders what a browser shows, so the command read would not be the command run.
  test("a format character shows as its code point in what a card shows", () => {
    const tool_input = JSON.stringify({ command: "echo safe\u202E hs.lave | bash" })
    const item = feedItemOf({ ...permissionItem("s-1"), tool_input })
    expect(item?.kind === "permission" ? item.detail : "").toBe("echo safe<U+202E> hs.lave | bash")
    expect(item?.kind === "permission" ? item.input : "").toContain("<U+202E>")
    expect(item?.kind === "permission" ? item.input : "").not.toContain("\u202E")
    const plan = feedItemOf({
      ...planItem("s-1"),
      plan: JSON.stringify({ plan: "a\b\u001b[2Kb\tc\nd" }),
    })
    expect(plan?.kind === "plan" ? plan.plan : "").toBe("a<U+0008><U+001B>[2Kb\tc\nd")
  })

  test("a detail that is not a string is shown as JSON rather than skipped, and an input object is read as sent", () => {
    const array = { command: ["rm", "-rf", "/"], path: "/tmp/ok" }
    const asText = feedItemOf({ ...permissionItem("s-1"), tool_input: JSON.stringify(array) })
    expect(asText).toMatchObject({ detail: '["rm","-rf","/"]' })
    const asObject = feedItemOf({ ...permissionItem("s-1"), tool_input: { file_path: "/x" } })
    expect(asObject).toMatchObject({ detail: "/x" })
  })

  test("a long input says it was cut short, and a tool name that is not one is dropped", () => {
    const tool_input = JSON.stringify({ command: "x".repeat(3000), content: "y".repeat(7000) })
    const item = feedItemOf({ ...permissionItem("s-1"), tool_input, tool_name: "Bash; rm" })
    expect(item).toMatchObject({ clipped: true, tool: "", whole: false })
  })

  test("an option with no label, or a label already offered, is not offered", () => {
    const blank = questionItem("s-1")
    const q = {
      ...blank.questions[0]!,
      options: [{ description: "", id: "opt0", label: "" }, blank.questions[0]!.options[1]!],
    }
    const item = feedItemOf({ ...blank, questions: [q] })
    expect(item?.kind === "question" ? item.questions[0]?.options.map((o) => o.label) : []).toEqual(
      ["Blue"],
    )
    const twice = {
      ...blank.questions[0]!,
      options: [...blank.questions[0]!.options, blank.questions[0]!.options[0]!],
    }
    const deduped = feedItemOf({ ...blank, questions: [twice] })
    expect(
      deduped?.kind === "question" ? deduped.questions[0]?.options.map((o) => o.label) : [],
    ).toEqual(["Red", "Blue"])
  })

  test("a plan is its text, unwrapped from the Feed's JSON or an object, and says when it was cut short", () => {
    expect(feedItemOf(planItem("s-1"))).toMatchObject({
      clipped: false,
      kind: "plan",
      plan: "# Plan: create the plan-marker file\n\n## Step\n1. touch plan-marker\n",
    })
    expect(feedItemOf({ ...planItem("s-1"), plan: { plan: "an object" } })).toMatchObject({
      plan: "an object",
    })
    const long = { ...planItem("s-1"), plan: JSON.stringify({ plan: "z".repeat(9000) }) }
    expect(feedItemOf(long)).toMatchObject({ clipped: true })
  })

  test("telemetry, answered items and items with no request id are not pending", () => {
    expect(feedItemOf({ kind: "toolUse", request_id: "x" })).toBeNull()
    expect(feedItemOf({ ...questionItem("s-1"), status: "resolved" })).toBeNull()
    expect(feedItemOf({ ...questionItem("s-1"), request_id: "" })).toBeNull()
  })

  test("each session's items, oldest first, and a worker carries its own", () => {
    const feed = { items: [planItem("s-1"), questionItem("s-1"), permissionItem("s-2")] }
    const bySession = feedBySession(feed)
    expect(bySession.get("s-1")?.map((i) => i.kind)).toEqual(["question", "plan"])
    expect(bySession.get("s-2")?.map((i) => i.kind)).toEqual(["permission"])
    const { workers } = fromCmux(
      { sessions: [session({ session_id: "s-1" })] },
      { workspaces: [] },
      feed,
      new Map(),
    )
    expect(workers[0]?.feed.map((i) => i.kind)).toEqual(["question", "plan"])
  })
})

// A record cmux kept after its session ended: its stored pid now belongs to whatever macOS started next (ManagedSettingsAgent), so cmux still says the pid exists and the session waits on input. No registry file names it.
const reused = session({
  agent_lifecycle: "needsInput",
  launch_arguments: ["/bin/claude", "-n", "greed"],
  pid: 67174,
  session_id: "s-ended",
  stored_pid_arguments: [
    "/System/Library/Frameworks/ManagedSettings.framework/Versions/A/ManagedSettingsAgent",
  ],
  surface_id: "SURF-GONE",
  transcript_path: "/c/projects/p/s-ended.jsonl",
  workspace_id: "W-GONE",
})
const running = session({ pid: 95475, transcript_path: "/c/projects/p/s-greed.jsonl" })
const STARTED = "Tue Oct 6 09:00:00 2026"
const proof = (over: Partial<LiveProof> = {}): LiveProof => ({
  projects: "/c/projects",
  registry: new Map([[95475, { procStart: STARTED, sessionId: "s-greed" }]]),
  starts: new Map([[95475, STARTED]]),
  ...over,
})

describe("isLiveRecord", () => {
  test("a record is live only when Claude's registry names its session at its pid", () => {
    expect(isLiveRecord(running, proof())).toBe(true)
    expect(isLiveRecord(reused, proof())).toBe(false)
  })

  test("a pid the registry gives to another session is not this one's", () => {
    const registry = new Map([[95475, { procStart: STARTED, sessionId: "s-other" }]])
    expect(isLiveRecord(running, proof({ registry }))).toBe(false)
  })

  test("a file a crash left behind proves nothing once its pid is another process's", () => {
    expect(
      isLiveRecord(running, proof({ starts: new Map([[95475, "Wed Oct 7 08:00:00 2026"]]) })),
    ).toBe(false)
    expect(isLiveRecord(running, proof({ starts: new Map() }))).toBe(false)
  })

  test("with no start time to compare, the registry's name for the pid stands", () => {
    expect(isLiveRecord(running, proof({ starts: null }))).toBe(true)
    const registry = new Map([[95475, { procStart: null, sessionId: "s-greed" }]])
    expect(isLiveRecord(running, proof({ registry, starts: new Map() }))).toBe(true)
  })

  test("a procStart Claude writes in another shape (ISO, epoch) keeps a live record live", () => {
    for (const procStart of ["2026-10-06T09:00:00.000Z", 1791277200000]) {
      const text = JSON.stringify({ pid: 95475, procStart, sessionId: "s-greed" })
      expect(isLiveRecord(running, proof({ registry: registryOf([{ pid: 95475, text }]) }))).toBe(
        true,
      )
    }
  })

  test("a registry file caught mid-rewrite leaves cmux's word standing for its pid alone", () => {
    const registry = new Map([[95475, null]])
    expect(isLiveRecord(running, proof({ registry }))).toBe(true)
    expect(isLiveRecord(reused, proof({ registry }))).toBe(false)
  })

  test("a session under another Claude config keeps its registry there, so cmux's word stands", () => {
    const elsewhere = { ...reused, transcript_path: "/other/projects/p/s-ended.jsonl" }
    expect(isLiveRecord(elsewhere, proof())).toBe(true)
    expect(isLiveRecord({ ...reused, transcript_path: "" }, proof())).toBe(false)
  })

  test("cmux's own word still has to hold: a pid it saw end, or another agent, is never live", () => {
    expect(isLiveRecord({ ...running, stored_pid_exists: false }, proof())).toBe(false)
    expect(isLiveRecord({ ...running, agent: "codex" }, proof())).toBe(false)
    const registry = new Map([[95475, { procStart: STARTED, sessionId: "" }]])
    expect(isLiveRecord({ ...running, session_id: "" }, proof({ registry }))).toBe(false)
  })

  test("with no registry to read, cmux's stored pid is trusted as before", () => {
    expect(isLiveRecord(reused, proof({ registry: null }))).toBe(true)
    expect(isLiveRecord(reused, null)).toBe(true)
  })
})

describe("an ended session whose pid was reused", () => {
  const feed = { items: [question("s-ended")] }

  test("shows no row, light, picker or needs-you, while the live session beside it stays", () => {
    const live = composeWorkers(
      liveRecords({ sessions: [reused, running] }, proof()),
      {
        workspaces: [
          ...workspaces.workspaces,
          { id: "W-GONE", ref: "workspace:9", custom_title: "greed" },
        ],
      },
      feed,
      new Map(),
    )
    expect(live.workers.map((w) => w.sessionId)).toEqual(["s-greed"])
    expect(live.workers.some((w) => w.light === "needs-you")).toBe(false)
    expect(live.workers.flatMap((w) => w.questions)).toEqual([])
    expect([...live.surfaces.keys()]).toEqual(["s-greed"])
    expect([...live.transcripts.keys()]).toEqual(["s-greed"])
  })

  test("before the registry check it would have read as a session waiting on you", () => {
    const trusted = fromCmux({ sessions: [reused] }, workspaces, feed, new Map())
    expect(trusted.workers.map((w) => w.light)).toEqual(["needs-you"])
  })
})

describe("a picker he already answered", () => {
  // cmux stamped the picker 22:13:16Z; the session went needsInput as it went up.
  const waiting = session({
    agent_lifecycle: "needsInput",
    session_id: "s-greed",
    updated_at: "2026-10-05T22:13:16.400Z",
  })
  const board = (
    pickers: Pickers,
    items: unknown[] = [questionItem("s-greed")],
    record = waiting,
  ) =>
    fromCmux(
      { sessions: [record] },
      workspaces,
      { items },
      new Map(),
      new Map(),
      undefined,
      new Map([["s-greed", { ...NO_FACTS, pickers }]]),
    ).workers[0]

  test("leaves the Feed and the red once the transcript holds the answer, while cmux still shows it", () => {
    const worker = board({ answeredAt: "2026-10-05T22:13:20.100Z", interrupted: false, open: [] })
    expect(worker).toMatchObject({
      feed: [],
      lifecycle: "running",
      light: "working",
      questions: [],
    })
  })

  test("keeps the red while a picker is still open, a second one raised after the first was answered", () => {
    const worker = board({
      answeredAt: "2026-10-05T22:13:20.100Z",
      interrupted: false,
      open: ["toolu_second"],
    })
    expect(worker?.light).toBe("needs-you")
    expect(worker?.feed.map((item) => item.requestId)).toEqual([QUESTION_ID])
  })

  test("with a second picker open, keeps only the newest: the answered one's card goes, the red stays", () => {
    const second = {
      ...questionItem("s-greed"),
      created_at: "2026-10-05T22:13:25Z",
      request_id: "SECOND",
    }
    const worker = board(
      { answeredAt: "2026-10-05T22:13:20.100Z", interrupted: false, open: ["toolu_second"] },
      [questionItem("s-greed"), second],
    )
    expect(worker?.light).toBe("needs-you")
    expect(worker?.lifecycle).toBe("needsInput")
    expect(worker?.feed.map((item) => item.requestId)).toEqual(["SECOND"])
  })

  test("keeps a picker the Feed shows before the transcript holds it, though an earlier answer landed that second", () => {
    const worker = board({ answeredAt: "2026-10-05T22:13:16.900Z", interrupted: false, open: [] })
    expect(worker?.light).toBe("needs-you")
    expect(worker?.feed).toHaveLength(1)
  })

  test("keeps a permission prompt, which may be a subagent's", () => {
    const worker = board({ answeredAt: "2026-10-05T22:13:20.100Z", interrupted: false, open: [] }, [
      questionItem("s-greed"),
      { ...permissionItem("s-greed"), created_at: "2026-10-05T22:13:16Z" },
    ])
    expect(worker?.light).toBe("needs-you")
    expect(worker?.feed.map((item) => item.kind)).toEqual(["permission"])
  })

  test("keeps needsInput that cmux set after the answer, such as a permission prompt", () => {
    const later = session({
      agent_lifecycle: "needsInput",
      session_id: "s-greed",
      updated_at: "2026-10-05T22:13:21.000Z",
    })
    const worker = board(
      { answeredAt: "2026-10-05T22:13:20.100Z", interrupted: false, open: [] },
      [],
      later,
    )
    expect(worker).toMatchObject({ lifecycle: "needsInput", light: "needs-you" })
  })

  test("Esc on the picker and an interrupt leave it idle at its prompt; going on after a rejection is running", () => {
    const pickers = { answeredAt: "2026-10-05T22:13:20.100Z", open: [] }
    expect(board({ ...pickers, interrupted: true })).toMatchObject({
      feed: [],
      lifecycle: "idle",
      light: "idle",
    })
    expect(board({ ...pickers, interrupted: false })?.lifecycle).toBe("running")
  })

  test("a transcript with no answer leaves cmux's word", () => {
    expect(board(NO_FACTS.pickers)?.light).toBe("needs-you")
  })
})

describe("answeredSince", () => {
  const answered = (answeredAt: string | null, open: string[] = []) => ({
    answeredAt,
    interrupted: false,
    open,
  })

  test("a whole-second stamp counts only answers from the next second on", () => {
    expect(answeredSince(answered("2026-10-05T22:13:16.999Z"), "2026-10-05T22:13:16Z")).toBe(false)
    expect(answeredSince(answered("2026-10-05T22:13:17.000Z"), "2026-10-05T22:13:16Z")).toBe(true)
  })

  test("a stamp with milliseconds counts any later answer", () => {
    expect(answeredSince(answered("2026-10-05T22:13:16.401Z"), "2026-10-05T22:13:16.400Z")).toBe(
      true,
    )
    expect(answeredSince(answered("2026-10-05T22:13:16.400Z"), "2026-10-05T22:13:16.400Z")).toBe(
      false,
    )
  })

  test("an open picker, no answer or an unreadable time is not answered", () => {
    expect(
      answeredSince(answered("2026-10-05T22:14:00Z", ["toolu_1"]), "2026-10-05T22:13:16Z"),
    ).toBe(false)
    expect(answeredSince(answered(null), "2026-10-05T22:13:16Z")).toBe(false)
    expect(answeredSince(answered("2026-10-05T22:14:00Z"), "")).toBe(false)
  })
})

// A cmux on PATH that answers from 1,500 records, or those FAKE_CMUX_RECORDS names, newest first, and cuts its list at --limit as cmux does (its own default is 100); each call it gets is logged; a sessions read waits the milliseconds FAKE_CMUX_DELAY's file holds, read before the log, the command FAKE_CMUX_FAIL's file names exits 1, and the Feed holds what FAKE_CMUX_FEED's file holds.
const FAKE_CMUX = `#!/usr/bin/env bun
const { appendFileSync, existsSync, readFileSync } = await import("node:fs")
const args = process.argv.slice(2)
const delay = args[0] === "sessions" && existsSync(process.env.FAKE_CMUX_DELAY) ? Number(readFileSync(process.env.FAKE_CMUX_DELAY, "utf8")) : 0
appendFileSync(process.env.FAKE_CMUX_LOG, args.join(" ") + "\\n")
await Bun.sleep(delay)
if (existsSync(process.env.FAKE_CMUX_FAIL) && readFileSync(process.env.FAKE_CMUX_FAIL, "utf8") === args[0]) process.exit(1)
const opt = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null)
const records = process.env.FAKE_CMUX_RECORDS ? JSON.parse(readFileSync(process.env.FAKE_CMUX_RECORDS, "utf8")) : Array.from({ length: 1500 }, (_, i) => ({
  agent: "claude",
  agent_lifecycle: "idle",
  launch_arguments: ["claude", "-n", i === 1499 ? "worker-quiet" : "worker-" + i],
  launch_backed: true,
  pid: 10000 + i,
  session_id: "s-" + i,
  stored_pid_exists: true,
  surface_id: "surface-" + i,
  workspace_id: i === 1499 ? "W-QUIET" : "W-BUSY",
}))
if (args[0] === "sessions") {
  const sessions = records
    .filter((r) => !opt("--workspace") || r.workspace_id === opt("--workspace"))
    .filter((r) => !opt("--session") || r.session_id === opt("--session"))
  console.log(JSON.stringify({ sessions: sessions.slice(0, Number(opt("--limit") ?? 100)) }))
} else if (args[0] === "list-workspaces") {
  const ids = [...new Set(records.map((r) => r.workspace_id))]
  console.log(JSON.stringify({ workspaces: ids.map((id) => ({ id, ref: "ref-" + id, title: id })) }))
} else if (args[0] === "rpc") console.log(existsSync(process.env.FAKE_CMUX_FEED) ? readFileSync(process.env.FAKE_CMUX_FEED, "utf8") : JSON.stringify({ items: [] }))
else process.exit(1)
`

describe.skipIf(onLiveDashboard())("reading cmux's sessions", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
  })

  // A script on a live-reads process whose cmux is the fake above, started SLOW_CHILD seconds late when that is set, and whose Claude config folder is empty, with the calls that cmux got. It opts in to cmux's sessions unless `env` says otherwise.
  async function drive(
    script: string,
    records?: (dir: string) => unknown[],
    env: Record<string, string> = {},
  ) {
    const dir = mkdtempSync(join(tmpdir(), "workers-read-"))
    dirs.push(dir)
    const bin = join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(join(bin, "cmux"), FAKE_CMUX)
    chmodSync(join(bin, "cmux"), 0o755)
    slowChild("bun", bin)
    mkdirSync(join(dir, "config"))
    const log = join(dir, "cmux.log")
    const file = join(dir, "records.json")
    if (records) writeFileSync(file, JSON.stringify(records(dir)))
    const { code, result, stderr } = await inFixture(
      `const { listLive, listSpace, readDue, recordsProblem } = await import(\`\${API}/lib/dashboard/workers\`)
const { appendFileSync } = await import("node:fs")
const mark = (what) => appendFileSync(process.env.FAKE_CMUX_LOG, "-- " + what + "\\n")
${script}
process.exit(0)
`,
      dir,
      {
        CLAUDE_CONFIG_DIR: join(dir, "config"),
        PLAYGROUND_CMUX_SESSIONS: "true",
        PLAYGROUND_DATA_DIR: join(join(dir, "config"), "playground"),
        PLAYGROUND_LIVE_READS: "1",
        FAKE_CMUX_DELAY: join(dir, "delay"),
        FAKE_CMUX_FAIL: join(dir, "fail"),
        FAKE_CMUX_FEED: join(dir, "feed.json"),
        FAKE_CMUX_LOG: log,
        ...(records ? { FAKE_CMUX_RECORDS: file } : {}),
        PATH: `${bin}:${process.env.PATH}`,
        ...env,
      },
    )
    expect(stderr).not.toContain("error:")
    expect(code).toBe(0)
    return { calls: readFileSync(log, "utf8").trim().split("\n"), result }
  }

  // At a limit of 1,000, cmux's 1,873 records (9 Oct) left out every session quiet since the day before.
  test("the board asks cmux for every record it holds, so a session quiet for a day still shows", async () => {
    const { result } = await drive(`const board = await listLive()
console.log(JSON.stringify({ board: board.workers.length, quiet: board.workers.some((w) => w.name === "worker-quiet") }))`)
    expect(result).toEqual({ board: 1500, quiet: true })
  }, 60_000)

  // a herdr server's sessions join cmux's on the board (the fake cmux's records have no registry file here, so only herdr's is live), and a message's check of one reads herdr alone
  test("herdr's sessions join the board, with herdr's state and the C5 file's usage limit, a pane with no registry file is none, and a herdr session's check asks cmux nothing", async () => {
    const { calls, result } =
      await drive(`const { mkdirSync, writeFileSync } = await import("node:fs")
const { join } = await import("node:path")
const config = process.env.CLAUDE_CONFIG_DIR
const answer = (method, params) => {
  const pane = (id, status) => ({ agent_status: status, pane_id: id, terminal_id: "t-" + id, workspace_id: "w1" })
  if (method === "session.snapshot") return { snapshot: { panes: [pane("w1:p1", "blocked"), pane("w1:p2", "working")], workspaces: [{ label: "probes", workspace_id: "w1" }] } }
  if (params.pane_id === "w1:p2") return { process_info: { foreground_processes: [{ argv: ["/bin/zsh"], pid: 4343 }] } }
  return { process_info: { foreground_processes: [{ argv: ["claude", "-n", "worker-herdr-a"], cwd: "/tmp/probe-a", pid: 4242 }] } }
}
process.env.PLAYGROUND_HERDR_DIR = join(config, "playground", "herdr")
process.env.PLAYGROUND_HERDR_SESSIONS = "probes"
mkdirSync(join(config, "playground", "herdr"), { recursive: true })
Bun.listen({ unix: join(config, "playground", "herdr", "probes.sock"), socket: { data(conn, chunk) {
  const req = JSON.parse(new TextDecoder().decode(chunk).split("\\n")[0])
  conn.write(JSON.stringify({ id: req.id, result: answer(req.method, req.params) }) + "\\n")
  conn.end()
} } })
mkdirSync(join(config, "sessions"))
writeFileSync(join(config, "sessions", "4242.json"), JSON.stringify({ pid: 4242, sessionId: "h-1" }))
mkdirSync(join(config, "playground", "session-state"), { recursive: true })
writeFileSync(join(config, "playground", "session-state", "h-1.json"), JSON.stringify({ at: new Date().toISOString(), event: "StopFailure", resetsAt: "2026-10-18T05:00:00.000Z", sessionId: "h-1", state: "usage-limit" }))
const board = await listLive()
const herdr = board.workers.find((w) => w.name === "worker-herdr-a")
mark("space")
const space = await listSpace(herdr)
console.log(JSON.stringify({
  board: board.workers.length,
  herdr: [herdr.light, herdr.lifecycle, herdr.surface, herdr.workspace, herdr.usageLimit, board.surfaces.get("h-1")],
  space: space.workers.map((w) => w.name),
}))`)
    expect(result).toEqual({
      board: 1,
      herdr: [
        "needs-you",
        "needsInput",
        "herdr:probes:w1:p1",
        { ref: "herdr:probes:w1", title: "probes" },
        { resets: null, resetsAt: "2026-10-18T05:00:00.000Z" },
        "herdr:probes:w1:p1",
      ],
      space: ["worker-herdr-a"],
    })
    expect(calls.slice(calls.indexOf("-- space") + 1)).toEqual([])
  }, 60_000)

  // the launcher hands a stack cmux would not answer, while cmux held no live session, PLAYGROUND_HERDR_ALONE, and its boards then read herdr alone
  test("a dashboard that reads herdr alone shows herdr's sessions and asks cmux nothing, its board paced by no cmux read", async () => {
    const { calls, result } =
      await drive(`const { mkdirSync, writeFileSync } = await import("node:fs")
const { join } = await import("node:path")
const config = process.env.CLAUDE_CONFIG_DIR
process.env.PLAYGROUND_HERDR_ALONE = "1"
process.env.PLAYGROUND_HERDR_DIR = join(config, "playground", "herdr")
process.env.PLAYGROUND_HERDR_SESSIONS = "probes"
mkdirSync(join(config, "playground", "herdr"), { recursive: true })
Bun.listen({ unix: join(config, "playground", "herdr", "probes.sock"), socket: { data(conn, chunk) {
  const req = JSON.parse(new TextDecoder().decode(chunk).split("\\n")[0])
  const result = req.method === "session.snapshot"
    ? { snapshot: { panes: [{ agent_status: "working", pane_id: "w1:p1", terminal_id: "t-1", workspace_id: "w1" }], workspaces: [{ label: "probes", workspace_id: "w1" }] } }
    : { process_info: { foreground_processes: [{ argv: ["claude", "-n", "worker-herdr-a"], cwd: "/tmp/probe-a", pid: 4242 }] } }
  conn.write(JSON.stringify({ id: req.id, result }) + "\\n")
  conn.end()
} } })
mkdirSync(join(config, "sessions"))
writeFileSync(join(config, "sessions", "4242.json"), JSON.stringify({ pid: 4242, sessionId: "h-1" }))
mark("start")
const board = await listLive()
const again = await listLive({ since: Date.now(), wait: false })
console.log(JSON.stringify({ again: again.workers.length, due: readDue(Date.now()), names: board.workers.map((w) => w.name) }))`)
    expect(result).toEqual({ again: 1, due: null, names: ["worker-herdr-a"] })
    expect(calls.slice(calls.indexOf("-- start") + 1)).toEqual([])
  }, 60_000)

  // A fresh Playground on a Mac whose cmux runs sessions it never started: unless the stack opts in, its board, Feed and dispatcher slots hold its own herdr sessions alone, cmux answering or not
  describe("a stack's own sessions", () => {
    const others = (dir: string) => {
      mkdirSync(join(dir, "config", "sessions"), { recursive: true })
      writeFileSync(
        join(dir, "config", "sessions", `${process.pid}.json`),
        JSON.stringify({ name: "optimizer", pid: process.pid, sessionId: "c-1" }),
      )
      return [
        {
          agent: "claude",
          agent_lifecycle: "idle",
          launch_arguments: ["claude", "-n", "optimizer"],
          launch_backed: true,
          pid: process.pid,
          session_id: "c-1",
          stored_pid_exists: true,
          surface_id: "surface-c1",
          workspace_id: "W-OTHER",
        },
      ]
    }
    const own = (
      silent: boolean,
    ) => `const { mkdirSync, rmSync, writeFileSync } = await import("node:fs")
const { dirname, join } = await import("node:path")
const { DISPATCHER, DISPATCHER_SECONDARY, readDispatcherSlots } = await import(\`\${API}/lib/dashboard/workers\`)
const config = process.env.CLAUDE_CONFIG_DIR
process.env.PLAYGROUND_HERDR_DIR = join(config, "playground", "herdr")
process.env.PLAYGROUND_HERDR_SESSIONS = "factory"
mkdirSync(process.env.PLAYGROUND_HERDR_DIR, { recursive: true })
Bun.listen({ unix: join(process.env.PLAYGROUND_HERDR_DIR, "factory.sock"), socket: { data(conn, chunk) {
  const req = JSON.parse(new TextDecoder().decode(chunk).split("\\n")[0])
  const result = req.method === "session.snapshot"
    ? { snapshot: { panes: [{ agent_status: "idle", pane_id: "w1:p1", terminal_id: "t-1", workspace_id: "w1" }], workspaces: [{ label: "leads", workspace_id: "w1" }] } }
    : { process_info: { foreground_processes: [{ argv: ["claude", "-n", DISPATCHER], cwd: "/tmp/leads", pid: 4242 }] } }
  conn.write(JSON.stringify({ id: req.id, result }) + "\\n")
  conn.end()
} } })
const sessions = join(config, "sessions")
mkdirSync(sessions, { recursive: true })
writeFileSync(join(sessions, "4242.json"), JSON.stringify({ name: DISPATCHER, pid: 4242, sessionId: "h-1" }))
writeFileSync(join(sessions, "4343.json"), JSON.stringify({ name: DISPATCHER_SECONDARY, pid: 4343, sessionId: "c-2" }))
writeFileSync(process.env.FAKE_CMUX_FEED, ${JSON.stringify(JSON.stringify({ items: [questionItem("c-1")] }))})
${silent ? 'rmSync(join(dirname(process.env.FAKE_CMUX_LOG), "bin", "cmux"))' : ""}
mark("start")
const board = await listLive()
console.log(JSON.stringify({
  feed: board.workers.flatMap((w) => w.feed).length,
  names: board.workers.map((w) => (w.name === DISPATCHER ? "the dispatcher" : w.name) + ": " + w.role).sort(),
  slots: await readDispatcherSlots(),
}))`

    test.each([
      ["answering", false],
      ["silent", true],
    ])(
      "with cmux %s and no opt-in, only the dispatcher Playground started in herdr shows, with one dispatcher slot, and cmux is asked nothing",
      async (_, silent) => {
        const { calls, result } = await drive(own(silent), others, { PLAYGROUND_CMUX_SESSIONS: "" })
        expect(result).toEqual({ feed: 0, names: ["the dispatcher: dispatcher"], slots: 1 })
        expect(calls.slice(calls.indexOf("-- start") + 1)).toEqual([])
      },
      60_000,
    )

    test("opted in, cmux's sessions, their Feed and the second dispatcher's slot join the board as before", async () => {
      const { result } = await drive(own(false), others)
      expect(result).toEqual({
        feed: 1,
        names: ["optimizer: manager", "the dispatcher: dispatcher"],
        slots: 2,
      })
    }, 60_000)

    test("opted in but kept on herdr alone by the launcher, the board reads herdr alone and the slots still count the registry's second dispatcher, as before", async () => {
      const { calls, result } = await drive(own(true), others, { PLAYGROUND_HERDR_ALONE: "1" })
      expect(result).toEqual({ feed: 0, names: ["the dispatcher: dispatcher"], slots: 2 })
      expect(calls.slice(calls.indexOf("-- start") + 1)).toEqual([])
    }, 60_000)
  })

  // the session's transcript reaches herdrState through the board, so a turn after a stuck record (an Escape fires no hook) ends herdr's blocked
  test("a herdr session blocked on a prompt its transcript has moved past reads idle", async () => {
    const { result } = await drive(`const { mkdirSync, writeFileSync } = await import("node:fs")
const { join } = await import("node:path")
const config = process.env.CLAUDE_CONFIG_DIR
const ago = (s) => new Date(Date.now() - s * 1000).toISOString()
process.env.PLAYGROUND_HERDR_DIR = join(config, "playground", "herdr")
process.env.PLAYGROUND_HERDR_SESSIONS = "probes"
mkdirSync(join(config, "playground", "herdr"), { recursive: true })
Bun.listen({ unix: join(config, "playground", "herdr", "probes.sock"), socket: { data(conn, chunk) {
  const req = JSON.parse(new TextDecoder().decode(chunk).split("\\n")[0])
  const result = req.method === "session.snapshot"
    ? { snapshot: { panes: [{ agent_status: "blocked", pane_id: "w1:p1", terminal_id: "t-1", workspace_id: "w1" }], workspaces: [{ label: "probes", workspace_id: "w1" }] } }
    : { process_info: { foreground_processes: [{ argv: ["claude", "-n", "worker-herdr-a"], cwd: "/tmp/probe-a", pid: 4242 }] } }
  conn.write(JSON.stringify({ id: req.id, result }) + "\\n")
  conn.end()
} } })
mkdirSync(join(config, "sessions"))
writeFileSync(join(config, "sessions", "4242.json"), JSON.stringify({ pid: 4242, sessionId: "h-1" }))
mkdirSync(join(config, "playground", "session-state"), { recursive: true })
writeFileSync(join(config, "playground", "session-state", "h-1.json"), JSON.stringify({ at: ago(60), event: "PermissionRequest", sessionId: "h-1", state: "stuck" }))
mkdirSync(join(config, "projects", "-tmp-probe-a"), { recursive: true })
writeFileSync(join(config, "projects", "-tmp-probe-a", "h-1.jsonl"), JSON.stringify({ type: "user", timestamp: ago(30), message: { content: "go on" } }) + "\\n")
const herdr = (await listLive()).workers.find((w) => w.name === "worker-herdr-a")
console.log(JSON.stringify([herdr.lifecycle, herdr.light]))`)
    expect(result).toEqual(["idle", "idle"])
  }, 60_000)

  // herdr has no Feed, so a blocked herdr session's card comes from its transcript's open call, named by its hooks' stuck record
  test("a herdr session blocked on a picker gets its card from the transcript, marked herdr", async () => {
    const { result } = await drive(`const { mkdirSync, writeFileSync } = await import("node:fs")
const { join } = await import("node:path")
const config = process.env.CLAUDE_CONFIG_DIR
const ago = (s) => new Date(Date.now() - s * 1000).toISOString()
process.env.PLAYGROUND_HERDR_DIR = join(config, "playground", "herdr")
process.env.PLAYGROUND_HERDR_SESSIONS = "probes"
mkdirSync(join(config, "playground", "herdr"), { recursive: true })
Bun.listen({ unix: join(config, "playground", "herdr", "probes.sock"), socket: { data(conn, chunk) {
  const req = JSON.parse(new TextDecoder().decode(chunk).split("\\n")[0])
  const result = req.method === "session.snapshot"
    ? { snapshot: { panes: [{ agent_status: "blocked", pane_id: "w1:p1", terminal_id: "t-1", workspace_id: "w1" }], workspaces: [{ label: "probes", workspace_id: "w1" }] } }
    : { process_info: { foreground_processes: [{ argv: ["claude", "-n", "worker-herdr-a"], cwd: "/tmp/probe-a", pid: 4242 }] } }
  conn.write(JSON.stringify({ id: req.id, result }) + "\\n")
  conn.end()
} } })
mkdirSync(join(config, "sessions"))
writeFileSync(join(config, "sessions", "4242.json"), JSON.stringify({ pid: 4242, sessionId: "h-1" }))
mkdirSync(join(config, "playground", "session-state"), { recursive: true })
writeFileSync(join(config, "playground", "session-state", "h-1.json"), JSON.stringify({ at: ago(5), event: "PermissionRequest", reason: "question", sessionId: "h-1", state: "stuck", tool: "AskUserQuestion" }))
mkdirSync(join(config, "projects", "-tmp-probe-a"), { recursive: true })
const ask = { type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: { questions: [{ question: "Which port?", header: "Port", multiSelect: false, options: [{ label: "3000", description: "web" }, { label: "4000", description: null }] }] } }
writeFileSync(join(config, "projects", "-tmp-probe-a", "h-1.jsonl"), JSON.stringify({ type: "assistant", timestamp: ago(10), message: { model: "claude-opus-5-5", content: [ask] } }) + "\\n")
const herdr = (await listLive()).workers.find((w) => w.name === "worker-herdr-a")
console.log(JSON.stringify([herdr.light, herdr.herdr, herdr.feed]))`)
    expect(result).toEqual([
      "needs-you",
      true,
      [
        {
          at: expect.any(String),
          kind: "question",
          questions: [
            {
              header: "Port",
              multiSelect: false,
              options: [
                { description: "web", label: "3000" },
                { description: null, label: "4000" },
              ],
              prompt: "Which port?",
            },
          ],
          requestId: "toolu_ask",
        },
      ],
    ])
  }, 60_000)

  test("a message's check reads only the workspace that holds its session, or the session alone when it has none", async () => {
    const { calls, result } = await drive(`const board = await listLive()
const quiet = board.workers.find((w) => w.name === "worker-quiet")
mark("space")
const space = await listSpace(quiet)
mark("loose")
const loose = await listSpace({ ...quiet, workspace: null })
console.log(JSON.stringify({
  loose: loose.workers.map((w) => w.name),
  space: space.workers.map((w) => [w.name, space.surfaces.get(w.sessionId)]),
}))`)
    expect(result).toEqual({
      loose: ["worker-quiet"],
      space: [["worker-quiet", "surface-1499"]],
    })
    const after = (mark: string) => calls.slice(calls.indexOf(`-- ${mark}`) + 1)
    const sessionReads = (lines: string[]) => lines.filter((line) => line.startsWith("sessions"))
    expect(sessionReads(after("space")).slice(0, 1)).toEqual([
      "sessions list --workspace W-QUIET --json --limit 1000000",
    ])
    expect(sessionReads(after("loose"))).toEqual([
      "sessions list --session s-1499 --json --limit 1000000",
    ])
  }, 60_000)

  // an ops-unstick entry naming one session on another's surface put a wrong Waiting on you on Playground's row and held his messages, through deliver()'s read of his workspace alone
  test("an ops-unstick entry whose surface and name disagree marks neither session, on the board and in a workspace's read, and names itself", async () => {
    const { result } = await drive(
      `const { unstickProblem } = await import(\`\${API}/lib/dashboard/workers\`)
const { mkdirSync, writeFileSync } = await import("node:fs")
const { join } = await import("node:path")
const dir = join(process.env.PLAYGROUND_DATA_DIR, "ops", "unstick")
mkdirSync(dir, { recursive: true })
const entry = { kind: "permission", line: "Allow?", name: "worker-a", since: new Date().toISOString(), surface: "surface-b", workspace: "W-B" }
writeFileSync(join(dir, "state.json"), JSON.stringify({ blocked: [entry], writtenAt: new Date().toISOString() }))
const board = await listLive()
const space = async (name) => (await listSpace(board.workers.find((w) => w.name === name))).workers.map((w) => [w.name, w.light])
console.log(JSON.stringify({
  board: board.workers.map((w) => [w.name, w.light]).sort(),
  problem: unstickProblem(),
  spaces: [...(await space("worker-a")), ...(await space("worker-b"))],
}))`,
      () =>
        ["a", "b"].map((id, i) => ({
          agent: "claude",
          agent_lifecycle: "idle",
          launch_arguments: ["claude", "-n", `worker-${id}`],
          launch_backed: true,
          pid: 40000 + i,
          session_id: `s-${id}`,
          stored_pid_exists: true,
          surface_id: `surface-${id}`,
          workspace_id: `W-${id.toUpperCase()}`,
        })),
    )
    expect(result).toEqual({
      board: [
        ["worker-a", "idle"],
        ["worker-b", "idle"],
      ],
      problem:
        "ops-unstick lists worker-a as blocked (permission) on surface surface-b, which worker-b holds, so neither is marked",
      spaces: [
        ["worker-a", "idle"],
        ["worker-b", "idle"],
      ],
    })
  }, 60_000)

  // Three full reads ran at once on the live dashboard (9 Oct, load 58), and on 12 Oct the hub's back-to-back reads kept cmux's store read running at about a core (2,806 records, 5s of CPU a read) until the live board went blank.
  const twoSessions = () =>
    ["a", "b"].map((id, i) => ({
      agent: "claude",
      agent_lifecycle: "idle",
      launch_arguments: ["claude", "-n", `worker-${id}`],
      launch_backed: true,
      pid: 30000 + i,
      session_id: `s-${id}`,
      stored_pid_exists: true,
      surface_id: `surface-${id}`,
      workspace_id: `W-${id.toUpperCase()}`,
    }))
  const FULL = "sessions list --json --limit 1000000"
  const between = (calls: string[], from: string, to?: string) =>
    calls.slice(calls.indexOf(`-- ${from}`) + 1, to ? calls.indexOf(`-- ${to}`) : undefined)
  const fullReads = (calls: string[], from: string, to?: string) =>
    between(calls, from, to).filter((line) => line === FULL).length

  test("callers share the read in flight, and one right after it takes the records it read", async () => {
    const { calls } = await drive(
      `mark("five")
await Promise.all(Array.from({ length: 5 }, () => listLive()))
mark("soon")
await listLive()
console.log("{}")`,
      twoSessions,
    )
    expect([fullReads(calls, "five", "soon"), fullReads(calls, "soon")]).toEqual([1, 0])
  }, 60_000)

  test("a burst of board moves during a slow read starts no read beside it, and the next waits three times as long as it took", async () => {
    const { calls, result } = await drive(
      `const { onRead } = await import(\`\${API}/lib/dashboard/workers\`)
const { writeFileSync } = await import("node:fs")
let landed = 0
onRead(() => (landed ||= Date.now()))
writeFileSync(process.env.FAKE_CMUX_DELAY, "4000")
mark("burst")
const started = Date.now()
const boards = [listLive({ since: started, wait: false })]
// five moves across the read, not twenty: each board starts three fake cmux processes, and sixty at once ran a list-workspaces past its 20s on a loaded runner
for (let i = 0; i < 5; i++) {
  await Bun.sleep(400)
  boards.push(listLive({ since: Date.now(), wait: false }))
}
await Promise.all(boards)
writeFileSync(process.env.FAKE_CMUX_DELAY, "0")
mark("paced")
const since = Date.now()
const board = await listLive({ since, wait: false })
await listLive()
const now = Date.now()
console.log(JSON.stringify({ gap: readDue(since) + now - landed, took: landed - started, workers: board.workers.length }))`,
      twoSessions,
    )
    expect([fullReads(calls, "burst", "paced"), fullReads(calls, "paced")]).toEqual([1, 0])
    const { gap, took, workers } = result as { gap: number; took: number; workers: number }
    expect(workers).toBe(2)
    expect(took).toBeGreaterThanOrEqual(4000)
    // took ends and gap starts at the read's landing, so gap falls short of three times took only by the synchronous steps around the read's start and end
    expect(gap).toBeLessThanOrEqual(3 * took)
    expect(gap).toBeGreaterThan(3 * took - 1000)
  }, 60_000)

  test("a Feed prompt shows on the next board at once, from the newest records, with no full read", async () => {
    const { calls, result } = await drive(
      `const { writeFileSync } = await import("node:fs")
await listLive()
await Bun.sleep(2100)
writeFileSync(process.env.FAKE_CMUX_FEED, ${JSON.stringify(JSON.stringify({ items: [questionItem("s-a")] }))})
mark("prompt")
const board = await listLive({ since: Date.now(), wait: false })
console.log(JSON.stringify({ light: board.workers.find((w) => w.sessionId === "s-a")?.light }))`,
      twoSessions,
    )
    expect(result).toEqual({ light: "needs-you" })
    expect(between(calls, "prompt").filter((line) => line.startsWith("sessions"))).toEqual([])
    expect(between(calls, "prompt")).toContain('rpc feed.list {"pending_only":true}')
  }, 60_000)

  test("a failed read is shared until the pace allows the next", async () => {
    const { calls, result } = await drive(
      `const { writeFileSync } = await import("node:fs")
writeFileSync(process.env.FAKE_CMUX_FAIL, "sessions")
mark("fail")
const first = await listLive().then(() => false, () => true)
const again = await listLive({ since: Date.now(), wait: false }).then(() => false, () => true)
console.log(JSON.stringify({ again, due: readDue(Date.now()), first }))`,
      twoSessions,
    )
    expect(fullReads(calls, "fail")).toBe(1)
    const { again, due, first } = result as { again: boolean; due: number; first: boolean }
    expect([first, again]).toEqual([true, true])
    expect(due).toBeGreaterThan(9_000)
  }, 60_000)

  // 15 Oct: the Mac hibernated from 10:06:56Z to 10:17:00Z on 1% battery; the read out then failed on waking, the next waited MAX_GAP_MS, and the Dashboard read "cmux isn't running" while cmux answered, until a restart of the stack.
  test("after a read the machine slept through fails, the hub reads cmux again at once and its next frame is the board", async () => {
    const { calls, result } = await drive(
      `const { DashboardHub } = await import(\`\${API}/lib/dashboard/hub\`)
const { onRead } = await import(\`\${API}/lib/dashboard/workers\`)
const { rmSync, writeFileSync } = await import("node:fs")
const awake = Date.now
let slept = 0
Date.now = () => awake() + slept
writeFileSync(process.env.FAKE_CMUX_FAIL, "sessions")
// the clock jumps once the first read has started, so the read spans the sleep however late the hub starts it
const asleep = (options) => {
  const live = listLive(options)
  slept = 10 * 60_000
  return live
}
const frames = []
const hub = new DashboardHub({ approvals: false, events: false, listLive: asleep, pace: { due: readDue, onRead, refreshGapMs: 0 } })
mark("down")
// a hub that waits out the pace instead (MAX_GAP_MS) sends no board before the test's timeout
const { promise: board, resolve } = Promise.withResolvers()
const leave = hub.subscribe((frame) => {
  frames.push(frame.type === "workers" ? frame.workers.length : frame.type)
  if (frame.type === "workers") resolve()
  if (frame.type !== "error") return
  rmSync(process.env.FAKE_CMUX_FAIL, { force: true })
})
await board
leave()
console.log(JSON.stringify({ frames }))`,
      twoSessions,
    )
    const { frames } = result as { frames: unknown[] }
    expect(fullReads(calls, "down")).toBe(2)
    expect(frames[0]).toBe("error")
    expect(frames.slice(1)).toContain(2)
    expect(frames.slice(1).every((frame) => frame === 2)).toBe(true)
  }, 60_000)

  test("a route waiting on a read that fails takes the last good records, and the System report names the stand", async () => {
    const { calls, result } = await drive(
      `const { writeFileSync } = await import("node:fs")
await listLive()
await Bun.sleep(10_200)
const before = recordsProblem()
writeFileSync(process.env.FAKE_CMUX_FAIL, "sessions")
mark("fail")
const workers = await listLive().then((board) => board.workers.length, () => -1)
console.log(JSON.stringify({ before, problem: recordsProblem(), workers }))`,
      twoSessions,
    )
    expect(fullReads(calls, "fail")).toBe(1)
    const { before, problem, workers } = result as {
      before: unknown
      problem: string
      workers: number
    }
    expect([before, workers]).toEqual([null, 2])
    expect(problem).toMatch(
      /^The full sessions read from cmux failed \d+s ago \(.+\), so boards stand on sessions read 1\ds ago/,
    )
  }, 60_000)

  // The hub runs one refresh at a time, judged by when its listLive settles, so one that failed on another read while its sessions read ran on let the next start a read beside it (4 at once, in a review's round 3).
  test("a board read that fails elsewhere settles only once its sessions read has", async () => {
    const { result } = await drive(
      `const { writeFileSync } = await import("node:fs")
writeFileSync(process.env.FAKE_CMUX_DELAY, "3000")
writeFileSync(process.env.FAKE_CMUX_FAIL, "rpc")
const started = Date.now()
const failed = await listLive({ since: started, wait: false }).then(() => false, () => true)
console.log(JSON.stringify({ failed, waited: Date.now() - started >= 3000 }))`,
      twoSessions,
    )
    expect(result).toEqual({ failed: true, waited: true })
  }, 60_000)

  test("a message's one-session read is never shared", async () => {
    const { calls } = await drive(
      `const a = (await listLive()).workers.find((w) => w.name === "worker-a")
mark("narrow")
await Promise.all([listSpace(a), listSpace(a), listSpace(a)])
console.log("{}")`,
      twoSessions,
    )
    expect(between(calls, "narrow").filter((line) => line.startsWith("sessions"))).toEqual(
      Array(3).fill("sessions list --workspace W-A --json --limit 1000000"),
    )
  }, 60_000)

  // A name a /rename set more than 8MB back is known only from the reads kept between boards, so a message's check of another workspace must keep them.
  test("a message's check leaves the board's reads of every other session as they were", async () => {
    const records = (dir: string) =>
      ["a", "b"].map((id, i) => ({
        agent: "claude",
        agent_lifecycle: "idle",
        launch_arguments: ["claude", "-n", `worker-${id}`],
        launch_backed: true,
        pid: 20000 + i,
        session_id: `s-${id}`,
        stored_pid_exists: true,
        surface_id: `surface-${id}`,
        transcript_path: join(dir, `${id}.jsonl`),
        workspace_id: `W-${id.toUpperCase()}`,
      }))
    const { result } = await drive(
      `const { writeFileSync } = await import("node:fs")
const { join } = await import("node:path")
writeFileSync(join(process.cwd(), "a.jsonl"), JSON.stringify({ type: "agent-name", agentName: "worker-renamed" }) + "\\n")
writeFileSync(join(process.cwd(), "b.jsonl"), "")
const names = (live) => live.workers.map((w) => w.name).sort()
const before = names(await listLive())
const b = (await listLive()).workers.find((w) => w.name === "worker-b")
await listSpace(b)
const pad = (JSON.stringify({ pad: "x".repeat(1000), type: "progress" }) + "\\n").repeat(9 * 1024)
appendFileSync(join(process.cwd(), "a.jsonl"), pad)
console.log(JSON.stringify({ after: names(await listLive()), before }))`,
      records,
    )
    expect(result).toEqual({
      after: ["worker-b", "worker-renamed"],
      before: ["worker-b", "worker-renamed"],
    })
  }, 60_000)
})
