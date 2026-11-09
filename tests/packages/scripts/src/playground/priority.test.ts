import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BEATS } from "../../../../../packages/scripts/src/ops-tick/tick"
import {
  lapse,
  LAPSE_HOURS,
  runPriority,
  windowPath,
} from "../../../../../packages/scripts/src/playground/priority"

const DIR = mkdtempSync(join(tmpdir(), "priority-"))
afterAll(() => rmSync(DIR, { force: true, recursive: true }))

const NOW = new Date("2026-11-09T19:40:00Z")
const HOUR = 3_600_000

let count = 0
// a data folder of its own, the caller named lead-1 and the clock at now
const machine = (now = NOW) => {
  const data = join(DIR, `data-${++count}`)
  mkdirSync(data, { recursive: true })
  const deps = { by: async () => "lead-1", data, now: () => now }
  const log = () => {
    const path = join(data, "ops", "priority.log")
    return existsSync(path) ? readFileSync(path, "utf8") : ""
  }
  return { data, deps, log }
}

const printed: string[] = []
const said: string[] = []
const logSpy = spyOn(console, "log").mockImplementation((line: string) => void printed.push(line))
const errorSpy = spyOn(console, "error").mockImplementation((line: string) => void said.push(line))
afterAll(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})
beforeEach(() => {
  printed.length = 0
  said.length = 0
})

const open = (deps: ReturnType<typeof machine>["deps"], session = "res-worker") =>
  runPriority(["on", session, "--reason", "the owner asked for this research now"], deps)

describe("playground priority on", () => {
  test("writes priority-<session>.json, the name spawn.sh's priority*.json glob reads, naming the session, who opened it, the reason and the time, and logs who and why", async () => {
    const { data, deps, log } = machine()
    expect(await open(deps)).toBe(0)
    expect(windowPath(data, "res-worker")).toBe(join(data, "priority-res-worker.json"))
    expect(JSON.parse(readFileSync(windowPath(data, "res-worker"), "utf8"))).toEqual({
      by: "lead-1",
      reason: "the owner asked for this research now",
      session: "res-worker",
      since: NOW.toISOString(),
    })
    expect(log()).toBe(
      `${NOW.toISOString()} on res-worker by lead-1: the owner asked for this research now\n`,
    )
  })

  test("refuses with no reason, and a session that is not a session's name, writing nothing", async () => {
    const { data, deps, log } = machine()
    expect(await runPriority(["on", "res-worker"], deps)).toBe(2)
    expect(await runPriority(["on", "res-worker", "--reason", "  "], deps)).toBe(2)
    expect(await runPriority(["on", "../x", "--reason", "why"], deps)).toBe(2)
    expect(await runPriority(["on", "--reason", "why"], deps)).toBe(2)
    expect(readdirSync(data)).toEqual([])
    expect(log()).toBe("")
  })
})

describe("playground priority off", () => {
  test("lifts the window aside, out of spawn.sh's glob, and logs who and why", async () => {
    const later = new Date(NOW.getTime() + 10 * 60_000)
    const { data, deps, log } = machine()
    await open(deps)
    const off = { ...deps, now: () => later }
    expect(await runPriority(["off", "res-worker", "--reason", "started it"], off)).toBe(0)
    expect(existsSync(windowPath(data, "res-worker"))).toBe(false)
    expect(readdirSync(data).filter((name) => /^priority.*\.json$/.test(name))).toEqual([])
    expect(readdirSync(data)).toContain("priority-res-worker.json.lifted-20261109T195000Z")
    expect(log().split("\n")[1]).toBe(`${later.toISOString()} off res-worker by lead-1: started it`)
  })

  test("takes a reason, and with no window standing lifts and logs nothing", async () => {
    const { deps, log } = machine()
    await open(deps)
    expect(await runPriority(["off", "res-worker"], deps)).toBe(2)
    expect(await runPriority(["off", "other-worker", "--reason", "done"], deps)).toBe(0)
    expect(printed.at(-1)).toBe("priority: no window stands for other-worker")
    expect(log().split("\n").filter(Boolean)).toHaveLength(1)
  })
})

describe("files playground priority did not write", () => {
  // each priority file another writer keeps: the urgent window, a job's start file and an org's own window
  const others = ["priority.json", "priority-start.json", "priority-acme.json"]
  const seed = (data: string) => {
    for (const name of others) writeFileSync(join(data, name), `{"by":"${name}"}\n`)
  }
  const untouched = (data: string) =>
    expect(others.map((name) => readFileSync(join(data, name), "utf8"))).toEqual(
      others.map((name) => `{"by":"${name}"}\n`),
    )

  const JOB_FILE = "priority-start.json is a job's own start file"
  test.each([
    ["on", "start", JOB_FILE],
    ["on", "acme", "priority-acme.json stands and playground priority did not write it"],
    ["off", "start", JOB_FILE],
    ["off", "acme", "priority-acme.json stands and playground priority did not write it"],
  ])("%s %s refuses, naming its writer", async (verb, session, refusal) => {
    const { data, deps, log } = machine()
    seed(data)
    expect(await runPriority([verb, session, "--reason", "why"], deps)).toBe(2)
    expect(said.at(-1)).toContain(refusal)
    untouched(data)
    expect(log()).toBe("")
  })

  test.each(["on", "off"])(
    "%s start refuses with no priority-start.json standing, writing nothing, since that name is a job's",
    async (verb) => {
      const { data, deps, log } = machine()
      expect(await runPriority([verb, "start", "--reason", "why"], deps)).toBe(2)
      expect(said.at(-1)).toContain(JOB_FILE)
      expect(readdirSync(data)).toEqual([])
      expect(log()).toBe("")
    },
  )

  test("a job's priority-start.json shaped like this command's record, and a file whose name only ends in a window's, stay their writers'", async () => {
    const { data } = machine()
    const record = (session: string) =>
      JSON.stringify({ by: "a job", reason: "r", session, since: NOW.toISOString() })
    writeFileSync(join(data, "priority-start.json"), record("start"))
    writeFileSync(join(data, "priority-priority-x.json"), record("x"))
    expect(await lapse(data, new Date(NOW.getTime() + 100 * HOUR))).toEqual([])
    expect(readdirSync(data).sort()).toEqual(["priority-priority-x.json", "priority-start.json"])
  })

  test("priority.json, which no session's name reaches, stands through every on, off and lapse", async () => {
    const { data, deps } = machine()
    seed(data)
    await open(deps)
    await runPriority(["off", "res-worker", "--reason", "done"], deps)
    await lapse(data, new Date(NOW.getTime() + 100 * HOUR))
    untouched(data)
  })

  test("a lapse lifts none of them, however long they have stood", async () => {
    const { data } = machine()
    seed(data)
    expect(await lapse(data, new Date(NOW.getTime() + 100 * HOUR))).toEqual([])
    untouched(data)
  })
})

describe("a stale window", () => {
  test(`one standing past LAPSE_HOURS (${LAPSE_HOURS}h) is lifted with a log line, and one younger stands`, async () => {
    const { data, deps, log } = machine()
    await open(deps, "old-worker")
    const young = new Date(NOW.getTime() + HOUR)
    await open({ ...deps, now: () => young }, "new-worker")
    const at = new Date(NOW.getTime() + LAPSE_HOURS * HOUR)
    const line = `${at.toISOString()} lapsed old-worker: stood ${LAPSE_HOURS}h since ${NOW.toISOString()}, opened by lead-1: the owner asked for this research now`
    expect(await lapse(data, at)).toEqual([line])
    expect(existsSync(windowPath(data, "old-worker"))).toBe(false)
    expect(existsSync(windowPath(data, "new-worker"))).toBe(true)
    expect(log().trim().split("\n").at(-1)).toBe(line)
    expect(await lapse(data, at)).toEqual([])
  })

  test("ops-tick's priority-lapse beat, every 5 minutes, lifts it and tells ops its line", async () => {
    const beat = BEATS.find((b) => b.name === "priority-lapse")!
    expect([beat.cron, beat.to]).toEqual(["*/5 * * * *", "ops"])
    const { data, deps } = machine()
    await open(deps)
    const sent: string[][] = []
    await beat.run({
      now: new Date(NOW.getTime() + LAPSE_HOURS * HOUR),
      ops: join(data, "ops"),
      repo: data,
      run: async () => ({ code: 0, out: "" }),
      send: async (to, text) => (sent.push([to, text]), true),
    })
    expect(sent).toEqual([["ops", expect.stringContaining(" lapsed res-worker: stood ")]])
    expect(existsSync(windowPath(data, "res-worker"))).toBe(false)
  })

  test("a window whose record does not read is left for its writer and lifts nothing", async () => {
    const { data } = machine()
    writeFileSync(join(data, "priority-res-worker.json"), "not json")
    expect(await lapse(data, new Date(NOW.getTime() + 100 * HOUR))).toEqual([])
    expect(existsSync(join(data, "priority-res-worker.json"))).toBe(true)
  })
})

describe("playground priority, bare", () => {
  test("lists each window standing, and names every other priority file standing", async () => {
    const { data, deps } = machine()
    await open(deps)
    writeFileSync(join(data, "priority-start.json"), "{}\n")
    printed.length = 0
    expect(await runPriority([], deps)).toBe(0)
    expect(printed).toEqual([
      `priority: res-worker since ${NOW.toISOString()} by lead-1: the owner asked for this research now`,
      "priority: priority-start.json stands, written by another writer",
    ])
  })

  test("reads none stands with none", async () => {
    const { deps } = machine()
    expect(await runPriority([], deps)).toBe(0)
    expect(printed).toEqual(["priority: none stands"])
  })
})
