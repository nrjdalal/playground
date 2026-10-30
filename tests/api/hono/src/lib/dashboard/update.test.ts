import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FETCH_EVERY_MS,
  gitOf,
  processCheck,
  UpdateCheck,
  updateCheck,
  type UpdateGit,
  upstreamOf,
} from "../../../../../../api/hono/src/lib/dashboard/update"

const NEWEST = { at: "2026-10-12T08:00:00Z", title: "feat: something new" }

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// A fake git that counts its starts and fetches and answers with what the test sets.
const fakeGit = (
  start: { branch: string | null; head: string | null } | null,
  answer: () => Promise<{ behind: number; pulled: boolean }> = async () => ({
    behind: 2,
    pulled: false,
  }),
) => {
  const calls: string[] = []
  const git: UpdateGit = {
    start: () => {
      calls.push("start")
      return start
    },
    compare: async (upstream) => {
      calls.push(upstream)
      return { ...(await answer()), newest: NEWEST }
    },
  }
  return { calls, git }
}

describe("upstreamOf", () => {
  test("main follows main; canary and the live dashboard's branch follow canary", () => {
    expect(upstreamOf("main")).toBe("main")
    expect(upstreamOf("canary")).toBe("canary")
    expect(upstreamOf("live/dashboard")).toBe("canary")
  })

  test("any other branch, or a detached HEAD, follows nothing", () => {
    expect(upstreamOf("pg-497-update-available")).toBeNull()
    expect(upstreamOf(null)).toBeNull()
  })
})

describe("UpdateCheck", () => {
  test("a read never waits on git: the first answers nothing, the next the check's result", async () => {
    const { git } = fakeGit({ branch: "canary", head: "abc" })
    const check = new UpdateCheck(git, () => 0)
    expect(check.read()).toEqual({ problem: null, update: null })
    await settle()
    expect(check.read()).toEqual({
      problem: null,
      update: {
        behind: 2,
        branch: "canary",
        live: false,
        newest: NEWEST,
        pulled: false,
        upstream: "canary",
      },
    })
  })

  test("fetches at most once every 10 minutes, however often it is read", async () => {
    let now = 0
    const { calls, git } = fakeGit({ branch: "main", head: "abc" })
    const check = new UpdateCheck(git, () => now)
    for (const at of [0, 1000, 60_000, FETCH_EVERY_MS - 1]) {
      now = at
      check.read()
      await settle()
    }
    expect(calls).toEqual(["start", "main"])
    now = FETCH_EVERY_MS
    check.read()
    await settle()
    expect(calls).toEqual(["start", "main", "main"])
  })

  test("reads the build's start as the API starts, before any read, so a pull before the first read still counts", () => {
    const { calls, git } = fakeGit({ branch: "main", head: "abc" })
    new UpdateCheck(git, () => 0)
    expect(calls).toEqual(["start"])
  })

  test("one check a process: a module re-evaluated by a hot reload keeps the first, and reads no new start", () => {
    const { calls, git } = fakeGit({ branch: "main", head: "pulled" })
    expect(processCheck(git)).toBe(updateCheck)
    expect(processCheck(git)).toBe(updateCheck)
    expect(calls).toEqual([])
  })

  const readOnce = async (git: UpdateGit) => {
    const check = new UpdateCheck(git, () => 0)
    check.read()
    await settle()
    return check.read()
  }

  test("a feature branch, a detached HEAD or a build with no checkout says nothing, in problems too, and fetches nothing", async () => {
    const fakes = [
      fakeGit({ branch: "feat/x", head: "abc" }),
      // a feature branch with no commit yet, whose HEAD git cannot read
      fakeGit({ branch: "feat/x", head: null }),
      fakeGit({ branch: null, head: "abc" }),
      fakeGit(null),
    ]
    const reads = await Promise.all(fakes.map(({ git }) => readOnce(git)))
    expect(reads).toEqual([
      { problem: null, update: null },
      { problem: null, update: null },
      { problem: null, update: null },
      { problem: null, update: null },
    ])
    expect(fakes.map(({ calls }) => calls)).toEqual([["start"], ["start"], ["start"], ["start"]])
  })

  test("a fault (a failed fetch, or a HEAD that cannot be read on main, canary or with no branch at all) reports nothing and says why", async () => {
    const reads = await Promise.all(
      [
        fakeGit({ branch: "canary", head: "abc" }, async () => {
          throw new Error("git fetch failed: could not read from remote")
        }).git,
        fakeGit({ branch: "main", head: null }).git,
        // a checkout git cannot read at all: neither its branch nor its HEAD
        fakeGit({ branch: null, head: null }).git,
      ].map(readOnce),
    )
    expect(reads).toEqual([
      { problem: "Update check: git fetch failed: could not read from remote", update: null },
      { problem: "Update check: the checkout's HEAD cannot be read", update: null },
      { problem: "Update check: the checkout's HEAD cannot be read", update: null },
    ])
  })
})

describe("gitOf", () => {
  const dir = mkdtempSync(join(tmpdir(), "update-check-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  const run = (cwd: string, ...args: string[]) => {
    const out = Bun.spawnSync(["git", ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_AUTHOR_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
      },
      stderr: "pipe",
    })
    if (out.exitCode !== 0) throw new Error(out.stderr.toString())
    return out.stdout.toString().trim()
  }
  const commit = (cwd: string, file: string, title: string) => {
    writeFileSync(join(cwd, file), title)
    run(cwd, "add", file)
    run(cwd, "commit", "--quiet", "-m", title)
  }
  // A bare origin with one commit on canary, the clone that pushes to it, and a second clone of canary for the checkout under test, each test with its own.
  const repos = (name: string) => {
    const origin = join(dir, `${name}-origin`)
    const upstream = join(dir, `${name}-upstream`)
    const checkout = join(dir, `${name}-checkout`)
    run(dir, "init", "--quiet", "--bare", "--initial-branch=canary", origin)
    run(dir, "clone", "--quiet", origin, upstream)
    commit(upstream, "a", "chore: base")
    run(upstream, "push", "--quiet", "origin", "HEAD:canary")
    run(dir, "clone", "--quiet", "--branch", "canary", origin, checkout)
    return { checkout, upstream }
  }

  test("pulled only once the HEAD on disk holds everything upstream, never for a local commit", async () => {
    const { checkout: mine, upstream } = repos("mine")
    const git = gitOf(mine)
    const head = git.start()?.head ?? ""
    commit(upstream, "d", "fix: three")
    run(upstream, "push", "--quiet", "origin", "HEAD:canary")
    commit(mine, "local", "chore: a local commit")
    expect(await git.compare("canary", head)).toMatchObject({ behind: 1, pulled: false })
    run(mine, "merge", "--quiet", "--no-edit", "origin/canary")
    expect(await git.compare("canary", head)).toMatchObject({ behind: 1, pulled: true })
  })
})
