// precommit:light: the checks that take seconds and bounce a commit or test:skills, run before a chain is queued through run-slot, so a bounce costs no place in the queue
import { join } from "node:path"

export const CHECKS = [
  {
    argv: ["bun", "--no-env-file", "packages/scripts/src/docs-wrap/cli.ts", "--check"],
    name: "docs-wrap",
  },
  { argv: ["bash", "scripts/check-em-dashes.sh"], name: "em-dashes" },
  {
    argv: [
      "bash",
      "-c",
      'TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/turbo/playground}" bunx turbo run build --filter=@packages/env --output-logs=errors-only && bun packages/scripts/src/env-keys.ts POSTGRES_URL',
    ],
    name: "env-keys",
  },
  {
    argv: ["bun", "run", "test:file", "tests/packages/scripts/src/trace-count/count.test.ts"],
    name: "trace-count",
  },
]

// A commit message file adds commitlint, as lefthook's commit-msg step runs it
export const checksFor = (msgFile?: string) =>
  msgFile
    ? [...CHECKS, { argv: ["bunx", "commitlint", "--edit", msgFile], name: "commitlint" }]
    : CHECKS

export type Run = (argv: string[]) => Promise<number>

// Runs every check, a failed one included, so one call names each one that would bounce the commit; the exit code is 1 when any failed
export const precommitLight = async (
  run: Run,
  log: (line: string) => void = console.error,
  msgFile?: string,
) => {
  const failed: string[] = []
  for (const check of checksFor(msgFile)) if ((await run(check.argv)) !== 0) failed.push(check.name)
  log(
    failed.length ? `precommit:light: failed: ${failed.join(", ")}` : "precommit:light: all passed",
  )
  return failed.length ? 1 : 0
}

if (import.meta.main) {
  const cwd = join(import.meta.dir, "..", "..", "..")
  const run: Run = (argv) =>
    Bun.spawn(argv, { cwd, stdio: ["ignore", "inherit", "inherit"] }).exited
  process.exit(await precommitLight(run, console.error, process.argv[2]))
}
