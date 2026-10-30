// The suite's runner: runs `bun test` in sandbox.ts's sandbox, so no test can start a real session or read the real config by accident (a self-removal test once started two). The env is set before bun starts, since os.homedir() and the spawn PATH lookup read the boot environment, not a later mutation. The folder goes when the run does.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism, constants } from "node:os"
import { join, relative } from "node:path"

import { sandbox } from "./sandbox"

const TIMINGS = "tests/timings.json"

// Files that run one at a time after the parallel pass: dev.test.ts and launch.test.ts move packages/env/dist/gaps.mjs aside, and dev.test.ts's launcher rebuilds @packages/env, whose dist the other workers import; workers.test.ts's cmux reads pace a real 4s read against its own time and start a fake cmux process for each read, and beside other workers on a loaded runner one ran past its 20s (27 Oct, five Actions runs); this pass runs its files in one process, which loads a shared helper once, so no spawn*.test.ts file joins it, since each needs spawn-fake.ts afresh
const SERIAL = [
  "tests/api/hono/src/bin/dev.test.ts",
  "tests/api/hono/src/lib/dashboard/workers.test.ts",
  "tests/api/hono/src/lib/dev/launch.test.ts",
]

// test:file skips the build, and a test importing an unbuilt package fails on a missing module, which hides the failure it reproduces; named only after a failed run, since lefthook's agents-rules runs test:file on a commit that builds nothing
const unbuilt = existsSync("packages")
  ? readdirSync("packages")
      .map((name) => join("packages", name))
      .filter((dir) => existsSync(join(dir, "tsdown.config.ts")) && !existsSync(join(dir, "dist")))
  : []

const { env, scratch } = sandbox()
// a worktree with none of the env files bun test loads (a skill-only chore; it skips .env.local) has no values for the apps' env schemas, so a test that imports one would fail its validation, unless the caller set the flag
if (![".env", ".env.test", ".env.test.local"].some((file) => existsSync(file)))
  Object.assign(env, { SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION ?? "true" })
const run = (argv: string[]) =>
  Bun.spawnSync(["bun", "test", ...argv], { env, stdio: ["inherit", "inherit", "inherit"] })
    .exitCode ?? 1

// bun's own test timeout cannot stop a test blocked in sync code (a spawnSync that never returns held a worker 29 minutes once), so the parallel pass has a deadline: each worker marks the file it holds through a preload that runs once per test file, and a pass past the deadline is killed as a group and fails naming the files still marked
const DEADLINE_MS = Number(process.env.TEST_PARALLEL_DEADLINE_MS) || 20 * 60_000
const running = join(scratch, "running")
mkdirSync(running)
const preload = join(scratch, "running.ts")
writeFileSync(
  preload,
  `import { afterAll } from "bun:test"\nimport { rmSync, writeFileSync } from "node:fs"\nconst mark = ${JSON.stringify(running)} + "/" + process.pid\nwriteFileSync(mark, Bun.main)\nafterAll(() => rmSync(mark, { force: true }))\n`,
)
const held = () =>
  readdirSync(running).flatMap((pid) => {
    try {
      return [relative(process.cwd(), readFileSync(join(running, pid), "utf8"))]
    } catch {
      return []
    }
  })
let interrupted: NodeJS.Signals | undefined
const runParallel = async (argv: string[]) => {
  const child = Bun.spawn(["bun", "test", `--preload=${preload}`, ...argv], {
    detached: true,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
  const stop = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid, signal)
    } catch {}
  }
  // a detached group misses the terminal's Ctrl-C, so pass it on
  const forward = (signal: NodeJS.Signals) => {
    interrupted = signal
    stop(signal)
  }
  process.on("SIGINT", forward)
  process.on("SIGTERM", forward)
  let timer: Timer | undefined
  const late = new Promise<"late">((done) => (timer = setTimeout(() => done("late"), DEADLINE_MS)))
  const code = await Promise.race([child.exited, late])
  clearTimeout(timer)
  process.off("SIGINT", forward)
  process.off("SIGTERM", forward)
  if (code !== "late") return code
  const files = held()
  stop("SIGKILL")
  await child.exited
  console.error(
    `test-sandbox: parallel pass passed its deadline (${Math.round(DEADLINE_MS / 1000)}s), still running: ${files.join(", ") || "no file named"}`,
  )
  return 124
}

// cores - 1 workers, at most 4; tests/timings.json starts the slowest files first, and a missing one only loses that order
const workers = Math.min(4, Math.max(1, availableParallelism() - 1))
// a test beside other workers runs slower than alone, so the parallel pass gives each test 30s where bun gives 5s: four tests that spawn a process or read every test file passed their 5s on GitHub's 4-core runner, and on the loaded runner box two failed at 15s, so 30s is twice that
const TIMEOUT_MS = 30_000
const update = process.env.TEST_TIMINGS_UPDATE === "1"
const readable = () => {
  try {
    JSON.parse(readFileSync(TIMINGS, "utf8"))
    return true
  } catch {
    return false
  }
}
const timings = update || readable() ? [`--timings=${TIMINGS}`] : []
const args = process.argv.slice(2)
const paths = args.length > 0 ? args : ["tests"]
// compared without a leading ./ or a trailing /, and passed to bun as given, since bun reads ./name as a path and name as a filter
const bare = (path: string) => path.replace(/^(\.\/)+/, "").replace(/\/+$/, "") || "."
const serial = SERIAL.filter((file) =>
  paths.map(bare).some((path) => path === "." || file === path || file.startsWith(`${path}/`)),
)
const rest = paths.filter((path) => !SERIAL.includes(bare(path)))

console.error(
  `test-sandbox: ${workers} workers with a ${Math.round(DEADLINE_MS / 1000)}s deadline, then ${serial.length} serial files`,
)
const parallel =
  rest.length > 0
    ? await runParallel([
        `--parallel=${workers}`,
        `--timeout=${TIMEOUT_MS}`,
        ...timings,
        ...(update ? ["--update-timings"] : []),
        ...SERIAL.map((file) => `--path-ignore-patterns=${file}`),
        ...rest,
      ])
    : 0
if (interrupted) {
  console.error(`test-sandbox: parallel pass interrupted by ${interrupted}, serial pass skipped`)
  rmSync(scratch, { force: true, recursive: true })
  process.exit(128 + constants.signals[interrupted])
}
const alone = serial.length > 0 ? run(serial) : 0
console.error(
  `test-sandbox: parallel pass ${parallel === 0 ? "passed" : `failed (exit ${parallel})`}, serial pass ${alone === 0 ? "passed" : `failed (exit ${alone})`}`,
)
if ((parallel || alone) && unbuilt.length > 0)
  console.error(
    `test-sandbox: ${unbuilt.join(", ")} lacks a dist: build the packages with env NODE_ENV=production SKIP_ENV_VALIDATION=true bunx turbo run build --filter='./packages/*' (the dev skill's Start) and run again`,
  )
rmSync(scratch, { force: true, recursive: true })
process.exit(parallel || alone)
