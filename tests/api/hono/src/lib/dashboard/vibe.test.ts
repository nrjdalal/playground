import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const {
  childEnv,
  copyData,
  copyName,
  dumpArgv,
  loadRefusal,
  ownVibe,
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
  const launchData: string[] = []
  const copied: string[] = []
  const migrated: string[] = []
  const deps: Deps = {
    copyData: (_from, to) => {
      copied.push(to)
    },
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
    launch: (path, _log, data) => {
      launched.push(path)
      launchData.push(data)
    },
    live: () => LIVE,
    load5: () => 4,
    migrate: async (url) => {
      migrated.push(url)
    },
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
  return { copied, deps, docker, launchData, launched, migrated, pipes }
}

const argvs = (f: ReturnType<typeof fake>) => [
  ...f.docker.map((call) => call.args),
  ...f.pipes.flatMap((pipe) => [pipe.from, pipe.to]),
]

describe("the pure parts", () => {
  test("the copy's name comes from the worktree's folder, made safe, and its whole path, so two folders of one name in two repos never share one", () => {
    expect(copyName("/a/.claude/worktrees/yard rooms")).toMatch(
      /^playground-vibe-yard-rooms-[0-9a-f]{8}-db$/,
    )
    expect(copyName("/a/.claude/worktrees/rooms")).not.toBe(copyName("/b/.claude/worktrees/rooms"))
    expect(copyName("/a/.claude/worktrees/a b")).not.toBe(copyName("/a/.claude/worktrees/a-b"))
    expect(copyName("/a/.claude/worktrees/rooms")).toBe(copyName("/a/.claude/worktrees/rooms"))
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

  test("a command keeps the same user's HOME and PATH and drops the live stack's settings, its data folder included", () => {
    expect(
      childEnv({
        HOME: "/h",
        PATH: "/bin",
        PLAYGROUND_DATA_DIR: "/live/data",
        POSTGRES_URL: "postgres://live",
        USER: "me",
      }),
    ).toEqual({ HOME: "/h", PATH: "/bin", USER: "me" })
  })

  test("Start refuses a running worktree, the live dashboard's, a checkout's own folder and a non-Playground one", () => {
    const path = worktree("refusals")
    const yes = () => true
    expect(startRefusal(undefined, LIVE, yes, yes)).toContain("no worktree")
    expect(startRefusal(stack(path, { url: "https://x" }), LIVE, yes, yes)).toContain("already")
    // started and still booting: no URL yet, its record there
    expect(startRefusal(stack(path, { vibe: true }), LIVE, yes, yes)).toContain("Stop it first")
    expect(startRefusal(stack(path, { branch: LIVE.branch }), LIVE, yes, yes)).toContain("live")
    expect(startRefusal(stack(path), LIVE, () => false, yes)).toContain("linked worktree")
    expect(startRefusal(stack(path), LIVE, yes, () => false)).toContain("not a Playground")
    expect(
      startRefusal(stack(path, { branch: "a/b/c-of-another-branch" }), LIVE, yes, yes),
    ).toBeNull()
  })
})

// the badge reads Vibeground with its branch, so a Vibeground's own tab never reads as the live dashboard
describe("ownVibe", () => {
  test("a checkout names its branch while the launcher's record is in its .turbo, else null", () => {
    const branch = () => "feat/rooms"
    expect(ownVibe("/w", (path) => path === "/w/.turbo/vibe.json", branch)).toBe("feat/rooms")
    expect(ownVibe("/w", () => false, branch)).toBeNull()
    expect(ownVibe(null, () => true, branch)).toBeNull()
  })
})

describe("Start", () => {
  test("runs an existing branch on a seeded copy, its own migrations, and its own .env", async () => {
    const path = worktree("start", "OLD=1\n")
    const migrated: string[] = []
    const urls: string[] = []
    const f = fake([stack(path)], {
      migrate: async (url, folder) => {
        urls.push(url)
        migrated.push(folder)
      },
    })
    const seeded = await startVibe(path, f.deps)
    expect(urls).toEqual([`postgresql://postgres:${PASSWORD}@127.0.0.1:41234/postgres`])
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
    // settings and store edits stay in the copy: the stack's data folder is its own clone in .turbo
    expect(f.copied).toEqual([join(path, ".turbo/vibe-data")])
    expect(f.launchData).toEqual([join(path, ".turbo/vibe-data")])
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
    // the migration and the .env name the copy, on the port docker gave it, never the live database
    expect(f.migrated).toEqual([`postgresql://postgres:${PASSWORD}@127.0.0.1:41234/postgres`])
    const env = readFileSync(join(path, ".env"), "utf8")
    expect(env.match(/^POSTGRES_URL=.*$/m)?.[0]).toBe(
      `POSTGRES_URL=postgresql://postgres:${PASSWORD}@127.0.0.1:41234/postgres`,
    )
    expect(env).not.toContain(LIVE.database)
  })

  // a re-pick while it boots offered Start again, whose docker rm -fv took the booting copy
  test("a second Start while the first still seeds is refused before it touches docker", async () => {
    const path = worktree("twice")
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = fake([stack(path)], {
      pipe: async () => {
        await held
        return { bytes: 1, error: null }
      },
    })
    const running = startVibe(path, first.deps)
    await Bun.sleep(5)
    const second = fake([stack(path)])
    expect(await startVibe(path, second.deps).catch((error: Error) => error.message)).toContain(
      "Stop it first",
    )
    expect(second.docker).toEqual([])
    release()
    await running
    expect(first.launched).toEqual([path])
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
    // a Vibeground still booting (no URL yet) holds the one-at-a-time line too
    const busy = fake([stack(path), stack("/x", { vibe: true })], {
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

  test("a second Stop from another tab is refused while the first holds the record, so the worktree's own .env stays", async () => {
    const path = worktree("two-stops", "OWN=1\n")
    await startVibe(path, fake([stack(path)]).deps)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = fake([stack(path, { vibe: true })], {
      stop: async () => {
        await held
        return { code: 0, stderr: "", stdout: "" }
      },
    })
    const stopping = stopVibe(path, first.deps)
    await Bun.sleep(5)
    const second = fake([stack(path, { vibe: true })])
    expect(await stopVibe(path, second.deps).catch((error: Error) => error.message)).toContain(
      "already stopping",
    )
    expect(second.docker).toEqual([])
    release()
    await stopping
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("OWN=1\n")
    expect(existsSync(join(path, ".env.vibe-saved"))).toBe(false)
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(false)
  })

  test("a Stop that fails lets the next Stop try", async () => {
    const path = worktree("stop-retry", "OWN=2\n")
    await startVibe(path, fake([stack(path)]).deps)
    const refused = fake([stack(path, { vibe: true })], {
      stop: async () => ({ code: 1, stderr: "dev:stop: something went wrong\n", stdout: "" }),
    })
    expect(await stopVibe(path, refused.deps).catch((error: Error) => error.message)).toContain(
      "dev:stop refused",
    )
    await stopVibe(path, fake([stack(path, { vibe: true })]).deps)
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("OWN=2\n")
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(false)
  })

  test("a stopping mark 10 minutes old, a Stop the API never finished, is taken over by the next Stop", async () => {
    const path = worktree("stop-stale", "OWN=3\n")
    await startVibe(path, fake([stack(path)]).deps)
    const record = JSON.parse(readFileSync(join(path, ".turbo/vibe.json"), "utf8"))
    const marked = (minutes: number) =>
      writeFileSync(
        join(path, ".turbo/vibe.json"),
        JSON.stringify({
          ...record,
          started: new Date(Date.now() - minutes * 60_000).toISOString(),
          stopping: true,
        }),
      )
    marked(9)
    expect(
      await stopVibe(path, fake([stack(path, { vibe: true })]).deps).catch(
        (error: Error) => error.message,
      ),
    ).toContain("already stopping")
    marked(11)
    await stopVibe(path, fake([stack(path, { vibe: true })]).deps)
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("OWN=3\n")
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(false)
  })

  test("Stop while the copy still seeds removes it and leaves the worktree's own .env alone", async () => {
    const path = worktree("stop-early", "MINE=1\n")
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = fake([stack(path)], {
      pipe: async () => {
        await held
        return { bytes: 1, error: "psql exited 2: the copy went away" }
      },
    })
    const running = startVibe(path, f.deps).catch((error: Error) => error.message)
    await Bun.sleep(5)
    await stopVibe(path, fake([stack(path, { vibe: true })]).deps)
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("MINE=1\n")
    release()
    expect(await running).toContain("the copy went away")
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("MINE=1\n")
    expect(f.launched).toEqual([])
  })

  test("a Stop whose dev:stop is still pending when Start's migrate ends wins: Start never launches, and the .env stays the worktree's own", async () => {
    const path = worktree("stop-race", "MINE=1\n")
    let migrated = () => {}
    const migrating = new Promise<void>((resolve) => {
      migrated = resolve
    })
    let stopped = () => {}
    const stopping = new Promise<void>((resolve) => {
      stopped = resolve
    })
    const f = fake([stack(path)], { migrate: () => migrating })
    const running = startVibe(path, f.deps).catch((error: Error) => error.message)
    await Bun.sleep(5)
    const stop = fake([stack(path, { vibe: true })], {
      stop: async () => {
        await stopping
        return { code: 0, stderr: "", stdout: "" }
      },
    })
    const stopping2 = stopVibe(path, stop.deps)
    await Bun.sleep(5)
    migrated()
    expect(await running).toContain("stopped while it started")
    stopped()
    await stopping2
    expect(f.launched).toEqual([])
    expect(readFileSync(join(path, ".env"), "utf8")).toBe("MINE=1\n")
    expect(existsSync(join(path, ".env.vibe-saved"))).toBe(false)
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(false)
  })

  test("the first Start's cleanup leaves the second Start's copy and record alone", async () => {
    const path = worktree("restart", "MINE=1\n")
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = fake([stack(path)], {
      pipe: async () => {
        await held
        return { bytes: 1, error: "psql exited 2: the copy went away" }
      },
    })
    const running = startVibe(path, first.deps).catch((error: Error) => error.message)
    await Bun.sleep(5)
    await stopVibe(path, fake([stack(path, { vibe: true })]).deps)
    const second = fake([stack(path)])
    await startVibe(path, second.deps)
    const before = first.docker.length
    release()
    expect(await running).toContain("the copy went away")
    expect(existsSync(join(path, ".turbo/vibe.json"))).toBe(true)
    expect(first.docker.slice(before).map((c) => c.args)).not.toContainEqual([
      "rm",
      "-fv",
      copyName(path),
    ])
  })

  test("a Start stopped while its copy boots ends at the next try, before it seeds", async () => {
    const path = worktree("stop-boot")
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = fake([stack(path)], {
      docker: async (args) => {
        if (args[0] === "ps")
          return { code: 0, stderr: "", stdout: `${LIVE.database}-sY08\trunning\n` }
        if (args.includes("pg_isready")) return { code: 1, stderr: "", stdout: "" }
        return { code: 0, stderr: "", stdout: "" }
      },
      wait: () => held,
    })
    const running = startVibe(path, f.deps).catch((error: Error) => error.message)
    await Bun.sleep(5)
    await stopVibe(path, fake([stack(path, { vibe: true })]).deps)
    release()
    expect(await running).toContain("stopped while it started")
    expect(f.pipes).toEqual([])
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

describe("the data folder's copy", () => {
  test("copies folders, files and symlinks, and leaves out sockets and the parts a Vibeground never reads", async () => {
    const from = join(dir, "data-live")
    const to = join(dir, "data-copy")
    mkdirSync(join(from, "herdr"), { recursive: true })
    mkdirSync(join(from, "archive"), { recursive: true })
    writeFileSync(join(from, "roster.json"), "{}\n")
    writeFileSync(join(from, "herdr", "config.toml"), "x = 1\n")
    writeFileSync(join(from, "archive", "old.jsonl"), "{}\n")
    symlinkSync("roster.json", join(from, "link.json"))
    const socket = Bun.listen({ socket: { data() {} }, unix: join(from, "herdr", "s.sock") })
    try {
      copyData(from, to)
    } finally {
      socket.stop(true)
    }
    expect(readFileSync(join(to, "roster.json"), "utf8")).toBe("{}\n")
    expect(readFileSync(join(to, "herdr", "config.toml"), "utf8")).toBe("x = 1\n")
    expect(lstatSync(join(to, "link.json")).isSymbolicLink()).toBe(true)
    expect(existsSync(join(to, "herdr", "s.sock"))).toBe(false)
    expect(existsSync(join(to, "archive"))).toBe(false)
  })
})
