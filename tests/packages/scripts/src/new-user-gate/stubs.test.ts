import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GATE_LABEL,
  stubs,
  usageReading,
} from "../../../../../packages/scripts/src/new-user-gate/stubs"

const box = realpathSync(mkdtempSync(join(tmpdir(), "gate-stubs-")))
afterAll(() => rmSync(box, { force: true, recursive: true }))

// The box's stand-ins, with a docker that logs its argv and answers port with a loopback address, and a real bunx that logs what it was handed
const bin = join(box, "bin")
for (const [name, text] of Object.entries(stubs(box, join(bin, "real-bunx")))) {
  await Bun.write(join(bin, name), text)
  chmodSync(join(bin, name), 0o755)
}
writeFileSync(
  join(bin, "docker"),
  `#!/bin/sh\necho "$*" >> ${box}/docker.log\n[ "$1" = inspect ] && exit 1\n[ "$1" = port ] && echo 127.0.0.1:54321\nexit 0\n`,
)
writeFileSync(join(bin, "real-bunx"), `#!/bin/sh\necho "real $*"\n`)
chmodSync(join(bin, "docker"), 0o755)
chmodSync(join(bin, "real-bunx"), 0o755)
const call = (name: string, ...args: string[]) => {
  const out = Bun.spawnSync([join(bin, name), ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  return { code: out.exitCode, out: out.stdout.toString() }
}

describe("the gate's pglaunch stand-in", () => {
  test("starts a labelled container published on loopback alone, and prints what first run reads as pglaunch's", () => {
    const { code, out } = call(
      "bunx",
      "--bun",
      "pglaunch@5.5.7",
      "-k",
      "-n",
      "playground-dashboard-db",
    )
    expect(code).toBe(0)
    // the two lines parseLaunch in api/hono/src/lib/setup/container.ts reads from pglaunch: the started name, a dash and 4 letters as the live dashboard's name rule takes, and the URL
    expect(out).toBe(
      'name "playground-dashboard-db-gate :54321" started\npostgres://postgres:postgres@localhost:54321/postgres\n',
    )
    const run = readFileSync(join(box, "docker.log"), "utf8")
      .split("\n")
      .find((line) => line.startsWith("run "))
    expect(run).toContain(`--label ${GATE_LABEL}`)
    expect(run).toContain("-p 127.0.0.1::5432")
  })

  test("hands every other bunx call to the real one", () => {
    expect(call("bunx", "portless", "get", "playground").out).toBe("real portless get playground\n")
  })
})

describe("the gate's gh stand-in", () => {
  test("answers a made-up login and logs a PR's create, so the route step can see it", () => {
    expect(call("gh", "api", "user").out).toBe("gate-user\n")
    expect(call("gh", "pr", "create", "--fill").code).toBe(0)
    expect(readFileSync(join(box, "calls.log"), "utf8")).toContain("gh pr create --fill")
  })
})

describe("the gate's claude stand-in", () => {
  test("answers a call that names no session at once, as an install's checks make it", () => {
    expect(call("claude", "auth", "status")).toEqual({ code: 0, out: '{"loggedIn": true}\n' })
    expect(call("claude", "--version").code).toBe(0)
  })
})

describe("usageReading", () => {
  test("seeds a stored login in the Keychain file and answers usage with both windows resetting after now", () => {
    const now = Date.parse("2026-10-31T00:00:00Z")
    const reading = usageReading("gate", now)
    const [service, account, secret] = reading.keychain.trimEnd().split("\t")
    expect([service, account]).toEqual(["Claude Code-credentials", "gate"])
    expect(JSON.parse(secret!).claudeAiOauth.expiresAt).toBeGreaterThan(now)
    expect(reading.usage).toEqual({
      five_hour: { resets_at: "2026-10-31T03:00:00+00:00", utilization: 5 },
      seven_day: { resets_at: "2026-11-05T00:00:00+00:00", utilization: 10 },
    })
  })
})
