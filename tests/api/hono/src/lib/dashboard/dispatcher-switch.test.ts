import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const { createSwitch, handoffAsk, switchBrief } =
  await import("../../../../../../api/hono/src/lib/dashboard/dispatcher-switch")
const { CODEX_LIVE_REFUSAL } = await import("../../../../../../api/hono/src/lib/onboard/harness")
type SwitchDeps =
  import("../../../../../../api/hono/src/lib/dashboard/dispatcher-switch").SwitchDeps
type Started = import("../../../../../../api/hono/src/lib/dashboard/dispatcher-start").Started

const DATA = "/scratch/data"
const HANDOFF = join(DATA, "handoffs", "dispatcher-switch.md")

// Every part faked: the dispatcher's answers to each start in order, whether the ask reaches it, and the handoff's mtime by poll; each call recorded in order, so no session is asked, closed or started.
const world = ({
  ask = true,
  handoff = [null, 2000, 2000] as (number | null)[],
  starts = [{ name: "dispatcher", status: "running" }] as Started[],
} = {}) => {
  const calls: string[] = []
  let clock = 1000
  let polls = 0
  const deps: SwitchDeps = {
    ask: async (name, text) => {
      calls.push(`ask ${name}: ${text}`)
      return ask
    },
    close: async (name) => {
      calls.push(`close ${name}`)
      return null
    },
    data: DATA,
    env: { HOME: "/scratch/home", PLAYGROUND_DATA_DIR: DATA },
    mtime: (path) => {
      calls.push(`mtime ${path}`)
      return handoff[Math.min(polls++, handoff.length - 1)] ?? null
    },
    name: "dispatcher",
    now: () => clock,
    pollMs: 10,
    save: (harness) => {
      calls.push(`save ${harness}`)
      return null
    },
    sleep: async (ms) => {
      clock += ms
    },
    start: async (harness, brief) => {
      calls.push(`start ${harness}${brief ? ` from ${brief}` : ""}`)
      return starts.shift() ?? { name: "dispatcher", status: "started" }
    },
    waitMs: 100,
  }
  return { calls, deps }
}

describe("Switch Alpha (#1835)", () => {
  test("a running dispatcher is asked for its handoff, closed once it is written and still, then started on the new harness from it", async () => {
    const { calls, deps } = world()
    const sw = createSwitch()
    const begun = sw.begin("codex", deps)
    expect(typeof begun).not.toBe("string")
    expect(sw.read()).toMatchObject({ harness: "codex", state: "running" })
    await (begun as { done: Promise<void> }).done
    expect(sw.read()).toMatchObject({ reason: null, state: "ok" })
    expect(calls).toEqual([
      "save codex",
      "start codex",
      `ask dispatcher: ${handoffAsk(HANDOFF, "dispatcher", "codex")}`,
      `mtime ${HANDOFF}`,
      `mtime ${HANDOFF}`,
      `mtime ${HANDOFF}`,
      "close dispatcher",
      `start codex from ${switchBrief("dispatcher")}`,
    ])
    expect(handoffAsk(HANDOFF, "dispatcher", "codex")).toContain(HANDOFF)
  })

  test("a handoff older than the ask does not count, and none in time fails with the dispatcher left running", async () => {
    const { calls, deps } = world({ handoff: [500] })
    const sw = createSwitch()
    await (sw.begin("claude-code", deps) as { done: Promise<void> }).done
    expect(sw.read()).toMatchObject({ state: "failed" })
    expect(sw.read().reason).toContain("still runs as before")
    expect(calls).not.toContain("close dispatcher")
  })

  test("a dispatcher that is not running starts on the new harness at once, asking nothing", async () => {
    const { calls, deps } = world({ starts: [{ name: "dispatcher", status: "started" }] })
    const sw = createSwitch()
    await (sw.begin("claude-code", deps) as { done: Promise<void> }).done
    expect(sw.read().state).toBe("ok")
    expect(calls).toEqual(["save claude-code", "start claude-code"])
  })

  test("an ask that does not reach the dispatcher closes nothing", async () => {
    const { calls, deps } = world({ ask: false })
    const sw = createSwitch()
    await (sw.begin("codex", deps) as { done: Promise<void> }).done
    expect(sw.read().state).toBe("failed")
    expect(calls.filter((c) => c.startsWith("close") || c.startsWith("mtime"))).toEqual([])
  })

  test("Codex on the live data folder is refused before anything is saved or asked", () => {
    const { calls, deps } = world()
    const sw = createSwitch()
    expect(sw.begin("codex", { ...deps, env: { HOME: "/scratch/home" } })).toBe(CODEX_LIVE_REFUSAL)
    expect(calls).toEqual([])
    expect(sw.read().state).toBe("idle")
  })

  test("a second switch while one runs is refused", async () => {
    const { deps } = world()
    const sw = createSwitch()
    const first = sw.begin("codex", deps) as { done: Promise<void> }
    expect(sw.begin("claude-code", deps)).toBe("A switch is already running")
    await first.done
  })
})
