import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { capacityLog, launchAfterRm, placing, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const rosterOf = (agents: object[]) => JSON.stringify({ agents, updatedAt: "2026-11-03T00:00:00Z" })
// An orchestrator of a manager kind outside the six named ones, as roster.ts set writes its row.
const ASSISTANT = "x7mh4d-assistant"
const seated = rosterOf([
  {
    kind: "assistant",
    name: ASSISTANT,
    reportsTo: "dispatcher",
    role: "manager",
    status: "ended",
    task: "t",
  },
])

// The three gates a manager start takes, each failing alone, with the words its refusal prints.
const failing: [string, Record<string, string>, string][] = [
  [
    "load",
    { FAKE_LOAD5: "15.00" },
    "max(load1, load5) is 15.00 and 0 started in the last 5 minutes",
  ],
  [
    "memory",
    { FAKE_PRESSURE: "4" },
    "pressure level is 4 (sysctl kern.memorystatus_vm_pressure_level), 1 or 2 passes",
  ],
  ["usage", { USAGE_JSON: "{ nope" }, "usage.json (does not read)"],
]

describe("spawn.sh manager starts any orchestrator the roster kinds", () => {
  test("a kind outside the six, with its reportsTo, passes --check", async () => {
    const r = await spawn(["manager", ASSISTANT, "b.md", "--check"], [], { ROSTER_JSON: seated })
    expect(r.code, r.err).toBe(0)
    expect(r.out).toContain(`ok: ${ASSISTANT} can start`)
    expect(placing(r)).toEqual([])
  })

  test("it starts as a lead in the leads worktree, reporting to the session its row names", async () => {
    const r = await spawn(["manager", ASSISTANT, "brief-assistant.md"], [], { ROSTER_JSON: seated })
    expect(r.code, r.err).toBe(0)
    const command = launchAfterRm(r)
    expect(command).toStartWith(`(env PLAYGROUND_ROLE=lead claude -n ${ASSISTANT} `)
    expect(command).toContain(
      `You are ${ASSISTANT}, a lead in the Playground factory; you report to dispatcher.`,
    )
    expect(r.roster).toContain("kind=assistant")
  })

  test("a resume reopens it as a lead", async () => {
    const r = await spawn(["resume", ASSISTANT, root], [], { ROSTER_JSON: seated }, undefined, {
      name: ASSISTANT,
      backend: "claude",
    })
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toStartWith(`(env PLAYGROUND_ROLE=lead claude --resume ${ASSISTANT} `)
  })

  test("a name the roster gives no manager kind is refused, naming the roster.ts set that fixes it", async () => {
    const r = await spawn(["manager", "x7mh4d-worker", "b.md"], [], {
      ROSTER_JSON: rosterOf([
        {
          kind: "worker",
          name: "x7mh4d-worker",
          reportsTo: "dispatcher",
          role: "worker",
          task: "t",
        },
      ]),
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "roster.ts set <name> kind=<kind> reportsTo=<session> task=<what it does>",
    )
  })

  test("an orchestrator whose row names no reportsTo is refused, naming the roster.ts set that fixes it", async () => {
    const r = await spawn(["manager", ASSISTANT, "b.md"], [], {
      ROSTER_JSON: rosterOf([{ kind: "assistant", name: ASSISTANT, role: "manager", task: "t" }]),
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      `${ASSISTANT} is an orchestrator of the assistant kind, and its roster row names no session it reports to: roster.ts set ${ASSISTANT} reportsTo=<session>`,
    )
  })
})

describe("a manager start takes the capacity gate, and the first dispatcher starts past it", () => {
  test.each(failing)("the %s gate refuses an orchestrator's start", async (gate, env, says) => {
    const r = await spawn(["manager", ASSISTANT, "b.md"], [], { ...env, ROSTER_JSON: seated })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`the ${gate} gate holds it: `)
    expect(r.err).toContain(says)
    expect(capacityLog(r)).toEqual([expect.objectContaining({ gate, verdict: "refused" })])
  })

  test.each(failing)("the %s gate refuses a builder's start", async (gate, env) => {
    const r = await spawn(["manager", "builder", "b.md"], [], env)
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(capacityLog(r)).toEqual([expect.objectContaining({ gate, verdict: "refused" })])
  })

  test.each(failing)(
    "the first dispatcher starts past the %s gate, its row skipped",
    async (gate, env, says) => {
      const r = await spawn(["manager", "dispatcher", "b.md"], [], env)
      expect(r.code, r.err).toBe(0)
      expect(launchAfterRm(r)).toContain("claude -n dispatcher")
      expect(r.out).toContain(
        `spawn.sh: the first dispatcher starts past the ${gate} gate, which would hold another start: `,
      )
      expect(r.out).toContain(says)
      expect(capacityLog(r)).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining(says),
          gate,
          verdict: "skipped",
        }),
      ])
    },
  )

  test("a first dispatcher's skipped row counts as a start in the load gate's window", async () => {
    const skipped = JSON.stringify({
      at: new Date().toISOString().slice(0, 19) + "Z",
      gate: "memory",
      readings: { units: 2 },
      verdict: "skipped",
    })
    const r = await spawn(["runner", "runner-x", "b.md"], [], {
      CAPACITY_JSONL: `${skipped}\n`,
      FAKE_LOAD5: "11.00",
    })
    expect(r.err).toContain("and 1 started in the last 5 minutes")
  })
})
