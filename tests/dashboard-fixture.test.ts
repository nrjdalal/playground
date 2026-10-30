import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cleanGitShims, gitShim, inFixture, throughShim } from "./dashboard-fixture"

const helper = join(import.meta.dir, "dashboard-fixture.ts")
const dirs: string[] = []
const scratch = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  cleanGitShims()
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

describe("onLiveDashboard's git read (#1367)", () => {
  test("gives up on a git that never answers, in seconds, and reads as not the live dashboard", async () => {
    const bin = await gitShim("exec sleep 30")
    const { ms, r } = await throughShim(bin, helper, "m.onLiveDashboard()")
    expect(r).toBe(false)
    expect(ms).toBeLessThan(10_000)
  })

  test("a git that answers after a pause still decides the live dashboard", async () => {
    const bin = await gitShim("sleep 1\necho live/dashboard")
    const { r } = await throughShim(bin, helper, "m.onLiveDashboard()")
    expect(r).toBe(true)
  })
})

describe("inFixture's pipe reads (#1367)", () => {
  test("give up when a grandchild holds the child's output past the grace", async () => {
    const dir = scratch("infixture-hold")
    const started = Date.now()
    // the child exits at once, leaving an unref'd grandchild holding its stdout
    await expect(
      inFixture(`Bun.spawn(["sleep", "12"], { stdout: "inherit" }).unref()`, dir),
    ).rejects.toThrow("still unread")
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 30_000)

  test("a slowed child that answers still returns its result", async () => {
    const dir = scratch("infixture-slow")
    const { code, result } = await inFixture(
      `await Bun.sleep(1500)\nconsole.log(JSON.stringify({ slow: true }))`,
      dir,
    )
    expect(code).toBe(0)
    expect(result).toEqual({ slow: true })
  })

  test("a child that uses its whole run still drains its output", async () => {
    const dir = scratch("infixture-slow-read")
    const { code, result } = await inFixture(
      `await Bun.sleep(10_200)\nconsole.log(JSON.stringify({ slow: true }))`,
      dir,
    )
    expect(code).toBe(0)
    expect(result).toEqual({ slow: true })
  }, 30_000)
})
