import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { scopeRefusal } from "../../../../packages/scripts/src/commit-scope"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/commit-scope.ts")
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

describe("scopeRefusal", () => {
  test("refuses a PG scope that differs from the branch's PG prefix, naming both", () => {
    expect(scopeRefusal("fix(spawn): a thing (PG-12)", "PG-85-bare-pick")).toBe(
      "commit-scope: the message names (PG-12), but the branch PG-85-bare-pick is PG-85: commit it on PG-12's branch, or give it PG-85's scope",
    )
  })

  test("passes a matching scope in either case, a branch with no PG prefix, and a message with no PG scope", () => {
    expect(scopeRefusal("fix(spawn): a thing (PG-85)", "PG-85-bare-pick")).toBeUndefined()
    expect(scopeRefusal("fix(spawn): a thing (pg-85)", "pg-85-bare-pick")).toBeUndefined()
    expect(scopeRefusal("fix(spawn): a thing (PG-12)", "feat/dashboard-prod-build")).toBeUndefined()
    expect(scopeRefusal("fix(spawn): a thing", "PG-85-bare-pick")).toBeUndefined()
    expect(scopeRefusal("fix(spawn): a thing (PG-12)", "")).toBeUndefined()
  })
})

describe("commit-scope.ts as lefthook runs it", () => {
  // a scratch repository on the branch given, and the script's exit and stderr on a message file
  const run = (branch: string, message: string) => {
    const repo = mkdtempSync(join(tmpdir(), "commit-scope-"))
    dirs.push(repo)
    Bun.spawnSync(["git", "init", "-q", "-b", branch], { cwd: repo })
    const file = join(repo, "MSG")
    writeFileSync(file, `${message}\n\nbody\n`)
    const r = Bun.spawnSync([process.execPath, SCRIPT, file], { cwd: repo, stderr: "pipe" })
    return { code: r.exitCode, err: r.stderr.toString() }
  }

  test("exits 1 on the wrong branch with the refusal, and 0 on its own", () => {
    const wrong = run("PG-85-bare-pick", "fix(spawn): a thing (PG-12)")
    expect(wrong.code).toBe(1)
    expect(wrong.err).toContain(
      "the message names (PG-12), but the branch PG-85-bare-pick is PG-85",
    )
    expect(run("PG-12-other", "fix(spawn): a thing (PG-12)")).toEqual({ code: 0, err: "" })
  })
})

test("lefthook's commit-msg runs it on the message file", async () => {
  const config = Bun.YAML.parse(
    await Bun.file(join(import.meta.dir, "../../../../lefthook.yml")).text(),
  ) as { "commit-msg": { commands: Record<string, { run: string }> } }
  expect(config["commit-msg"].commands["pg-scope"]?.run).toBe(
    "bun packages/scripts/src/commit-scope.ts {1}",
  )
})
