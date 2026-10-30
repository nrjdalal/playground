import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/ops-restart/cli.ts")

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const temp = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-c", "user.email=ci@example.com", "-c", "user.name=ci", ...args], { cwd })
    .stdout.toString()
    .trim()

describe("ops-restart's cli", () => {
  test("reads jobs.json in the data folder PLAYGROUND_DATA_DIR names", () => {
    const co = temp("ops-restart-cli-co-")
    git(co, "init", "-q")
    writeFileSync(join(co, "a.txt"), "1\n")
    git(co, "add", ".")
    git(co, "commit", "-q", "-m", "one")
    const from = git(co, "rev-parse", "HEAD")
    writeFileSync(join(co, "a.txt"), "2\n")
    git(co, "commit", "-q", "-am", "two")
    const to = git(co, "rev-parse", "HEAD")
    const data = temp("ops-restart-cli-data-")
    const proc = Bun.spawnSync(["bun", CLI, co, from, to], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: temp("ops-restart-cli-config-"),
        PLAYGROUND_DATA_DIR: data,
      },
    })
    expect(proc.stdout.toString().trim()).toBe(
      `ops-restart: no ${join(data, "ops", "jobs.json")}, so no job to restart`,
    )
  })
})
