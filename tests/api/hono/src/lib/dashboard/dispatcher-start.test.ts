import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { dispatcherArgv, startDispatcher } =
  await import("../../../../../../api/hono/src/lib/dashboard/dispatcher-start")
const { loadFixture, writeFixture } =
  await import("../../../../../../api/hono/src/lib/dashboard/fixture")
const { isLiveRecord } = await import("../../../../../../api/hono/src/lib/dashboard/workers")
const { readRegistry, registryOf, startsOf } =
  await import("../../../../../../api/hono/src/lib/dashboard/peers")
type Run = import("../../../../../../api/hono/src/lib/dashboard/dispatcher-start").Run

const scratch = mkdtempSync(join(tmpdir(), "dispatcher-start-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The CLI as a script: each argv recorded, one answer for every call.
const cli = (answer: { code: number; stderr?: string; stdout?: string }) => {
  const calls: string[][] = []
  const run: Run = async (argv) => {
    calls.push(argv)
    return { stderr: "", stdout: "", ...answer }
  }
  return { calls, run }
}

const live = (run: Run) =>
  startDispatcher({ live: true, name: "dispatcher", root: "/fixture/playground", run })

describe("startDispatcher on a stack reading its own machine", () => {
  test("runs the CLI's dispatcher step through its one fixed argv", async () => {
    const { calls, run } = cli({ code: 0, stdout: "Started dispatcher\n" })
    expect(await live(run)).toEqual({ name: "dispatcher", status: "started" })
    expect(dispatcherArgv("/fixture/playground")).toEqual([
      "bun",
      "/fixture/playground/packages/scripts/src/playground/cli.ts",
      "dispatcher",
    ])
    expect(calls).toEqual([dispatcherArgv("/fixture/playground")])
  })

  test("reads exit 3 as already running, 1 as refused with the CLI's own words, and anything else as failed", async () => {
    expect(await live(cli({ code: 3 }).run)).toEqual({ name: "dispatcher", status: "running" })
    const reason = `spawn.sh refuses dispatcher: no herdr server ${"x".repeat(400)}`
    const refused = await live(cli({ code: 1, stderr: `${reason}\n` }).run)
    expect(refused.status).toBe("refused")
    expect("detail" in refused && refused.detail).toBe(reason)
    expect((await live(cli({ code: 2 }).run)).status).toBe("failed")
  })

  test("with no checkout to run from, runs nothing and fails", async () => {
    const { calls, run } = cli({ code: 0 })
    const answer = await startDispatcher({ live: true, name: "dispatcher", root: null, run })
    expect(answer.status).toBe("failed")
    expect(calls).toEqual([])
  })
})

describe("startDispatcher on a fixture stack", () => {
  // The shipped fixture with its dispatcher's record ended, the home's no-dispatcher state.
  let made = 0
  const ended = () => {
    const dir = join(scratch, `fixture-${made++}`)
    const loaded = loadFixture(null)
    if (!loaded.ok) throw new Error(loaded.error)
    writeFixture(loaded.fixture, dir)
    const path = join(dir, "cmux.json")
    const state = JSON.parse(readFileSync(path, "utf8"))
    for (const s of state.sessions) {
      if (s.launch_arguments?.includes("dispatcher")) s.stored_pid_exists = false
    }
    writeFileSync(path, JSON.stringify(state))
    return dir
  }
  const dispatcherRecord = (dir: string) =>
    JSON.parse(readFileSync(join(dir, "cmux.json"), "utf8")).sessions.find(
      (s: { launch_arguments?: string[] }) => s.launch_arguments?.includes("dispatcher"),
    )

  test("runs no process, brings the made-up dispatcher back, and a second start reads already running", async () => {
    const dir = ended()
    const { calls, run } = cli({ code: 0 })
    const start = () =>
      startDispatcher({ dir, live: false, name: "dispatcher", root: "/fixture/playground", run })
    expect(await start()).toEqual({ name: "dispatcher", status: "started" })
    expect(dispatcherRecord(dir).stored_pid_exists).toBe(true)
    expect(await start()).toEqual({ name: "dispatcher", status: "running" })
    expect(calls).toEqual([])
  })

  test("a fixture with no dispatcher at all, a fresh machine, starts a made-up one the board reads as live", async () => {
    const dir = ended()
    const path = join(dir, "cmux.json")
    const state = JSON.parse(readFileSync(path, "utf8"))
    state.sessions = state.sessions.filter(
      (s: { launch_arguments?: string[] }) => !s.launch_arguments?.includes("dispatcher"),
    )
    writeFileSync(path, JSON.stringify(state))
    const { calls, run } = cli({ code: 0 })
    const start = () =>
      startDispatcher({ dir, live: false, name: "dispatcher", root: "/fixture/playground", run })
    expect(await start()).toEqual({ name: "dispatcher", status: "started" })
    const record = dispatcherRecord(dir)
    expect(record).toMatchObject({ agent: "claude", stored_pid_exists: true })
    const machine = JSON.parse(readFileSync(join(dir, "machine.json"), "utf8"))
    const ps = Object.entries(machine.processes as Record<string, { start: string }>)
      .map(([pid, p]) => `${pid} ${p.start}`)
      .join("\n")
    const proof = {
      projects: join(dir, "claude", "projects"),
      registry: registryOf(await readRegistry(join(dir, "claude", "sessions"))),
      starts: startsOf(ps),
    }
    expect(isLiveRecord(record, proof)).toBe(true)
    expect(await start()).toEqual({ name: "dispatcher", status: "running" })
    expect(calls).toEqual([])
  })
})
