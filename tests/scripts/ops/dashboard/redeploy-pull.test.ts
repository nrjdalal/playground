import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", "..", "..")
const pull = join(root, "scripts", "ops", "dashboard", "redeploy-pull.sh")
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "redeploy-pull-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(
    ["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
    .stdout.toString()
    .trim()

// An origin with canary, a dashboard clone on live/dashboard, and a stand-in turbo there that logs each build it is asked for, and a stand-in ops-restart that writes the move it is handed
const origin = join(scratch, "origin.git")
const seed = join(scratch, "seed")
const dashboard = join(scratch, "dashboard")
const builds = join(scratch, "builds")
git(scratch, "init", "-q", "--bare", origin)
await Bun.write(join(seed, "packages", "config", "src", "kinds.ts"), "0\n")
await Bun.write(join(seed, "packages", "scripts", "src", "x.ts"), "0\n")
await Bun.write(join(seed, "README.md"), "0\n")
const migrations = join(scratch, "migrations")
await Bun.write(
  join(seed, "package.json"),
  JSON.stringify({ scripts: { "db:migrate": `echo migrated >> ${migrations}` } }),
)
const restarts = join(scratch, "restarts")
await Bun.write(
  join(seed, "packages", "scripts", "src", "ops-restart", "cli.ts"),
  `await Bun.write(${JSON.stringify(restarts)}, process.argv.slice(2).join(" "))\n`,
)
git(seed, "init", "-q", "-b", "canary")
git(seed, "add", ".")
git(seed, "commit", "-qm", "c0")
git(seed, "push", "-q", origin, "canary")
git(scratch, "clone", "-q", "-b", "canary", origin, dashboard)
git(dashboard, "switch", "-q", "-c", "live/dashboard")
await Bun.write(
  join(dashboard, "node_modules", ".bin", "turbo"),
  `#!/bin/sh\necho "$NODE_ENV $*" >> ${builds}\nexit "\${TURBO_EXIT:-0}"\n`,
)
chmodSync(join(dashboard, "node_modules", ".bin", "turbo"), 0o755)

const MIGRATION_0011 = await Bun.file(
  join(root, "packages", "db", "drizzle", "0011_threads.sql"),
).text()
const INDEX_0011 = MIGRATION_0011.split("\n").find((line) => line.startsWith("CREATE UNIQUE INDEX"))
const outbox = join(scratch, "playground", "ops", "outbox", "ops-dashboard.jsonl")

const rollAfter = async (file: string, turboExit = "0", text = `${Date.now()}\n`) => {
  rmSync(builds, { force: true })
  await Bun.write(join(seed, file), text)
  git(seed, "add", file)
  git(seed, "commit", "-qm", file)
  git(seed, "push", "-q", origin, "canary")
  const proc = Bun.spawn(["bash", pull], {
    cwd: dashboard,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: scratch,
      PLAYGROUND_DATA_DIR: join(scratch, "playground"),
      TURBO_EXIT: turboExit,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await proc.exited
  const out = await new Response(proc.stdout).text()
  const built = (await Bun.file(builds).exists()) ? await Bun.file(builds).text() : ""
  return { code, head: git(dashboard, "rev-parse", "HEAD"), lines: out.split("\n"), built }
}

describe("the dashboard's pull (#1392)", () => {
  test("builds packages/* when the pull changed a shared package", async () => {
    const { code, head, lines, built } = await rollAfter("packages/config/src/kinds.ts")
    expect(code).toBe(0)
    expect(head).toBe(git(seed, "rev-parse", "HEAD"))
    expect(lines).toContain("build")
    expect(built).toBe("production run build --filter=./packages/*\n")
  })

  test("exits non-zero when the build fails", async () => {
    const { code, built } = await rollAfter("packages/config/src/kinds.ts", "1")
    expect(code).not.toBe(0)
    expect(built).toBe("production run build --filter=./packages/*\n")
  })

  test("builds nothing when the pull changed only packages/scripts", async () => {
    const { code, lines, built } = await rollAfter("packages/scripts/src/x.ts")
    expect(code).toBe(0)
    expect(lines).not.toContain("build")
    expect(built).toBe("")
  })

  test("hands the move, from the old head to the new, to ops-restart", async () => {
    const old = git(dashboard, "rev-parse", "HEAD")
    const { code } = await rollAfter("README.md")
    expect(code).toBe(0)
    expect(await Bun.file(restarts).text()).toBe(`${dashboard} ${old} HEAD`)
  })

  // An index on claude_entry blocks bun run ingest's writes while it builds, so the roll holds a migration that builds indexes alone for a quiet moment; one that adds a table or a column migrates now, since the new head's code uses them
  test.each([
    [
      "holds",
      "a migration that builds 0011_threads's unique index alone",
      "9001_unique.sql",
      INDEX_0011,
      true,
    ],
    [
      "holds",
      "a migration that builds a plain index alone",
      "9002_plain.sql",
      'create index "x" on "claude_entry" ("seq");',
      true,
    ],
    [
      "migrates",
      "0011_threads whole, which adds a table and columns",
      "9003_threads.sql",
      MIGRATION_0011,
      false,
    ],
  ])("%s %s", async (_, __, name, statement, held) => {
    rmSync(outbox, { force: true })
    rmSync(migrations, { force: true })
    const { code, lines } = await rollAfter(`packages/db/drizzle/${name}`, "0", `${statement}\n`)
    expect(code).toBe(0)
    expect([lines.includes("migrate-held"), lines.includes("migrate")]).toEqual([held, !held])
    expect(await Bun.file(migrations).exists()).toBe(!held)
    expect(await Bun.file(outbox).exists()).toBe(held)
  })

  test("builds nothing when the pull changed nothing under packages/", async () => {
    const { code, lines, built } = await rollAfter("README.md")
    expect(code).toBe(0)
    expect(lines).not.toContain("build")
    expect(built).toBe("")
  })
})
