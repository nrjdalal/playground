import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const {
  childEnv,
  copyName,
  dumpArgv,
  loadRefusal,
  restoreArgv,
  setKey,
  startRefusal,
  startVibe,
  stopVibe,
  vibeEnv,
} = await import("../../../../../../api/hono/src/lib/dashboard/vibe")
type Deps = import("../../../../../../api/hono/src/lib/dashboard/vibe").Deps
type Stack = import("../../../../../../api/hono/src/lib/dashboard/stacks").Stack

const dir = mkdtempSync(join(tmpdir(), "vibe-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const LIVE = { branch: "live/dashboard", database: "playground-dashboard-db" }
const PASSWORD = "s3cret-copy-password"

// A linked worktree shaped as Playground's: a .git file, an .env.example and the migrations folder.
const worktree = (name: string, env?: string) => {
  const path = join(dir, name)
  mkdirSync(join(path, "packages/db/drizzle"), { recursive: true })
  mkdirSync(join(path, ".turbo"), { recursive: true })
  writeFileSync(join(path, ".git"), "gitdir: /elsewhere\n")
  writeFileSync(join(path, ".env.example"), "NODE_ENV=local\nPOSTGRES_URL=\nNEW_KEY=from-branch\n")
  if (env !== undefined) writeFileSync(join(path, ".env"), env)
  return path
}

const stack = (path: string, more: Partial<Stack> = {}): Stack => ({
  branch: "feat/yard-rooms",
  name: "yard-rooms",
  path,
  project: "playground",
  session: null,
  url: null,
  vibe: false,
  ...more,
})

// Every docker call and pipe recorded, each answering success unless a rule says otherwise.
const fake = (stacks: Stack[], over: Partial<Deps> = {}) => {
  const docker: { args: string[]; env?: Record<string, string> }[] = []
  const pipes: { from: string[]; to: string[] }[] = []
  const launched: string[] = []
  const deps: Deps = {
    docker: async (args, env) => {
      docker.push({ args, env })
      if (args[0] === "ps")
        return {
          code: 0,
          stderr: "",
          stdout: `${LIVE.database}-sY08\trunning\nother-db\trunning\n`,
        }
      if (args[0] === "port") return { code: 0, stderr: "", stdout: "127.0.0.1:41234\n" }
      return { code: 0, stderr: "", stdout: "" }
    },
    launch: (path) => launched.push(path),
    live: () => LIVE,
    load5: () => 4,
    migrate: async () => {},
    pipe: async (from, to) => {
      pipes.push({ from, to })
      return { bytes: 2048, error: null }
    },
    readsLive: () => true,
    secret: () => PASSWORD,
    stacks: async () => stacks,
    stop: async () => ({ code: 0, stderr: "", stdout: "dev:stop: stopped the stack" }),
    wait: async () => {},
    ...over,
  }
  return { deps, docker, launched, pipes }
}

const argvs = (f: ReturnType<typeof fake>) => [
  ...f.docker.map((call) => call.args),
  ...f.pipes.flatMap((pipe) => [pipe.from, pipe.to]),
]

describe("the pure parts", () => {
  test("the copy's name comes from the worktree's folder, made safe", () => {
    expect(copyName("/a/.claude/worktrees/yard rooms")).toBe("playground-vibe-yard-rooms-db")
  })

  test("the dump is pg_dump alone inside the live container, keeping claude_* empty, with no password", () => {
    expect(dumpArgv("live-db")).toEqual([
      "exec",
      "live-db",
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--no-owner",
      "--no-privileges",
      "--exclude-table-data=claude_*",
    ])
    expect(restoreArgv("copy-db").slice(0, 4)).toEqual(["exec", "-i", "copy-db", "psql"])
  })

  test("the load gate: one at a time over 15, none over 30", () => {
    expect(loadRefusal(10, 3)).toBeNull()
    expect(loadRefusal(16, 0)).toBeNull()
    expect(loadRefusal(16, 1)).toContain("over 15")
    expect(loadRefusal(31, 0)).toContain("over 30")
  })

  test("the .env starts from the branch's own .env.example and takes the copy and live reads", () => {
    const text = vibeEnv("NODE_ENV=local\nPOSTGRES_URL=\nNEW_KEY=x\n", "postgresql://c", "sec")
    expect(text).toContain("NEW_KEY=x\n")
    expect(text).toContain("POSTGRES_URL=postgresql://c\n")
    expect(text).toContain("PLAYGROUND_LIVE_READS=true\n")
    expect(text).toContain("PLAYGROUND_CMUX_SESSIONS=\n")
    expect(setKey("A=1", "B", "$2")).toBe("A=1\nB=$2\n")
  })

  test("a command keeps the same user's HOME and PATH and drops the live stack's settings", () => {
    expect(
      childEnv({ HOME: "/h", PATH: "/bin", POSTGRES_URL: "postgres://live", USER: "me" }),
    ).toEqual({ HOME: "/h", PATH: "/bin", USER: "me" })
  })

  test("Start refuses a running worktree, the live dashboard's, a checkout's own folder and a non-Playground one", () => {
    const path = worktree("refusals")
    const yes = () => true
    expect(startRefusal(undefined, LIVE, yes, yes)).toContain("no worktree")
    expect(startRefusal(stack(path, { url: "https://x" }), LIVE, yes, yes)).toContain("already")
    expect(startRefusal(stack(path, { branch: LIVE.branch }), LIVE, yes, yes)).toContain("live")
    expect(startRefusal(stack(path), LIVE, () => false, yes)).toContain("linked worktree")
    expect(startRefusal(stack(path), LIVE, yes, () => false)).toContain("not a Playground")
    expect(
      startRefusal(stack(path, { branch: "a/b/c-of-another-branch" }), LIVE, yes, yes),
    ).toBeNull()
  })
})

describe("Start", () => {
  test("runs an existing branch on a seeded copy, its own migrations, and its own .env", async () => {
    const path = worktree("start", "OLD=1\n")
    const migrated: string[] = []
    const f = fake([stack(path)], { migrate: async (_, folder) => void migrated.push(folder) })
    const seeded = await startVibe(path, f.deps)
    expect(seeded.bytes).toBe(2048)
    expect(f.pipes).toEqual([
      { from: dumpArgv(`${LIVE.database}-sY08`), to: restoreArgv(copyName(path)) },
    ])
    expect(migrated).toEqual([join(path, "packages/db/drizzle")])
    const env = readFileSync(join(path, ".env"), "utf8")
    expect(env).toContain("NEW_KEY=from-branch")
    expect(env).toContain(`POSTGRES_URL=postgresql://postgres:${PASSWORD}@127.0.0.1:41234/postgres`)
    expect(readFileSync(join(path, ".env.vibe-saved"), "utf8")).toBe("OLD=1\n")
    expect(JSON.parse(readFileSync(join(path, ".turbo/vibe.json"), "utf8")).container).toBe(
      copyName(path),
    )
    expect(f.launched).toEqual([path])
    const run = f.docker.find((call) => call.args[0] === "run")
    expect(run?.args).toContain("127.0.0.1::5432")
    expect(run?.env).toEqual({ POSTGRES_PASSWORD: PASSWORD })
  })

  test("never writes to the live database: pg_dump is the only command that names it, and no argv holds a password", async () => {
    const path = worktree("live-guard")
    const f = fake([stack(path)])
    await startVibe(path, f.deps)
    const live = `${LIVE.database}-sY08`
    const touching = argvs(f).filter((argv) => argv.includes(live))
    expect(touching).toEqual([dumpArgv(live)])
    expect(argvs(f).some((argv) => argv.some((word) => word.includes(PASSWORD)))).toBe(false)
  })

  test("a failed dump removes the copy and leaves the worktree's .env as it was", async () => {
    const path = worktree("failed", "OLD=1\n")
    const f = fake([stack(path)], {
      pipe: async () => ({ bytes: 10, error: "the dump took over 300s and was stopped" }),
    })
    expect(await startVibe(path, f.deps).catch((error: Error) => error.message)).toContain(
      "took over 300s",
    )
    expect(f.docker.at(-1)?.args).toEqual(["rm", "-fv", copyName(path)])
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("OLD=1\n")
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(false)
    expect(f.launched).toEqual([])
  })

  test("a failed migration puts the .env back and removes the copy", async () => {
    const path = worktree("migrate-fails", "OLD=2\n")
    const f = fake([stack(path)], {
      migrate: async () => {
        throw new Error("relation exists")
      },
    })
    expect(await startVibe(path, f.deps).catch((error: Error) => error.message)).toContain(
      "relation exists",
    )
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("OLD=2\n")
    expect(existsSync(join(path, ".env.vibe-saved"))).toBe(false)
    expect(f.docker.at(-1)?.args).toEqual(["rm", "-fv", copyName(path)])
  })

  test("the load gate and a missing live database refuse before any container starts", async () => {
    const path = worktree("gated")
    const busy = fake([stack(path), stack("/x", { url: "https://y", vibe: true })], {
      load5: () => 20,
    })
    expect(await startVibe(path, busy.deps).catch((error: Error) => error.message)).toContain(
      "over 15",
    )
    expect(busy.docker).toEqual([])
    const none = fake([stack(path)], {
      docker: async () => ({ code: 0, stderr: "", stdout: "other-db\trunning\n" }),
    })
    expect(await startVibe(path, none.deps).catch((error: Error) => error.message)).toContain(
      "not running",
    )
  })
})

describe("Stop", () => {
  test("stops the stack, removes the copy with rm -fv, puts the .env back and keeps the worktree", async () => {
    const path = worktree("stop", "OLD=3\n")
    const f = fake([stack(path)])
    await startVibe(path, f.deps)
    const stops: string[] = []
    const g = fake([stack(path, { url: "https://yard-rooms.playground.localhost", vibe: true })], {
      stop: async (at) => {
        stops.push(at)
        return { code: 0, stderr: "", stdout: "" }
      },
    })
    await stopVibe(path, g.deps)
    expect(stops).toEqual([path])
    expect(g.docker.map((call) => call.args)).toEqual([["rm", "-fv", copyName(path)]])
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("OLD=3\n")
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  test("refuses a stack it did not start", async () => {
    const path = worktree("not-vibe")
    const f = fake([stack(path, { url: "https://w" })])
    expect(await stopVibe(path, f.deps).catch((error: Error) => error.message)).toContain(
      "no Vibeground",
    )
    expect(f.docker).toEqual([])
  })
})
