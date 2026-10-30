import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  apiSettings,
  checkoutOf,
  devEnv,
  preflight,
} from "../../../../../api/hono/src/lib/dev/launch"
import { pgidOf, readRecord, startOf, writeRecord } from "../../../../../api/hono/src/lib/dev/stop"
import { envLines, REQUIRED } from "../lib/dev/env-fixtures"

const ROOT = join(import.meta.dir, "../../../../..")
const LAUNCHER = "api/hono/src/bin/dev.ts"

type DryTask = {
  environmentVariables: { passthrough: string[] | null }
  taskId: string
}
type DryRun = {
  globalCacheInputs: { environmentVariables: { configured: string[] } }
  tasks: DryTask[]
}

// turbo prints each variable it hands a task as NAME=<sha256 of the value>.
const hashed = (name: string, value: string): string =>
  `${name}=${new Bun.CryptoHasher("sha256").update(value).digest("hex")}`

// The launcher as `bun run dev` runs it, asked for turbo's plan rather than a stack.
const dryRun = async (args: string[], env: Record<string, string | undefined> = process.env) => {
  // the timeout ends this test's own launcher (which passes SIGTERM to turbo) should a broken pass-through start a real stack
  const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER, "--dry=json", ...args], {
    cwd: ROOT,
    env,
    killSignal: "SIGTERM",
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: 20_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(code).toBe(0)
  return { dry: JSON.parse(stdout) as DryRun, stderr }
}

describe("bun run dev", () => {
  test("runs the launcher, with Bun's own .env loading off so turbo sees the shell's environment", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json()
    expect(pkg.scripts.dev).toEndWith(` && bun --no-env-file ${LAUNCHER}`)
  })

  test("dev:stop runs the stop script, which ends the stack the launcher recorded", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json()
    expect(pkg.scripts["dev:stop"]).toBe("bun --no-env-file api/hono/src/bin/dev-stop.ts")
  })

  // A launcher that recorded a dry run would overwrite the seed, then clear it as it exits.
  test("a dry run starts no stack, so it leaves the stack's record alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-record-"))
    const record = join(dir, "dev.pgid")
    try {
      writeFileSync(record, "seed\n")
      await dryRun([], { ...process.env, DEV_RECORD: record })
      expect(await Bun.file(record).text()).toBe("seed\n")
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, 30_000)

  test("passes GIT_SHA through to the dev tasks without hashing it, so a commit costs no cache", async () => {
    const turbo = Bun.JSONC.parse(await Bun.file(join(ROOT, "turbo.json")).text()) as {
      globalEnv: string[]
      tasks: Record<string, { env?: string[]; passThroughEnv?: string[] }>
    }
    expect(turbo.tasks.dev?.passThroughEnv).toContain("GIT_SHA")
    expect(turbo.tasks["@web/next#dev"]?.passThroughEnv).toContain("GIT_SHA")
    expect(turbo.globalEnv).not.toContain("GIT_SHA")
    expect(Object.values(turbo.tasks).flatMap((task) => task.env ?? [])).not.toContain("GIT_SHA")
  })

  test("hands turbo its arguments and the shell's environment, less NODE_ENV and plus HEAD's sha", async () => {
    const head = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT })
    const { dry, stderr } = await dryRun(["--filter=@api/hono"], {
      ...process.env,
      NODE_ENV: "production",
      SKIP_ENV_VALIDATION: "true",
    })
    expect(stderr).toContain("dev: ignoring NODE_ENV=production from the shell")
    const configured = dry.globalCacheInputs.environmentVariables.configured
    expect(configured.filter((entry) => /^(NODE_ENV|SKIP_ENV_VALIDATION)=/.test(entry))).toEqual([])
    const api = dry.tasks.find((task) => task.taskId === "@api/hono#dev")
    expect(api?.environmentVariables.passthrough).toContain(
      hashed("GIT_SHA", head.stdout.toString().trim()),
    )
  }, 30_000)

  // The launcher runs with --no-env-file, and its checks import API modules (cmux.ts and its ApiError): none of them may validate the API's settings as it loads, or the launcher dies before it reads .env at all.
  test("starts with none of the API's settings in its environment", async () => {
    const { dry } = await dryRun(["--filter=@api/hono"], {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
    })
    expect(dry.tasks.map((task) => task.taskId)).toContain("@api/hono#dev")
  }, 30_000)

  // A build of @api/hono cleans the dist its own dev task's tsdown --watch writes, and the API dies resolving dist/index.mjs mid-start.
  test("never builds @api/hono, and still builds every workspace package web uses", async () => {
    const { dry } = await dryRun([])
    expect(dry.tasks.map((task) => task.taskId)).not.toContain("@api/hono#build")
    // web's own graph alone, since the API's dev pulls in every package through its ^build
    const tasks = (await dryRun(["--filter=@web/next"])).dry.tasks.map((task) => task.taskId)
    const web = await Bun.file(join(ROOT, "web/next/package.json")).json()
    // a package with no build script has nothing for web's dev to wait on
    const builds = async (name: string) =>
      Boolean(
        (await Bun.file(join(ROOT, "packages", name.split("/")[1]!, "package.json")).json()).scripts
          ?.build,
      )
    const packages: string[] = []
    for (const name of Object.keys({ ...web.dependencies, ...web.devDependencies })) {
      if (name.startsWith("@packages/") && (await builds(name))) packages.push(name)
    }
    expect(packages.length).toBeGreaterThan(0)
    expect(packages.filter((name) => !tasks.includes(`${name}#build`))).toEqual([])
  }, 30_000)
})

// A stand-in for turbo that logs the signals it receives, and leaves when its launcher has gone.
const STAND_IN = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs"
const log = (line) => appendFileSync(process.env.STAND_IN_LOG, line + "\\n")
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => { log(signal); process.exit(0) })
const parent = process.ppid
setInterval(() => { if (process.ppid !== parent) process.exit(0) }, 200)
log("started")
`

describe("the launcher's signals", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-launcher-"))
  const standIn = join(dir, "turbo")
  writeFileSync(standIn, STAND_IN)
  chmodSync(standIn, 0o755)
  // A stand-in for cmux, first on the launcher's PATH, that records any call, so a test run's launcher is seen never to reach the live one
  const bin = join(dir, "bin")
  const asked = join(dir, "asked.log")
  mkdirSync(bin)
  writeFileSync(join(bin, "cmux"), `#!/bin/sh\necho "$@" >> "${asked}"\nexit 1\n`)
  chmodSync(join(bin, "cmux"), 0o755)
  // A checkout of its own whose .env the launcher's checks read (DEV_ENV_ROOT), holding every key the apps require, so a case reads its required keys alike in a worktree with no .env and one with its own; bun test loads that worktree's .env into this process, so its keys leave the shell the cases hand the launcher, where they would win over this file
  const envRoot = join(dir, "checkout")
  mkdirSync(join(envRoot, "api/hono"), { recursive: true })
  copyFileSync(join(ROOT, ".env.example"), join(envRoot, ".env.example"))
  writeFileSync(join(envRoot, ".env"), envLines(REQUIRED).join("\n"))
  const shell = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !(key in REQUIRED)),
  )
  // a fixture of its own, so a start never rewrites the one a stack in this checkout reads; PLAYGROUND_FIXTURE holds it to rule 4, since the launcher drops the test run's NODE_ENV and a person's own clone would read their machine
  const launcherEnv = <T extends Record<string, string>>(more: T) => ({
    ...shell,
    PLAYGROUND_FIXTURE: "shipped",
    PLAYGROUND_FIXTURE_DIR: join(dir, "fixture"),
    DEV_ENV_ROOT: envRoot,
    ...more,
  })
  const settingsOf = (env: Record<string, string | undefined>) =>
    apiSettings(envRoot, devEnv(env, "").env, join(ROOT, "packages/env/dist/load-dotenv.mjs"))
  // The checks' verdict on this checkout for a launcher given env, computed as the launcher computes it, with cmux refused
  const expectedPreflight = (env: Record<string, string | undefined>) =>
    preflight(checkoutOf(ROOT), () => settingsOf(env), {
      attach: async () => {
        throw new Error("a test run's launcher asked cmux")
      },
      root: ROOT,
    })
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  // Signals go only to the launcher this test spawned, by the pid its own spawn returned.
  const launch = async (name: string) => {
    const logFile = join(dir, `${name}.log`)
    const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER, "--dry=json"], {
      cwd: ROOT,
      env: { ...process.env, DEV_TURBO_BIN: standIn, STAND_IN_LOG: logFile },
      killSignal: "SIGTERM",
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
      timeout: 20_000,
    })
    // Wait for the stand-in to have logged "started", the state the signal tests need (its handlers installed), however long its start takes under load; a fixed 5s file check killed it mid-boot and turned the tests red.
    const started = async () =>
      (await Bun.file(logFile).exists()) && (await Bun.file(logFile).text()).includes("started")
    for (let i = 0; i < 300 && !(await started()); i++) await Bun.sleep(50)
    const lines = async () =>
      (await Bun.file(logFile).exists()) ? (await Bun.file(logFile).text()).trim().split("\n") : []
    return { lines, proc }
  }

  for (const signal of ["SIGHUP", "SIGTERM"] as const) {
    test(`${signal} ends the stack, passed on to turbo as SIGTERM`, async () => {
      const { lines, proc } = await launch(signal)
      proc.kill(signal)
      expect(await proc.exited).toBe(0)
      expect(await lines()).toEqual(["started", "SIGTERM"])
    }, 30_000)
  }

  // The checks' verdict on this checkout, computed here as the launcher computes it: on a CI runner's detached HEAD it refuses the HEAD; on a branch, a fixture stack never asks cmux (a PLAYGROUND_LIVE_READS one outside cmux refuses there), and the exported remote URL refuses, unless a .env.<stage> names its own container, which passes (the scratch checkout holds none). Either way the launcher must do just what the checks say, with the stand-in in turbo's place.
  test("refuses to start before turbo runs when the checks refuse, and starts it when they pass", async () => {
    const logFile = join(dir, "preflight.log")
    const record = join(dir, "preflight.pgid")
    const env = launcherEnv({
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      POSTGRES_URL: "postgres://u:p@db.example.com:5432/postgres",
    })
    const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER], {
      cwd: ROOT,
      env: { ...env, DEV_RECORD: record, DEV_TURBO_BIN: standIn, STAND_IN_LOG: logFile },
      killSignal: "SIGTERM",
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
      timeout: 60_000,
    })
    const stderr = new Response(proc.stderr).text()
    // once the launcher has refused or started turbo, so its build of @packages/env is not cleaning the loader this reads
    for (
      let i = 0;
      i < 1000 && proc.exitCode === null && !(await Bun.file(logFile).exists());
      i++
    ) {
      await Bun.sleep(50)
    }
    const expected = await expectedPreflight(env)
    expect(existsSync(asked)).toBe(false)
    if (expected.ok) {
      // the fixture rule comes before the worktree and the clone, so the launcher reads the fixture wherever the suite runs
      expect(expected.dashboard).toMatchObject({ kind: "fixture", rule: "fixture" })
      // the launcher records itself once turbo runs, and clears the record as it exits
      for (let i = 0; i < 100 && readRecord(record) === null; i++) await Bun.sleep(25)
      expect(readRecord(record)?.pid).toBe(proc.pid)
      proc.kill("SIGTERM")
      expect(await proc.exited).toBe(0)
      expect(await stderr).toContain(`dev: database ${expected.proof}`)
      expect(await Bun.file(logFile).text()).toStartWith("started")
      expect(readRecord(record)).toBeNull()
      // a fixture stack's scratch copy is written for it and goes with it
      if (expected.dashboard.kind === "fixture") {
        expect(await stderr).toContain(
          `dev: dashboard reads the fixture written to ${env.PLAYGROUND_FIXTURE_DIR}`,
        )
        expect(existsSync(join(env.PLAYGROUND_FIXTURE_DIR, "stamp.json"))).toBe(false)
      }
    } else {
      // a launcher that started turbo despite a refusal is stopped here, so the test fails at once rather than at its timeout
      const started = await Bun.file(logFile).exists()
      if (started) proc.kill("SIGTERM")
      expect(started).toBe(false)
      expect(await proc.exited).toBe(1)
      expect(await stderr).toContain(`dev: refusing to start: ${expected.refusal}\n`)
      // claimed before the checks, cleared as the launcher leaves
      expect(readRecord(record)).toBeNull()
    }
  }, 60_000)

  // The claim comes before every check, so even a CI runner, whose checks refuse, sees it: a record path that is a folder cannot be written, which the launcher says before it goes on.
  test("claims the stack's record before its checks, and runs on without one it cannot write", async () => {
    const logFile = join(dir, "blocked.log")
    const record = join(dir, "blocked.pgid")
    mkdirSync(record, { recursive: true })
    const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER], {
      cwd: ROOT,
      env: launcherEnv({ DEV_RECORD: record, DEV_TURBO_BIN: standIn, STAND_IN_LOG: logFile }),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
      timeout: 60_000,
    })
    const stderr = new Response(proc.stderr).text()
    for (let i = 0; i < 1000 && proc.exitCode === null; i++) {
      if (await Bun.file(logFile).exists()) proc.kill("SIGTERM")
      await Bun.sleep(50)
    }
    await proc.exited
    const said = await stderr
    expect(said).toContain(`dev: could not record the stack in ${record}`)
    expect(said).toMatch(/^dev: (?:refusing to start:|database) /m)
  }, 60_000)

  // A second start would overwrite the record of a stack it cannot replace, so it refuses before any check, the branch's included. The recorded launcher is a holder this test starts from the checkout, in a group of its own, and ends.
  test("refuses a second start while the recorded launcher still runs in this checkout", async () => {
    const logFile = join(dir, "second.log")
    const record = join(dir, "second.pgid")
    const holder = Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000)"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    })
    try {
      for (let i = 0; i < 100 && startOf(holder.pid) === null; i++) await Bun.sleep(25)
      writeRecord(record, {
        pgid: pgidOf(holder.pid) ?? 0,
        pid: holder.pid,
        started: startOf(holder.pid) ?? "",
      })
      const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER], {
        cwd: ROOT,
        env: {
          ...process.env,
          PLAYGROUND_FIXTURE_DIR: join(dir, "fixture"),
          DEV_RECORD: record,
          DEV_TURBO_BIN: standIn,
          STAND_IN_LOG: logFile,
        },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "ignore",
        timeout: 30_000,
      })
      const stderr = new Response(proc.stderr).text()
      // a launcher that went on to start turbo is stopped here, so the test fails at once rather than at its timeout
      for (let i = 0; i < 400 && proc.exitCode === null; i++) {
        if (await Bun.file(logFile).exists()) proc.kill("SIGTERM")
        await Bun.sleep(25)
      }
      const code = await proc.exited
      expect(await Bun.file(logFile).exists()).toBe(false)
      expect(code).toBe(1)
      expect(await stderr).toContain(
        `dev: refusing to start: a stack already runs in this checkout (launcher pid ${holder.pid}, process group ${holder.pid})`,
      )
      expect(readRecord(record)?.pid).toBe(holder.pid)
    } finally {
      process.kill(-holder.pid, "SIGKILL")
    }
  }, 30_000)

  // The keys the schemas require are named before anything starts: a shell value forced empty stays empty (the base .env does not override it), so the launcher refuses, naming each key, and turbo's stand-in never runs. The branch refusal comes first, so on a detached HEAD, read as the preflight case above reads the checkout, the case expects that refusal instead and touches no git state.
  test("refuses to start when a required key is left empty, and names it", async () => {
    const detached = checkoutOf(ROOT).branch === null
    const logFile = join(dir, "gaps.log")
    const record = join(dir, "gaps.pgid")
    const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER], {
      cwd: ROOT,
      env: launcherEnv({
        BETTER_AUTH_SECRET: "",
        DEV_RECORD: record,
        DEV_TURBO_BIN: standIn,
        NEXT_PUBLIC_APP_URL: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        POSTGRES_URL: "postgres://u:p@db.example.com:5432/postgres",
        STAND_IN_LOG: logFile,
      }),
      killSignal: "SIGTERM",
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
      timeout: 60_000,
    })
    const stderr = await new Response(proc.stderr).text()
    expect(await proc.exited).toBe(1)
    expect(stderr).toContain("dev: refusing to start:")
    if (detached) {
      expect(stderr).toContain("this checkout is on a detached HEAD")
    } else {
      expect(stderr).toContain("BETTER_AUTH_SECRET (auth)")
      expect(stderr).toContain("NEXT_PUBLIC_APP_URL (web-next)")
      expect(stderr).toContain("fill each from .env.example")
    }
    expect(await Bun.file(logFile).exists()).toBe(false)
    expect(readRecord(record)).toBeNull()
  }, 60_000)

  // A checkout whose packages/env dist predates the gaps module, as every worktree that merges canary holds until its first build: the launcher's own build writes the module, and the keys check must read it after, not die on a resolution cached while the file loaded. The refusal is the checks' own, read here as the launcher reads it, so the case holds the arm that applies: a detached HEAD's, else the remote database's.
  test("refuses on its checks, not on the gaps module a checkout's own build makes", async () => {
    const built = join(ROOT, "packages/env/dist/gaps.mjs")
    const aside = join(dir, "gaps.mjs.dev-test")
    renameSync(built, aside)
    try {
      const record = join(dir, "prebuilt.pgid")
      const env = launcherEnv({ POSTGRES_URL: "postgres://u:p@db.example.com:5432/postgres" })
      const expected = await expectedPreflight(env)
      const proc = Bun.spawn(["bun", "--no-env-file", LAUNCHER], {
        cwd: ROOT,
        env: { ...env, DEV_RECORD: record },
        killSignal: "SIGTERM",
        stderr: "pipe",
        stdin: "ignore",
        stdout: "ignore",
        timeout: 60_000,
      })
      const stderr = await new Response(proc.stderr).text()
      expect(stderr).not.toContain("Cannot find module")
      // a POSTGRES_URL off this machine is always refused, so the launcher never starts a stack here
      expect(expected.ok).toBe(false)
      if (proc.exitCode === null) proc.kill("SIGTERM")
      expect(await proc.exited).toBe(1)
      if (!expected.ok) expect(stderr).toContain(`dev: refusing to start: ${expected.refusal}\n`)
      expect(readRecord(record)).toBeNull()
    } finally {
      if (existsSync(aside)) {
        if (existsSync(built)) rmSync(aside)
        else renameSync(aside, built)
      }
    }
  }, 60_000)

  test("a SIGINT sent to the launcher alone is ignored, as turbo's own wrapper ignores one", async () => {
    const { lines, proc } = await launch("SIGINT")
    try {
      proc.kill("SIGINT")
      await Bun.sleep(500)
      expect(proc.exitCode).toBeNull()
      expect(proc.signalCode).toBeNull()
      expect(await lines()).toEqual(["started"])
    } finally {
      proc.kill("SIGTERM")
    }
    expect(await proc.exited).toBe(0)
  }, 30_000)
})
