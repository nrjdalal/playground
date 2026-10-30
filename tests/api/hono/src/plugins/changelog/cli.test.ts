import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// The CLI as its own process, as ops runs it: inert while the plugin is off, and refusing a database it cannot prove is this machine's own before it reads or writes anything.
const CLI = join(import.meta.dir, "../../../../../../api/hono/src/plugins/changelog/cli.ts")
const ADD = ["add", "--kind", "ops", "--text", "A test line."]

const cli = (args: string[], env: Record<string, string>) => {
  const result = Bun.spawnSync([process.execPath, CLI, ...args], {
    env: { ...process.env, POSTGRES_URL: "postgres://u:p@db.example.com:5432/postgres", ...env },
    stderr: "pipe",
    stdout: "pipe",
  })
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
}

describe("the bun run changelog CLI", () => {
  test("writes nothing while the plugin is off", () => {
    const { code, out } = cli(ADD, { CHANGELOG_ENABLED: "false" })
    expect(code).toBe(0)
    expect(out).toContain("the changelog plugin is off")
  })

  test("refuses a database it cannot prove is a local container", () => {
    const { code, out } = cli(ADD, { CHANGELOG_ENABLED: "true" })
    expect(code).toBe(1)
    expect(out).toContain("refusing to write: POSTGRES_URL points at db.example.com")
  })

  test("refuses to read GitHub on a stack that does not read this machine, so a fixture stack holds no real lines", () => {
    for (const command of ["sync", "seed"]) {
      const { code, out } = cli([command], { CHANGELOG_ENABLED: "true", PLAYGROUND_LIVE_READS: "" })
      expect(code).toBe(1)
      expect(out).toContain(`${command} reads GitHub only on a stack that reads this machine`)
    }
  })

  test("prints the usage for a command it does not know, before touching the database", () => {
    const { code, out } = cli(["from-merge", "130"], { CHANGELOG_ENABLED: "true" })
    expect(code).toBe(2)
    expect(out).toContain("usage: bun run changelog sync")
  })
})
