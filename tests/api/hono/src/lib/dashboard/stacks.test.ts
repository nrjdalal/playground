import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  branchOf,
  commonDirOf,
  ownersOf,
  projectOf,
  stacksOf,
  webRoutes,
  worktreesOf,
} from "../../../../../../api/hono/src/lib/dashboard/stacks"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

// the owner: "this preview thingy should be vibeground, working on multiple projects, or worktrees and things"
describe("webRoutes", () => {
  test("each web host with a process behind it, with the process group portless started it in", () => {
    expect(
      webRoutes([
        { childPgid: 21, hostname: "pg-2.playground.localhost", pid: 2 },
        { hostname: "desk.playground.localhost", pid: 1 },
      ]),
    ).toEqual([
      { groups: [21], hostname: "pg-2.playground.localhost" },
      { groups: [], hostname: "desk.playground.localhost" },
    ])
  })

  test("an API host, an alias (pid 0, or none), a bare app host and an outside host are left out", () => {
    expect(
      webRoutes([
        { hostname: "api.pg-2.playground.localhost", pid: 3 },
        { hostname: "pg-2.api.playground.localhost", pid: 3 },
        { hostname: "alias.playground.localhost" },
        { hostname: "alias.desk.playground.localhost", pid: 0 },
        { hostname: "playground.localhost", pid: 4 },
        { hostname: "pg-2.dispatcher.example.com", pid: 5 },
        { pid: 6 },
      ]),
    ).toEqual([])
  })

  test("a routes file that is not a list reads as no routes", () => {
    expect(webRoutes(null)).toEqual([])
    expect(webRoutes({ hostname: "desk.playground.localhost", pid: 1 })).toEqual([])
  })
})

describe("ownersOf", () => {
  test("a session counts for the deepest worktree holding its folder, never the checkout around it, the first A to Z where several share one", () => {
    const owners = ownersOf(
      [
        { cwd: "/r/.claude/worktrees/a/web", name: "zed-worker" },
        { cwd: "/r/.claude/worktrees/a", name: "abc-worker" },
        { cwd: "/r", name: "dispatcher" },
        { cwd: "/elsewhere", name: "stray" },
        { cwd: "/r2", name: "lookalike" },
      ],
      ["/r", "/r/.claude/worktrees/a", "/r/.claude/worktrees/b"],
    )
    expect([...owners]).toEqual([
      ["/r/.claude/worktrees/a", "abc-worker"],
      ["/r", "dispatcher"],
    ])
  })
})

describe("stacksOf", () => {
  const worktrees = [
    { branch: "canary", path: "/p", project: "playground" },
    { branch: "feat/b", path: "/p/.claude/worktrees/b", project: "playground" },
    { branch: null, path: "/y", project: "yard" },
  ]

  test("a worktree runs where a web route's process group is one its stack's record names, the rest stopped with no URL, and a Vibeground is marked", () => {
    expect(
      stacksOf({
        records: new Map([
          ["/p/.claude/worktrees/b", [40, 41, 42]],
          ["/y", [70]],
        ]),
        routes: [
          { childPgid: 42, hostname: "feat-b.playground.localhost", pid: 9 },
          { childPgid: 43, hostname: "feat-b.api.playground.localhost", pid: 9 },
        ],
        sessions: [{ cwd: "/p/.claude/worktrees/b", name: "b-worker" }],
        vibes: new Set(["/p/.claude/worktrees/b"]),
        worktrees,
      }),
    ).toEqual([
      {
        branch: "canary",
        name: "p",
        path: "/p",
        project: "playground",
        session: null,
        url: null,
        vibe: false,
      },
      {
        branch: "feat/b",
        name: "feat-b",
        path: "/p/.claude/worktrees/b",
        project: "playground",
        session: "b-worker",
        url: "https://feat-b.playground.localhost",
        vibe: true,
      },
      {
        branch: null,
        name: "y",
        path: "/y",
        project: "yard",
        session: null,
        url: null,
        vibe: false,
      },
    ])
  })

  test("a web stack no worktree claims still lists, under its app's name, so no running stack drops off the picker", () => {
    expect(
      stacksOf({
        records: new Map(),
        routes: [{ childPgid: 5, hostname: "desk.lightman.localhost", pid: 4 }],
        sessions: [],
        worktrees: [],
      }),
    ).toEqual([
      {
        branch: null,
        name: "desk",
        path: null,
        project: "lightman",
        session: null,
        url: "https://desk.lightman.localhost",
        vibe: false,
      },
    ])
  })
})

describe("reading git's own files", () => {
  test("the HEAD's branch, null when detached, and the origin's repository name over https or ssh", () => {
    expect(branchOf("ref: refs/heads/feat/rooms")).toBe("feat/rooms")
    expect(branchOf("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBeNull()
    expect(branchOf(null)).toBeNull()
    const config = (url: string) => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n`
    expect(projectOf(config("https://github.com/someone/yard.git"))).toBe("yard")
    expect(projectOf(config("git@github.com:someone/playground"))).toBe("playground")
    expect(projectOf("[core]\n\tbare = false\n")).toBeNull()
  })

  test("every worktree of a checkout, from a folder inside any of them, with its branch and the origin's name", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "stacks-")))
    dirs.push(root)
    const main = join(root, "yard")
    Bun.spawnSync(["mkdir", "-p", join(main, "web")])
    git(main, "init", "-q", "-b", "main")
    git(main, "remote", "add", "origin", "https://github.com/someone/yard.git")
    writeFileSync(join(main, "a"), "a")
    git(main, "add", "a")
    git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a")
    const linked = join(main, ".claude/worktrees/rooms")
    git(main, "worktree", "add", "-q", linked, "-b", "feat/rooms")
    const gone = join(main, ".claude/worktrees/gone")
    git(main, "worktree", "add", "-q", "--detach", gone)
    rmSync(gone, { force: true, recursive: true })

    const common = commonDirOf(join(linked))
    expect(common).toBe(join(main, ".git"))
    expect(commonDirOf(join(main, "web"))).toBe(join(main, ".git"))
    expect(commonDirOf(tmpdir())).toBeNull()
    expect(worktreesOf(common ?? "")).toEqual([
      { branch: "main", path: main, project: "yard" },
      { branch: "feat/rooms", path: linked, project: "yard" },
    ])
  })
})
