// The types gate: a head behind canary that merges with it clean merges on its own checks, which typed the head alone, so pr:merge type-checks the tree the squash makes before it squashes, since two PRs green alone once broke canary together on a changed signature.
import { accessSync, constants } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { BASE, type Gate } from "./gates"
import type { Run } from "./merge"

// One step of the check, run in the scratch worktree: its name for the timing line, its argv, and whether a failure is the tree's own type error rather than the run's.
export type TypeStep = { argv: string[]; name: string; types?: boolean }

// The steps for one merged tree: the worktree it is checked out in, the checkout pr:merge runs from (whose node_modules it clones), and canary's sha, which the turbo filter diffs against.
export type TypeSteps = (at: { canary: string; checkout: string; worktree: string }) => TypeStep[]

// How long the whole check may take, slot waits included, so a run that cannot finish refuses inside the merge train's 900s call of pr:train ready, whose gates share it (ready.ts).
export const TYPES_BUDGET_MS = 10 * 60_000

const NAME = "types"

const runSlot = (): string =>
  join(process.env.PLAYGROUND_DATA_DIR || join(homedir(), ".playground"), "ops", "run-slot.sh")

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Pure: argv through the machine's run slot (**slots**) as the merge train's own runs take it, since the gate holds the merge lock as theirs do (run-slot.sh puts ops-merge-train in class 0, outside the queue); bare under a run that already holds a slot (run-slot exports RUN_SLOT_NICE to its child) or on a machine with no run-slot, as commit-slot.ts does.
export const slotted = (
  argv: string[],
  env: Record<string, string | undefined>,
  script: string | null,
): string[] =>
  env.RUN_SLOT_NICE === undefined && script ? [script, "ops-merge-train", "--", ...argv] : argv

// CI's own type steps (.github/workflows/auto-check-build.yml), after a node_modules clone by scripts/README.md's "A worktree's node_modules", each through the run slot.
export const ciSteps: TypeSteps = ({ canary, checkout, worktree }) => {
  const steps: TypeStep[] = [
    { argv: ["cp", "-cR", join(checkout, "node_modules"), `${worktree}/`], name: "clone" },
    { argv: ["bun", "install", "--force", "--ignore-scripts", "--cwd", worktree], name: "install" },
    {
      argv: ["bunx", "turbo", "run", "check-types", `--filter=...[${canary}]`],
      name: "check-types",
      types: true,
    },
    {
      argv: ["bunx", "turbo", "run", "build", "--filter=./packages/*", "--filter=@api/hono"],
      name: "build",
      types: true,
    },
    { argv: ["bun", "packages/scripts/src/data-table-metrics.ts"], name: "metrics" },
    { argv: ["bun", "run", "check-types:tests"], name: "check-types:tests", types: true },
  ]
  const script = runSlot()
  const slot = executable(script) ? script : null
  return steps.map((step) => ({ ...step, argv: slotted(step.argv, process.env, slot) }))
}

// Pure: what a failed step printed, as a refusal shows it: its first TypeScript errors, else its last lines.
export function firstErrors(output: string, count = 5): string[] {
  const lines = output.split("\n").map((line) => line.trim())
  const errors = lines.filter((line) => /\berror TS\d+:/.test(line))
  return (errors.length > 0 ? errors : lines.filter(Boolean).slice(-count)).slice(0, count)
}

const gitOk = async (git: Run, args: string[]): Promise<string> => {
  const result = await git(args)
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

// Whether the head already holds canary's tip, so its own checks typed this very tree: true, false, or why it could not be read.
export async function holdsCanary(
  git: Run,
  canary: string,
  head: string,
): Promise<boolean | string> {
  const result = await git(["merge-base", "--is-ancestor", canary, head])
  if (result.code === 0 || result.code === 1) return result.code === 0
  return `git merge-base --is-ancestor exited ${result.code}: ${result.stderr.trim()}`
}

// The gate as --explain prints it: whether it would run at the merge, and why; it runs no type check.
export async function typesExplained(
  git: Run,
  facts: { canary: string; head: string; mergeTree: string | null },
): Promise<Gate> {
  const held = await holdsCanary(git, facts.canary, facts.head)
  if (typeof held === "string") return { detail: `could not read: ${held}`, name: NAME, ok: false }
  return {
    detail: held
      ? skipped(facts)
      : facts.mergeTree
        ? `runs at the merge: ${BASE} has commits ${facts.head.slice(0, 7)} lacks, so pr:merge type-checks the merged tree ${facts.mergeTree.slice(0, 7)} (--explain runs none)`
        : `runs at the merge once ${facts.head.slice(0, 7)} merges clean with ${BASE}`,
    name: NAME,
    ok: true,
  }
}

const skipped = (facts: { canary: string; head: string }) =>
  `skipped: ${facts.head.slice(0, 7)} holds ${BASE} ${facts.canary.slice(0, 7)}, so its own checks typed this tree`

const FIX = `Merge ${BASE} into the PR and fix the error; the new head then needs its checks and a 5/5`

// Removes the scratch worktree and its folder, whatever state a run left them in.
async function clear(git: Run, worktree: string): Promise<void> {
  await git(["worktree", "remove", "--force", "--force", worktree])
  await rm(worktree, { force: true, recursive: true })
  await git(["worktree", "prune"])
}

// The types gate at the merge, inside the merge lock: skipped when the head holds canary's tip; else the merged tree, checked out detached in a scratch worktree under the repo's .claude/worktrees/ that it removes however it ends, through steps. A type error refuses and is kept beside the lock (by head and canary), so the merge train's next cycle refuses the same pair without a second run; a run it cannot finish refuses, naming the fix.
export async function typesGate({
  budgetMs = TYPES_BUDGET_MS,
  facts,
  git,
  lockRoot,
  steps,
}: {
  budgetMs?: number
  facts: { canary: string; head: string; mergeTree: string | null; n: number }
  git: Run
  lockRoot: string
  steps: TypeSteps
}): Promise<Gate> {
  const { canary, head, mergeTree, n } = facts
  const held = await holdsCanary(git, canary, head)
  if (held === true) return { detail: skipped(facts), name: NAME, ok: true }
  const unfinished = (why: string): Gate => ({
    detail: `could not finish the merged-tree type check: ${why}. Run pr:merge again, and take a second failure to the Builder`,
    name: NAME,
    ok: false,
  })
  if (typeof held === "string") return unfinished(held)
  if (!mergeTree) return unfinished(`#${n} has no clean merged tree with ${BASE}`)
  const memo = join(lockRoot, "merge-types", `${head}-${canary}`)
  const kept = Bun.file(memo)
  if (await kept.exists()) return { detail: await kept.text(), name: NAME, ok: false }
  if (budgetMs <= 0)
    return unfinished("this call's shared budget ran out on the gates before it, so no check ran")
  const deadline = Date.now() + budgetMs
  const at = `the merged tree ${mergeTree.slice(0, 7)} (#${n} at ${head.slice(0, 7)} onto ${BASE} ${canary.slice(0, 7)})`
  let worktree = ""
  try {
    const common = await gitOk(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    const checkout = await gitOk(git, ["rev-parse", "--show-toplevel"])
    worktree = join(dirname(common), ".claude", "worktrees", `merge-types-${n}`)
    await clear(git, worktree)
    await mkdir(dirname(worktree), { recursive: true })
    const commit = await gitOk(git, [
      "-c",
      "user.email=pr-merge@localhost",
      "-c",
      "user.name=pr:merge",
      "commit-tree",
      mergeTree,
      "-p",
      canary,
      "-p",
      head,
      "-m",
      `pr:merge types #${n}`,
    ])
    await gitOk(git, [
      "-c",
      "core.hooksPath=/dev/null",
      "worktree",
      "add",
      "--detach",
      worktree,
      commit,
    ])
    const times: string[] = []
    for (const step of steps({ canary, checkout, worktree })) {
      const left = deadline - Date.now()
      if (left <= 0)
        return unfinished(
          `it ran past its ${Math.round(budgetMs / 1000)}s before ${step.name}, waiting on the machine's run slots`,
        )
      const started = Date.now()
      const proc = Bun.spawn(step.argv, {
        cwd: worktree,
        env: {
          ...process.env,
          NODE_ENV: "production",
          SKIP_ENV_VALIDATION: "true",
          TURBO_CACHE_DIR:
            process.env.TURBO_CACHE_DIR || join(homedir(), ".cache", "turbo", "playground"),
        },
        killSignal: "SIGTERM",
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
        timeout: left,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      const seconds = Math.round((Date.now() - started) / 1000)
      if (code === 0) {
        times.push(`${step.name} ${seconds}s`)
        continue
      }
      // read from the clock: run-slot traps the TERM and exits 143 itself, so its kill leaves no signalCode
      if (Date.now() >= deadline)
        return unfinished(
          `${step.name} ran past the check's ${Math.round(budgetMs / 1000)}s, slot waits included`,
        )
      const output = `${stdout}\n${stderr}`
      const errors = firstErrors(output)
      if (step.types && errors.some((line) => /\berror TS\d+:/.test(line))) {
        const detail = `${at} fails ${step.name}: ${errors.join(" | ")} ${FIX}`
        await mkdir(dirname(memo), { recursive: true })
        await Bun.write(memo, detail)
        return { detail, name: NAME, ok: false }
      }
      return unfinished(`${step.name} exited ${code}: ${errors.join(" | ")}`)
    }
    return { detail: `${at} type-checks: ${times.join(", ")}`, name: NAME, ok: true }
  } catch (err) {
    return unfinished(err instanceof Error ? err.message : String(err))
  } finally {
    if (worktree) await clear(git, worktree)
  }
}
