import { expect } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { livePair } from "../api/hono/src/lib/dev/live-dashboard"

const API = join(import.meta.dir, "../api/hono/src")

// The live dashboard's checkout reads the live machine whatever a test sets, so a test that needs a fixture stack skips there.
export const onLiveDashboard = (): boolean =>
  Bun.spawnSync(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: import.meta.dir,
    stderr: "ignore",
    stdin: "ignore",
    // bun collects skipIf at load, where no per-test timeout reaches, so a wedged git must be killed here
    timeout: 5_000,
  })
    .stdout.toString()
    .trim() === livePair().branch

// How long a child's pipes may drain after its exit, since a grandchild can hold one open long after
const READ_LIMIT = 10_000

// Runs a script as its own bun process with a fixture stack's settings: a test run's NODE_ENV, no PLAYGROUND_LIVE_READS or cmux capability, the fixture written into `<dir>/fixture`, and the API's settings unvalidated. The script reaches API modules through `API` (`await import(\`${API}/lib/dashboard/workers\`)`) and prints its result as JSON on its last line.
export async function inFixture(
  script: string,
  dir: string,
  env: Record<string, string> = {},
): Promise<{ code: number; result: unknown; stderr: string }> {
  const file = join(dir, "run.ts")
  writeFileSync(file, `const API = ${JSON.stringify(API)}\n${script}`)
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key !== "PLAYGROUND_LIVE_READS" && key !== "PLAYGROUND_FIXTURE" && !key.startsWith("CMUX_"),
    ),
  )
  const proc = Bun.spawn(["bun", "--no-env-file", file], {
    cwd: dir,
    env: {
      ...base,
      PLAYGROUND_FIXTURE_DIR: join(dir, "fixture"),
      NODE_ENV: "test",
      SKIP_ENV_VALIDATION: "true",
      ...env,
    },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: 60_000,
  })
  const code = await proc.exited
  // a grandchild that outlives the child holds a pipe open forever, so the drain gives up on its own a grace after the exit
  const bound = <T>(read: Promise<T>, what: string): Promise<T> =>
    Promise.race([
      read,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${what} still unread ${READ_LIMIT}ms after the child's exit`)),
          READ_LIMIT,
        )
        timer.unref?.()
      }),
    ])
  const [stdout, stderr] = await Promise.all([
    bound(new Response(proc.stdout).text(), "the child's stdout"),
    bound(new Response(proc.stderr).text(), "the child's stderr"),
  ])
  const last = stdout.trim().split("\n").at(-1) ?? ""
  let result: unknown = null
  try {
    result = JSON.parse(last)
  } catch {
    result = stdout
  }
  return { code, result, stderr }
}

// A `git` stand-in put first on the PATH a child bun starts with: Bun.spawnSync resolves git from the PATH its process starts with, never one a test mutates, so a bound on a git read is tested through a child. A test's own afterAll calls cleanGitShims, since this file also loads in the child bun, where no test runner runs.
const shimDirs: string[] = []

export const cleanGitShims = (): void => {
  for (const dir of shimDirs) rmSync(dir, { force: true, recursive: true })
}

export const gitShim = async (body: string): Promise<string> => {
  const bin = mkdtempSync(join(tmpdir(), "git-shim-"))
  shimDirs.push(bin)
  await Bun.write(join(bin, "git"), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, "git"), 0o755)
  return bin
}

// Runs one helper call in a bun whose startup PATH starts with the shim, and prints the result and its milliseconds as JSON
export const throughShim = async (
  bin: string,
  helperPath: string,
  expr: string,
  env: Record<string, string> = {},
): Promise<{ ms: number; r: unknown }> => {
  const child = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `const t = Date.now(); const m = await import(process.env.HELPER); const r = await (${expr}); console.log(JSON.stringify({ ms: Date.now() - t, r }))`,
    ],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
      HELPER: helperPath,
      PATH: `${bin}:${process.env.PATH}`,
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
    // a wedged child bun must not hold this sync spawn past its own bound, since bun's test timeout cannot break one
    timeout: 20_000,
  })
  expect(child.stderr.toString()).toBe("")
  return JSON.parse(child.stdout.toString().trim())
}
