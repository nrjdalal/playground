import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { launchAfterRm, lw, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them, so each gets the sandbox tests' allowance.
setDefaultTimeout(40_000)

const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
const builtOf = (r: { home: string }, file: string) =>
  JSON.parse(readFileSync(settingsOf(r, file), "utf8"))

// #1484: the auto-memory trial turns memory on for one launch alone, so the shared built file every other session reads stays as it is
describe("--memory <dir> turns auto-memory on for one launch (#1484)", () => {
  const SHARED = "factory-settings-sandbox-400k.json"
  const OWN = "factory-settings-sandbox-400k-memory-probe-x.json"

  test("without it, a probe's built file keeps the factory's memory off, as before", async () => {
    const r = await spawn(["probe", "probe-x", "ops", "p.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, SHARED)} `)
    const built = builtOf(r, SHARED)
    expect(built.autoMemoryEnabled).toBe(false)
    expect(built).not.toHaveProperty("autoMemoryDirectory")
    expect(existsSync(settingsOf(r, OWN))).toBe(false)
  })

  test("with it, the launch reads a built file of its own that sets autoMemoryEnabled and autoMemoryDirectory, and the shared one is not written", async () => {
    const dir = "/tmp/made-up-memory"
    const r = await spawn(["probe", "probe-x", "ops", "p.md", "--memory", dir], [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, OWN)} `)
    expect(builtOf(r, OWN)).toMatchObject({ autoMemoryDirectory: dir, autoMemoryEnabled: true })
    expect(existsSync(settingsOf(r, SHARED))).toBe(false)
  })

  test("it takes an absolute folder, once", async () => {
    const relative = await spawn(["probe", "probe-x", "ops", "p.md", "--memory", "made-up"], [])
    expect(relative.code).not.toBe(0)
    expect(relative.err).toContain("--memory takes an absolute folder")
    const twice = await spawn(
      ["probe", "probe-x", "ops", "p.md", "--memory", "/tmp/a", "--memory", "/tmp/b"],
      [],
    )
    expect(twice.code).not.toBe(0)
    expect(twice.err).toContain("--memory takes an absolute folder")
    const close = await spawn(["close", "probe-x", "--memory", "/tmp/a"], [])
    expect(close.code).not.toBe(0)
    expect(close.err).toContain("close takes a session's name alone")
  })
})

// #1484's trial: each start takes an arm by its role, its settings file naming the role's own memory folder, and the roster row records the arm, so the A/B reads it back
describe("each start takes the memory trial's arm by its role (#1484)", () => {
  const ID = "a1b2c3d4-0000-4000-8000-000000001484"
  const claude = (name: string) => ({ backend: "claude", name })
  const built = (r: { home: string }, name: string) =>
    builtOf(r, `factory-settings-400k-memory-${name}.json`)
  const turnWas = (turn: string) => (home: string) => {
    mkdirSync(lw(home, "memory"), { recursive: true })
    writeFileSync(lw(home, "memory", "worker-arm"), `${turn}\n`)
  }

  test.each([
    ["the dispatcher", ["manager", "dispatcher", "b.md"], "dispatcher", "dispatcher"],
    ["the builder", ["manager", "builder", "b.md"], "builder", "builder"],
    ["ops", ["manager", "ops", "b.md"], "ops", "ops"],
    ["the planner", ["manager", "planner", "b.md"], "planner", "planner"],
  ])("%s starts with memory on in its kind's folder", async (_, args, name, kind) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(built(r, name)).toMatchObject({
      autoMemoryDirectory: lw(r.home, "memory", kind),
      autoMemoryEnabled: true,
    })
    expect(r.roster).toContain("memory=on")
  })

  test("a worker after an A-arm start takes the B arm, in worker-b, and the turn moves on", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      undefined,
      undefined,
      turnWas("off"),
    )
    expect(r.code, r.err).toBe(0)
    expect(built(r, "worker-brave-otter")).toMatchObject({
      autoMemoryDirectory: lw(r.home, "memory", "worker-b"),
      autoMemoryEnabled: true,
    })
    expect(r.roster).toContain("memory=on")
    expect(readFileSync(lw(r.home, "memory", "worker-arm"), "utf8")).toBe("on\n")
  })

  test.each([
    ["a first worker start", undefined],
    ["a worker after a B-arm start", "on"],
  ])("%s takes the A arm, off, and the turn moves on", async (_, turn) => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      undefined,
      undefined,
      turn ? turnWas(turn) : undefined,
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
    )
    expect(builtOf(r, "factory-settings-400k.json").autoMemoryEnabled).toBe(false)
    expect(r.roster).toContain("memory=off")
    expect(readFileSync(lw(r.home, "memory", "worker-arm"), "utf8")).toBe("off\n")
  })

  test("a resumed worker keeps its row's arm and leaves the turn as it is", async () => {
    const env = {
      ROSTER_JSON: JSON.stringify({
        agents: [
          {
            kind: "worker",
            memory: "on",
            name: "worker-brave-otter",
            role: "worker",
            status: "working",
            task: "t",
          },
        ],
      }),
    }
    const r = await spawn(
      ["resume", "worker-brave-otter", root, ID],
      [],
      env,
      undefined,
      claude("worker-brave-otter"),
      turnWas("on"),
    )
    expect(r.code, r.err).toBe(0)
    expect(built(r, "worker-brave-otter").autoMemoryDirectory).toBe(
      lw(r.home, "memory", "worker-b"),
    )
    expect(r.roster).toContain("memory=on")
    expect(readFileSync(lw(r.home, "memory", "worker-arm"), "utf8")).toBe("on\n")
  })

  test.each([
    ["a probe", ["probe", "probe-x", "ops", "p.md"], "factory-settings-sandbox-400k.json"],
    [
      "a GLM worker",
      ["worker", "worker-brave-otter", "b.md", "--backend", "glm"],
      "factory-settings-glm-400k.json",
    ],
    ["the optimizer", ["manager", "optimizer", "b.md"], "factory-settings-400k.json"],
    ["a runner", ["runner", "runner-brave-otter", "b.md"], "factory-settings-400k.json"],
  ])("%s stays off and leaves the workers' turn alone", async (_, args, file) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).autoMemoryEnabled).toBe(false)
    expect(r.roster).toContain("memory=off")
    expect(existsSync(lw(r.home, "memory", "worker-arm"))).toBe(false)
  })
})
