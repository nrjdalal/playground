import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { fixtureRestart, restartArgv, restartSession } =
  await import("../../../../../../api/hono/src/lib/dashboard/restart")
type Run = import("../../../../../../api/hono/src/lib/dashboard/restart").Run

const scratch = mkdtempSync(join(tmpdir(), "restart-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const SESSION = {
  cwd: "/Users/made-up/playground/.claude/worktrees/leads",
  name: "dispatcher",
  sessionId: "0f000000-0000-4000-8000-000000000001",
}

// spawn.sh as a script: each argv recorded, the answers given in turn.
const spawn = (...answers: { code: number; stderr?: string }[]) => {
  const calls: string[][] = []
  const run: Run = async (argv) => {
    calls.push(argv)
    return { stderr: "", stdout: "", ...(answers[calls.length - 1] ?? { code: 0 }) }
  }
  return { calls, run }
}

describe("a restart after a login expires", () => {
  test("closes the pane spawn.sh opened, then resumes the same session on the account added", async () => {
    const { calls, run } = spawn({ code: 0 }, { code: 0 })
    const done = await restartSession(
      { ...SESSION, account: "made-up@example.com" },
      { live: true, root: "/p", run },
    )
    expect(done).toEqual({ status: "restarted" })
    expect(calls).toEqual([
      ["/p/scripts/spawn.sh", "close", "dispatcher"],
      [
        "/p/scripts/spawn.sh",
        "resume",
        "dispatcher",
        SESSION.cwd,
        SESSION.sessionId,
        "--account",
        "made-up@example.com",
      ],
    ])
  })

  test("with no account it resumes on this Mac's own login, naming no --account", () => {
    expect(restartArgv("/p", SESSION)[1]).toEqual([
      "/p/scripts/spawn.sh",
      "resume",
      "dispatcher",
      SESSION.cwd,
      SESSION.sessionId,
    ])
  })

  test("a refused close stops it there, with spawn.sh's own words", async () => {
    const { calls, run } = spawn({ code: 1, stderr: "spawn.sh: no pane is labelled dispatcher\n" })
    expect(await restartSession(SESSION, { live: true, root: "/p", run })).toEqual({
      detail: "spawn.sh: no pane is labelled dispatcher",
      status: "refused",
    })
    expect(calls).toHaveLength(1)
  })

  test("a fixture stack runs nothing and clears only that session's login block", () => {
    const path = join(scratch, "state.json")
    const blocked = [
      { kind: "login", name: "dispatcher" },
      { kind: "usage-limit", name: "dispatcher" },
      { kind: "login", name: "planner" },
    ]
    writeFileSync(path, JSON.stringify({ blocked, writtenAt: "2026-12-31T12:00:00.000Z" }))
    fixtureRestart("dispatcher", path)
    const state = JSON.parse(readFileSync(path, "utf8"))
    expect(state.blocked).toEqual(blocked.slice(1))
    expect(state.writtenAt).toBe("2026-12-31T12:00:00.000Z")
  })
})
