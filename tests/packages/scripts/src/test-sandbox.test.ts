import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/test-sandbox.ts")
const DIR = mkdtempSync(join(tmpdir(), "test-sandbox-test-"))

// removing DIR also ends the looping child's loop, even when bun drops a timed-out test's body before its finally
afterAll(() => rmSync(DIR, { force: true, recursive: true }))

test("a parallel pass past its deadline fails, naming the file still running", async () => {
  writeFileSync(
    join(DIR, "quick.test.ts"),
    'import { test } from "bun:test"\ntest("quick", () => {})\n',
  )
  writeFileSync(
    join(DIR, "stuck.test.ts"),
    'import { test } from "bun:test"\ntest("stuck", () => { Bun.sleepSync(20_000) }, 60_000)\n',
  )
  const started = Date.now()
  const run = Bun.spawn(["bun", SCRIPT, "./quick.test.ts", "./stuck.test.ts"], {
    cwd: DIR,
    env: { ...process.env, TEST_PARALLEL_DEADLINE_MS: "5000" },
    stderr: "pipe",
    stdout: "ignore",
    timeout: 10_000,
  })
  const [stderr, code] = await Promise.all([new Response(run.stderr).text(), run.exited])
  expect(run.signalCode).toBeNull()
  expect(code).not.toBe(0)
  expect(stderr).toContain("parallel pass passed its deadline")
  expect(stderr).toContain("stuck.test.ts")
  expect(stderr).not.toMatch(/still running:.*quick\.test\.ts/)
  expect(Date.now() - started).toBeLessThan(10_000)
}, 20_000)

// A stub's subshell that loops writing (a bare wait did so on GitHub's runner, 31 Oct) outlives bun's own kill of its test, so only the deadline's stop of the whole group ends it
test("the deadline also stops a child a stuck test leaves looping, so the run ends and the loop stops writing", async () => {
  const beat = join(DIR, "beat")
  const live = join(DIR, "live")
  writeFileSync(live, "")
  writeFileSync(
    join(DIR, "looping.test.ts"),
    `import { test } from "bun:test"\ntest("looping", async () => { Bun.spawn(["bash", "-c", "f() { while [ -e ${live} ]; do date +%s%N > ${beat}; echo loop >&2; sleep 0.05; done; }; x=$(f)"]); await Bun.sleep(60_000) }, 60_000)\n`,
  )
  const started = Date.now()
  try {
    const run = Bun.spawn(["bun", SCRIPT, "./looping.test.ts"], {
      cwd: DIR,
      env: { ...process.env, TEST_PARALLEL_DEADLINE_MS: "5000" },
      stderr: "pipe",
      stdout: "ignore",
      timeout: 12_000,
    })
    const [stderr] = await Promise.all([new Response(run.stderr).text(), run.exited])
    expect(run.signalCode).toBeNull()
    expect(stderr).toContain("still running: looping.test.ts")
    expect(Date.now() - started).toBeLessThan(12_000)
    const last = await Bun.file(beat).text()
    await Bun.sleep(500)
    expect(await Bun.file(beat).text()).toBe(last)
  } finally {
    rmSync(live, { force: true })
  }
}, 20_000)

test("a test in the parallel pass runs past bun's 5s default", async () => {
  writeFileSync(
    join(DIR, "busy.test.ts"),
    'import { test } from "bun:test"\ntest("busy", async () => { await Bun.sleep(6_000) })\n',
  )
  const run = Bun.spawn(["bun", SCRIPT, "./busy.test.ts"], {
    cwd: DIR,
    stderr: "ignore",
    stdout: "ignore",
    timeout: 15_000,
  })
  expect(await run.exited).toBe(0)
}, 20_000)

test("an interrupt during the parallel pass ends the run with 128 plus its number, and the serial pass never starts", async () => {
  const started = join(DIR, "slow-started")
  const serialRan = join(DIR, "serial-ran")
  writeFileSync(
    join(DIR, "slow.test.ts"),
    `import { test } from "bun:test"\nimport { writeFileSync } from "node:fs"\ntest("slow", async () => { writeFileSync(${JSON.stringify(started)}, ""); await Bun.sleep(8_000) }, 20_000)\n`,
  )
  const serial = join(DIR, "tests/api/hono/src/bin")
  mkdirSync(serial, { recursive: true })
  writeFileSync(
    join(serial, "dev.test.ts"),
    `import { test } from "bun:test"\nimport { writeFileSync } from "node:fs"\ntest("serial", () => writeFileSync(${JSON.stringify(serialRan)}, ""))\n`,
  )
  const run = Bun.spawn(["bun", SCRIPT, "./slow.test.ts", "./tests/api/hono/src/bin/dev.test.ts"], {
    cwd: DIR,
    stderr: "ignore",
    stdout: "ignore",
    timeout: 15_000,
  })
  while (!existsSync(started)) await Bun.sleep(50)
  run.kill("SIGINT")
  expect(await run.exited).toBe(130)
  expect(existsSync(serialRan)).toBe(false)
}, 20_000)

const ENV_MODULE = join(import.meta.dir, "../../../../packages/env/dist/api-hono.mjs")

// runs one test that imports an env schema in a fresh folder holding the given files, with the caller's env lacking the schema's keys
const validates = async (files: string[], extra: Record<string, string> = {}) => {
  const folder = mkdtempSync(join(tmpdir(), "test-sandbox-env-"))
  const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test", ...extra }
  for (const key of ["HONO_APP_URL", "HONO_TRUSTED_ORIGINS", "SKIP_ENV_VALIDATION"])
    if (!(key in extra)) delete env[key]
  writeFileSync(
    join(folder, "validates.test.ts"),
    `import { test } from "bun:test"\nimport ${JSON.stringify(ENV_MODULE)}\ntest("imports", () => {})\n`,
  )
  for (const file of files) writeFileSync(join(folder, file), "")
  try {
    const child = Bun.spawn(["bun", SCRIPT, "./validates.test.ts"], {
      cwd: folder,
      env,
      stderr: "pipe",
      stdout: "ignore",
      timeout: 15_000,
    })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    return { code, invalid: stderr.includes("Invalid environment variables") }
  } finally {
    rmSync(folder, { force: true, recursive: true })
  }
}

test("a folder with no .env runs a test whose import validates the environment, and one with a .env leaves it validated", async () => {
  expect(await validates([])).toEqual({ code: 0, invalid: false })
  const validated = await validates([".env"])
  expect(validated.invalid).toBe(true)
  expect(validated.code).not.toBe(0)
}, 40_000)

test("every env file bun test loads counts as one, and .env.local, which it skips, does not (#1859)", async () => {
  for (const file of [".env.test", ".env.test.local"])
    expect((await validates([file])).invalid).toBe(true)
  expect(await validates([".env.local"])).toEqual({ code: 0, invalid: false })
}, 40_000)

test("a SKIP_ENV_VALIDATION the caller set stays as set in a folder with no .env (#1859)", async () => {
  expect((await validates([], { SKIP_ENV_VALIDATION: "false" })).invalid).toBe(true)
}, 20_000)

test("a failed run in a folder with an unbuilt package ends naming it and the build command, and a passing run passes (#1859)", async () => {
  const folder = mkdtempSync(join(tmpdir(), "test-sandbox-dist-"))
  for (const name of ["built", "unbuilt"]) {
    mkdirSync(join(folder, "packages", name), { recursive: true })
    writeFileSync(join(folder, "packages", name, "tsdown.config.ts"), "")
  }
  mkdirSync(join(folder, "packages", "built", "dist"))
  writeFileSync(
    join(folder, "passes.test.ts"),
    'import { test } from "bun:test"\ntest("passes", () => {})\n',
  )
  writeFileSync(
    join(folder, "fails.test.ts"),
    'import { test } from "bun:test"\ntest("fails", () => { throw new Error("red") })\n',
  )
  const run = async (file: string) => {
    const child = Bun.spawn(["bun", SCRIPT, file], {
      cwd: folder,
      stderr: "pipe",
      stdout: "ignore",
      timeout: 15_000,
    })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    return { code, last: stderr.trim().split("\n").at(-1) }
  }
  const hint =
    "test-sandbox: packages/unbuilt lacks a dist: build the packages with env NODE_ENV=production SKIP_ENV_VALIDATION=true bunx turbo run build --filter='./packages/*' (the dev skill's Start) and run again"
  try {
    const passes = await run("./passes.test.ts")
    expect(passes.code).toBe(0)
    expect(passes.last).not.toBe(hint)
    const fails = await run("./fails.test.ts")
    expect(fails.code).not.toBe(0)
    expect(fails.last).toBe(hint)
  } finally {
    rmSync(folder, { force: true, recursive: true })
  }
}, 30_000)
