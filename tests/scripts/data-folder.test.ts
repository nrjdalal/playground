import { afterAll, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { onGlm } from "../../scripts/hooks/no-glm-heavy-path"
import { check as headless } from "../../scripts/hooks/no-headless-login"
import { spawn, usage } from "./spawn-fake"

// PLAYGROUND_DATA_DIR names one folder, away from the config folder's: spawn.sh and the hooks that read what it writes all read there.
describe("PLAYGROUND_DATA_DIR is the one data folder spawn.sh and its hooks read", () => {
  const scratch = mkdtempSync(join(tmpdir(), "data-folder-"))
  afterAll(() => rmSync(scratch, { force: true, recursive: true }))

  test("spawn.sh reads the usage files and the pace override there, logs its gate there, and hands the folder to the session", async () => {
    const offUntil = new Date(Math.floor(Date.now() / 1000 + 86_400) * 1000)
    const week = usage({
      rate_limits: {
        five_hour: {
          used_percentage: 10,
          resets_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
        seven_day: {
          used_percentage: 29,
          resets_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        },
      },
    })
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {
        PACE_OFF_UNTIL: `${offUntil.toISOString().slice(0, 19)}Z\n`,
        PLAYGROUND_DATA_DIR: "{home}/data",
        USAGE_JSON: JSON.stringify(week),
      },
      undefined,
      undefined,
      (home) => renameSync(join(home, ".playground"), join(home, "data")),
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    const launches = join(r.home, "data", "launch")
    expect(readFileSync(join(launches, readdirSync(launches)[0] ?? ""), "utf8")).toContain(
      `PLAYGROUND_DATA_DIR=${join(r.home, "data")} `,
    )
    const log = readFileSync(join(r.home, "data", "ops", "capacity.jsonl"), "utf8")
    expect(JSON.parse(log.trim().split("\n").at(-1)!)).toMatchObject({
      readings: { week: 29 },
      verdict: "pass",
    })
  })

  test("no-glm-heavy-path reads a session's backend pin there", async () => {
    const config = join(scratch, "glm-config")
    const data = join(scratch, "glm-data")
    mkdirSync(join(config, "sessions"), { recursive: true })
    mkdirSync(join(data, "backends"), { recursive: true })
    writeFileSync(
      join(config, "sessions", "1.json"),
      JSON.stringify({ name: "worker-pinned", sessionId: "s-pinned" }),
    )
    writeFileSync(join(data, "backends", "worker-pinned"), "glm\n")
    const raw = JSON.stringify({ session_id: "s-pinned", tool_input: { command: "ls" } })
    expect(await onGlm(raw, { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: data })).toBe(true)
  })

  test("no-headless-login reads a session's resume record there", async () => {
    const config = join(scratch, "headless-config")
    const data = join(scratch, "headless-data")
    mkdirSync(join(config, "sessions"), { recursive: true })
    mkdirSync(join(data, "resume"), { recursive: true })
    writeFileSync(
      join(config, "sessions", "1.json"),
      JSON.stringify({ name: "worker-picked", sessionId: "s-picked" }),
    )
    writeFileSync(
      join(data, "resume", "worker-picked.sh"),
      "# account: picked@example.com\nexec scripts/spawn.sh resume worker-picked /x 1234\n",
    )
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "s-picked",
      tool_input: { command: "claude -p hi" },
      tool_name: "Bash",
    })
    expect(await headless(raw, { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: data })).toContain(
      "-a picked@example.com -w",
    )
  })
})
