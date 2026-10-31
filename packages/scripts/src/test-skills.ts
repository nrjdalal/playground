import { rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { sandbox } from "./sandbox"

const py = (file: string, ...withs: string[]) => [
  "uv",
  "run",
  "--quiet",
  "--python",
  "3.13",
  ...withs.flatMap((w) => ["--with", w]),
  "python",
  `tests/${file}`,
]

const steps: [string, string[]][] = [
  ["skill frontmatter", py("test_skill_frontmatter.py")],
  ["skills-ref validate", ["bun", "packages/scripts/src/skills-ref/cli.ts"]],
  ["links", py("test_links.py")],
  ["setup check", py("test_setup_check.py")],
  ["code-review-loop", py("test_code_review_loop.py")],
  ["loopback postgres and redis", py("test_loopback_postgres.py")],
  ["container volumes", py("test_docker_rm_volumes.py")],
  ["kill by name", py("test_kill_by_name.py")],
  ["ops cmux", py("test_ops_cmux.py")],
  ["ops merge train", py("test_ops_merge_train.py")],
  ["em-dash check", ["bash", "scripts/check-em-dashes.sh"]],
  ["one sentence per line", ["bun", "packages/scripts/src/docs-wrap/cli.ts", "--check"]],
]

type Result = [name: string, ok: boolean, fail?: string]

// Every step runs in sandbox.ts's sandbox, which keeps uv's Pythons and cache the real home's; Docker's config stays the real home's too, read before the swap, so a run downloads nothing twice
export const runSteps = async (list: [string, string[]][]) => {
  const { env: box, scratch } = sandbox()
  const env = { ...box, DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? join(homedir(), ".docker") }
  const results: Result[] = []
  try {
    for (const [name, cmd] of list) {
      console.log(`\n== ${name}`)
      // stdout is piped, so a Python step streams only unbuffered
      const step = Bun.spawn(cmd, {
        env: { ...env, PYTHONUNBUFFERED: "1" },
        stdout: "pipe",
        stderr: "inherit",
      })
      const out: Uint8Array[] = []
      for await (const chunk of step.stdout) {
        process.stdout.write(chunk)
        out.push(chunk)
      }
      const fail = Buffer.concat(out)
        .toString()
        .split("\n")
        .find((line) => /^FAIL\b/.test(line))
      results.push([name, (await step.exited) === 0, fail?.trim()])
    }
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
  return results
}

// checks.py keeps the last 200 characters of the Mac's tail, and bun's `error: script "test:skills" exited with code 1` takes 47 of them
const SUMMARY_MAX = 150

// The summary line, which Checks quotes as its tail, names each failed step and its first FAIL line, cut at its end so the count and the first failed step survive the Mac's cut
export const summary = (results: Result[]) => {
  const failed = results.filter(([, ok]) => !ok)
  if (!failed.length) return `all ${results.length} passed`
  const named = failed.map(([name, , fail]) => (fail ? `${name}: ${fail}` : name))
  const line = `${failed.length} of ${results.length} failed: ${named.join("; ")}`
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 3)}...` : line
}

// The summary ends stdout, so a run piped into tail names it, and a red one goes to stderr too, where it sits just above `bun run`'s own error line, the tail Checks reads on the Mac and on the runner host alike
export const report = (results: Result[]) => {
  console.log("\ntest:skills")
  for (const [name, ok] of results) console.log(`  ${ok ? "pass" : "FAIL"}  ${name}`)
  const ok = results.every(([, passed]) => passed)
  console.log(summary(results))
  if (!ok) console.error(summary(results))
  return ok ? 0 : 1
}

if (import.meta.main) process.exit(report(await runSteps(steps)))
