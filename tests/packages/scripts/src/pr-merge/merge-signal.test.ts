import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// #552: a signal that stops pr:merge inside the merge lock once left it held, since only its own code reached the release; each run here is a child in a mkdtemp folder, so no test touches the factory's real lock.
const scratch = mkdtempSync(join(tmpdir(), "pr-merge-signal-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const CHILD = join(import.meta.dir, "signal-child.ts")

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Starts the child with args, waits for its "ready" line, runs before, sends it signal, runs after, and returns its exit code and everything it printed; a child still running when the test ends is killed.
async function stopped(
  args: string[],
  signal: NodeJS.Signals,
  {
    after = async () => {},
    before = async () => {},
  }: {
    after?: (child: Bun.Subprocess<"pipe", "pipe", "inherit">) => Promise<void>
    before?: () => Promise<void>
  } = {},
): Promise<{ code: number; out: string }> {
  const child = Bun.spawn(["bun", CHILD, ...args], {
    stderr: "inherit",
    stdin: "pipe",
    stdout: "pipe",
  })
  const reader = child.stdout.getReader()
  let out = ""
  const read = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      out += new TextDecoder().decode(value)
    }
  }
  try {
    while (!out.includes("ready")) {
      const { done, value } = await reader.read()
      if (done) throw new Error(`the child ended before it was ready: ${out}`)
      out += new TextDecoder().decode(value)
    }
    await before()
    child.kill(signal)
    await after(child)
    const [code] = await Promise.all([child.exited, read()])
    return { code, out }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
}

describe("a signal inside the merge lock", () => {
  test.each([
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "%s lets the lock go into merge-locks/, named for the signal",
    async (signal, code) => {
      const root = mkdtempSync(join(scratch, "lock-"))
      expect((await stopped(["lock", root], signal)).code).toBe(code)
      expect(existsSync(join(root, "merge.lock"))).toBe(false)
      expect(readdirSync(join(root, "merge-locks"))).toEqual([
        expect.stringMatching(new RegExp(`^112-\\d+-${signal}$`)),
      ])
    },
  )

  test("a lock that names another PR by then stays untouched", async () => {
    const root = mkdtempSync(join(scratch, "lock-"))
    const before = async () => writeFileSync(join(root, "merge.lock", "pr"), "150\n")
    expect((await stopped(["lock", root], "SIGTERM", { before })).code).toBe(143)
    expect(readFileSync(join(root, "merge.lock", "pr"), "utf8")).toBe("150\n")
    expect(existsSync(join(root, "merge-locks"))).toBe(false)
  })

  test("a signal before the squash lets the lock go, and the run never squashes", async () => {
    const root = mkdtempSync(join(scratch, "facts-"))
    const { code, out } = await stopped(["merge", root, "facts"], "SIGTERM")
    expect(code).toBe(143)
    expect(out).not.toContain("gh pr merge")
    expect(readdirSync(join(root, "merge-locks"))).toEqual([
      expect.stringMatching(/^112-\d+-SIGTERM$/),
    ])
  })

  test("a signal during the squash holds the lock until the squash settles, then lets it go", async () => {
    const root = mkdtempSync(join(scratch, "squash-"))
    const after = async (child: Bun.Subprocess<"pipe", "pipe", "inherit">) => {
      await Bun.sleep(300)
      expect(readFileSync(join(root, "merge.lock", "pr"), "utf8")).toBe("112\n")
      child.stdin.write("merged\n")
      await child.stdin.flush()
    }
    const { code, out } = await stopped(["merge", root, "squash"], "SIGTERM", { after })
    expect(code).toBe(143)
    expect(out).toContain("gh pr merge")
    expect(out).not.toContain("gh pr comment")
    expect(existsSync(join(root, "merge.lock"))).toBe(false)
    expect(readdirSync(join(root, "merge-locks"))).toEqual([
      expect.stringMatching(/^112-\d+-SIGTERM$/),
    ])
  })
})

describe("a signal inside the types gate", () => {
  test("ends its running step and keeps its worktree for the next merge, as its deadline does", async () => {
    const root = mkdtempSync(join(scratch, "types-"))
    const worktree = join(root, ".claude", "worktrees", "merge-types")
    const pidFile = join(root, "step.pid")
    const before = async () => {
      while (!existsSync(pidFile) || !readFileSync(pidFile, "utf8").trim()) await Bun.sleep(10)
      expect(existsSync(worktree)).toBe(true)
    }
    expect((await stopped(["types", root], "SIGTERM", { before })).code).toBe(143)
    expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false)
    expect(existsSync(worktree)).toBe(true)
  })

  test("kills and waits for its running step before the merge lock goes, since the next merge checks out into the same worktree", async () => {
    const root = mkdtempSync(join(scratch, "held-types-"))
    const pidFile = join(root, "step.pid")
    const before = async () => {
      while (!existsSync(pidFile) || !readFileSync(pidFile, "utf8").trim()) await Bun.sleep(10)
    }
    expect((await stopped(["held-types", root], "SIGTERM", { before })).code).toBe(143)
    expect(readFileSync(join(root, "step-saw"), "utf8").trim()).toBe("held")
    expect(existsSync(join(root, "merge.lock"))).toBe(false)
  })
})
