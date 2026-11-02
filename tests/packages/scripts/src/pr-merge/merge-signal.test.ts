import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// #552: a signal that stops pr:merge inside the merge lock once left it held, since only its own code reached the release; each run here is a child in a mkdtemp folder, so no test touches the factory's real lock.
const scratch = mkdtempSync(join(tmpdir(), "pr-merge-signal-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const CHILD = join(import.meta.dir, "signal-child.ts")

// Starts the child in mode, waits for its "ready" line, runs before, sends it signal, and returns its exit code.
async function stopped(
  args: string[],
  signal: NodeJS.Signals,
  before: () => void = () => {},
): Promise<number> {
  const child = Bun.spawn(["bun", CHILD, ...args], { stderr: "inherit", stdout: "pipe" })
  const reader = child.stdout.getReader()
  let out = ""
  while (!out.includes("ready")) {
    const { done, value } = await reader.read()
    if (done) throw new Error(`the child ended before it was ready: ${out}`)
    out += new TextDecoder().decode(value)
  }
  before()
  child.kill(signal)
  return child.exited
}

describe("a signal inside the merge lock", () => {
  test.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
    ["SIGHUP", 129],
  ] as const)(
    "%s lets the lock go into merge-locks/, named for the signal",
    async (signal, code) => {
      const root = mkdtempSync(join(scratch, "lock-"))
      expect(await stopped(["lock", root, "112"], signal)).toBe(code)
      expect(existsSync(join(root, "merge.lock"))).toBe(false)
      expect(readdirSync(join(root, "merge-locks"))).toEqual([
        expect.stringMatching(new RegExp(`^112-\\d+-${signal}$`)),
      ])
    },
  )

  test("a lock that names another PR by then stays untouched", async () => {
    const root = mkdtempSync(join(scratch, "lock-"))
    const swap = () => writeFileSync(join(root, "merge.lock", "pr"), "150\n")
    expect(await stopped(["lock", root, "112"], "SIGTERM", swap)).toBe(143)
    expect(readFileSync(join(root, "merge.lock", "pr"), "utf8")).toBe("150\n")
    expect(existsSync(join(root, "merge-locks"))).toBe(false)
  })

  test("the types gate's worktree goes as on any other end", async () => {
    const root = mkdtempSync(join(scratch, "types-"))
    const worktree = join(root, ".claude", "worktrees", "merge-types-7")
    expect(
      await stopped(["types", root], "SIGTERM", () => expect(existsSync(worktree)).toBe(true)),
    ).toBe(143)
    expect(existsSync(worktree)).toBe(false)
  })
})
