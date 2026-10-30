import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cmuxSessions,
  ownRegistered,
  SESSION_FILE,
} from "../../../../../../api/hono/src/lib/sessions/own"
import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const OWN = "11111111-1111-4111-8111-000000000001"
const HOSTED = "11111111-1111-4111-8111-000000000002"
const FOREIGN = "11111111-1111-4111-8111-000000000003"

// A machine with three live sessions in Claude's registry: one Playground's hooks recorded, the one it hosts on the Agent SDK, and one another checkout's factory runs.
const machine = () => {
  const dir = mkdtempSync(join(tmpdir(), "own-"))
  dirs.push(dir)
  const data = join(dir, "data")
  const probe = join(dir, "probe")
  mkdirSync(join(data, "session-state"), { recursive: true })
  mkdirSync(probe)
  writeFileSync(join(data, "session-state", `${OWN}.json`), "{}")
  writeFileSync(join(probe, SESSION_FILE), `${HOSTED}\n`)
  const files = [
    { pid: 101, text: JSON.stringify({ name: "dispatcher", pid: 101, sessionId: OWN }) },
    { pid: 102, text: JSON.stringify({ name: "probe-sdk", pid: 102, sessionId: HOSTED }) },
    { pid: 103, text: JSON.stringify({ name: "optimizer", pid: 103, sessionId: FOREIGN }) },
  ]
  return { data, dir, files, probe }
}

// Runs fn with the environment a stack reading this machine has, put back after.
const withEnv = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// PLAYGROUND_CMUX_SESSIONS read as the env schema's stringbool reads it, so the launcher, which reads the raw setting, and the API agree; a value it cannot read keeps the rest out
test("cmuxSessions opts in only on a value the env schema reads as true", () => {
  expect(["true", "1", "yes", "on", "TRUE"].map(cmuxSessions)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ])
  expect([undefined, "", "false", "0", "no", "maybe"].map(cmuxSessions)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
  ])
})

describe("ownRegistered", () => {
  const names = (env: Record<string, string | undefined>) => {
    const { data, files, probe } = machine()
    return withEnv(
      {
        PLAYGROUND_DATA_DIR: data,
        PLAYGROUND_FIXTURE: undefined,
        PLAYGROUND_SDK_PROBE_DIR: probe,
        ...env,
      },
      () => ownRegistered(files).map((session) => session.name),
    )
  }

  test("a stack that reads this machine counts the sessions Playground's hooks recorded and the one it hosts, never another's", () => {
    expect(names({ PLAYGROUND_CMUX_SESSIONS: undefined, PLAYGROUND_LIVE_READS: "1" })).toEqual([
      "dispatcher",
      "probe-sdk",
    ])
  })

  test("opted in, or on a fixture, every session counts", () => {
    expect(names({ PLAYGROUND_CMUX_SESSIONS: "true", PLAYGROUND_LIVE_READS: "1" })).toEqual([
      "dispatcher",
      "probe-sdk",
      "optimizer",
    ])
    expect(
      names({ PLAYGROUND_CMUX_SESSIONS: undefined, PLAYGROUND_LIVE_READS: undefined }),
    ).toEqual(["dispatcher", "probe-sdk", "optimizer"])
  })
})

// System's sampler joins the machine's processes to the registry's sessions it is given; on a stack that reads this machine those are Playground's own alone
describe.skipIf(onLiveDashboard())("System's sampler", () => {
  const sampled = async (env: Record<string, string>) => {
    const { data, dir, files, probe } = machine()
    const config = join(dir, "config")
    mkdirSync(join(config, "sessions"), { recursive: true })
    for (const file of files) writeFileSync(join(config, "sessions", `${file.pid}.json`), file.text)
    const { code, result, stderr } = await inFixture(
      `const { read } = await import(\`\${API}/lib/system/sampler\`)
const readings = await read()
console.log(JSON.stringify(readings.sessions.map((session) => session.name)))
process.exit(0)
`,
      dir,
      {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: data,
        PLAYGROUND_LIVE_READS: "1",
        PLAYGROUND_SDK_PROBE_DIR: probe,
        ...env,
      },
    )
    expect(stderr).not.toContain("error:")
    expect(code).toBe(0)
    return result
  }

  test("reads Playground's own sessions alone, and every one once the stack opts in", async () => {
    expect(await sampled({})).toEqual(["dispatcher", "probe-sdk"])
    expect(await sampled({ PLAYGROUND_CMUX_SESSIONS: "true" })).toEqual([
      "dispatcher",
      "probe-sdk",
      "optimizer",
    ])
  }, 60_000)
})
