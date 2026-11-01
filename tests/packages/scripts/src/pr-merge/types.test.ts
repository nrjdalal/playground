import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  prMerge,
  runGit,
  type Run,
  type RunResult,
} from "../../../../../packages/scripts/src/pr-merge/merge"
import { ciSteps, slotted } from "../../../../../packages/scripts/src/pr-merge/types"
import "./scratch-config"
import { greenChecks } from "./suite"

// The repo's own tsc, run on a three-file project, so the gate's run stays fast.
const TSC = join(import.meta.dir, "../../../../../node_modules/.bin/tsc")
const REPO = "acme/factory"
const N = 7

const scratch = mkdtempSync(join(tmpdir(), "pr-merge-types-"))
process.env.PLAYGROUND_MERGE_LOCK_DIR = join(scratch, "lock")
process.env.PLAYGROUND_HELD_PRS = join(scratch, "held-prs.json")
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ok = (stdout: string): RunResult => ({ code: 0, stderr: "", stdout })

const sh = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await runGit(["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args])
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

const write = (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text)
}

const commit = async (root: string, message: string) => {
  await sh(root, "add", "-A")
  await sh(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message)
  return sh(root, "rev-parse", "HEAD")
}

// A scratch origin and the checkout pr:merge runs from: canary changes add()'s arity and its one caller, and PR 7's head, branched before that, adds a caller with the old arity in a file of its own, so the two merge with no conflict. merged: the head merges canary in first, so it holds canary's tip.
async function world(name: string, { merged = false } = {}) {
  const root = join(scratch, name)
  const work = join(root, "work")
  mkdirSync(work, { recursive: true })
  await sh(work, "init", "-q", "-b", "canary")
  write(work, {
    "lib.ts": "export const add = (a: number): number => a\n",
    "main.ts": 'import { add } from "./lib"\nexport const one = add(1)\n',
    "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true, strict: true } }),
  })
  await commit(work, "base")
  await sh(work, "switch", "-qc", "pr")
  write(work, { "extra.ts": 'import { add } from "./lib"\nexport const two = add(2)\n' })
  await commit(work, "pr: a caller")
  await sh(work, "switch", "-q", "canary")
  write(work, {
    "lib.ts": "export const add = (a: number, b: number): number => a + b\n",
    "main.ts": 'import { add } from "./lib"\nexport const one = add(1, 0)\n',
  })
  await commit(work, "canary: add takes two")
  if (merged) {
    await sh(work, "switch", "-q", "pr")
    await sh(
      work,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "merge",
      "-q",
      "--no-edit",
      "canary",
    )
    write(work, { "extra.ts": 'import { add } from "./lib"\nexport const two = add(2, 0)\n' })
    await commit(work, "pr: two arguments")
  }
  const head = await sh(work, "rev-parse", "pr")
  const origin = join(root, "origin.git")
  await sh(root, "init", "-q", "--bare", origin)
  await sh(work, "push", "-q", origin, "canary", `pr:refs/pull/${N}/head`)
  const checkout = join(root, "checkout")
  await sh(root, "clone", "-q", "-b", "canary", origin, checkout)
  const git: Run = (args) => runGit(["-C", checkout, ...args])
  const lockRoot = join(root, "lock")
  mkdirSync(lockRoot)
  return { checkout, git, head, lockRoot }
}

// gh for PR 7 at head, every gate but types passing: canary is one commit ahead.
const gh = (head: string, aheadBy: string) => {
  const calls: string[][] = []
  const run: Run = async (args) => {
    calls.push(args)
    const joined = args.join(" ")
    if (joined.startsWith("pr view") && joined.includes("baseRefName"))
      return ok(
        JSON.stringify({
          author: { login: "acme" },
          baseRefName: "canary",
          headRefOid: head,
          isDraft: false,
          state: "OPEN",
          statusCheckRollup: [
            ...greenChecks(),
            { conclusion: "SUCCESS", name: "GitGuardian Security Checks", status: "COMPLETED" },
          ],
        }),
      )
    if (joined.includes("/files")) return ok("extra.ts\n")
    if (joined.includes("/comments"))
      return ok(
        JSON.stringify({
          author: "acme",
          body: `## ReviewBot · round 1: 5/5 at ${head.slice(0, 7)} · 0 blocking`,
          createdAt: "2026-11-01T15:00:00Z",
        }),
      )
    if (joined.includes("/compare/")) return ok(aheadBy)
    if (joined.startsWith("pr view") && joined.includes("--json body")) return ok("Closes #360")
    if (joined.startsWith("pr merge")) return ok("")
    if (joined.startsWith("pr view") && joined.includes("mergeCommit"))
      return ok(JSON.stringify({ mergeCommit: { oid: "abc1234def" }, state: "MERGED" }))
    if (joined.startsWith("pr comment")) return ok("")
    return { code: 1, stderr: `unexpected gh ${joined}`, stdout: "" }
  }
  return { calls, run }
}

const squashes = (calls: string[][]) =>
  calls.filter((args) => args[0] === "pr" && args[1] === "merge")

const tsc = () => [{ argv: [TSC, "-p", "."], name: "tsc", types: true }]

describe("the types gate", () => {
  test("refuses a head green alone whose clean merge with canary fails the type check, naming the error", async () => {
    const { checkout, git, head, lockRoot } = await world("arity")
    const { calls, run } = gh(head, "1")
    const outcome = await prMerge(N, { repo: REPO }, run, {
      git,
      lockRoot,
      store: null,
      types: tsc,
    })
    expect(outcome.kind).toBe("refused")
    expect(outcome.gates.filter((gate) => !gate.ok).map((gate) => gate.name)).toEqual(["types"])
    const types = outcome.gates.find((gate) => gate.name === "types")
    expect(types?.detail).toContain(
      "extra.ts(2,20): error TS2554: Expected 2 arguments, but got 1.",
    )
    expect(types?.detail).toContain(". Merge canary into the PR and fix the error")
    expect(squashes(calls)).toEqual([])
    // the scratch worktree is gone, and git no longer lists it
    expect(existsSync(join(checkout, ".claude", "worktrees", `merge-types-${N}`))).toBe(false)
    expect((await git(["worktree", "list"])).stdout.trim().split("\n")).toHaveLength(1)
    // the same head and canary refuse again from the kept refusal, with no second run
    const again = await prMerge(N, { repo: REPO }, gh(head, "1").run, {
      git,
      lockRoot,
      store: null,
      types: () => {
        throw new Error("ran a second time")
      },
    })
    expect(again.gates.find((gate) => gate.name === "types")?.detail).toBe(types?.detail ?? "")
  })

  test("merges a clean merged tree that type-checks, with each step's time", async () => {
    const { git, head, lockRoot } = await world("passes")
    const { calls, run } = gh(head, "1")
    const passing = () => [{ argv: ["true"], name: "tsc", types: true }]
    const outcome = await prMerge(N, { repo: REPO }, run, {
      git,
      lockRoot,
      store: null,
      types: passing,
    })
    expect(outcome.kind).toBe("merged")
    expect(outcome.gates.find((gate) => gate.name === "types")?.detail).toMatch(
      /type-checks: tsc \d+s$/,
    )
    expect(squashes(calls)).toHaveLength(1)
  })

  test("skips the type check when the head already holds canary's tip", async () => {
    const { git, head, lockRoot } = await world("holds", { merged: true })
    const { calls, run } = gh(head, "0")
    const outcome = await prMerge(N, { repo: REPO }, run, {
      git,
      lockRoot,
      store: null,
      types: () => {
        throw new Error("the gate ran on a head that holds canary")
      },
    })
    expect(outcome.kind).toBe("merged")
    expect(outcome.gates.find((gate) => gate.name === "types")?.detail).toMatch(
      /^skipped: [0-9a-f]{7} holds canary [0-9a-f]{7}, so its own checks typed this tree$/,
    )
    expect(squashes(calls)).toHaveLength(1)
  })

  test("refuses a run it cannot finish, naming the fix, and removes the worktree", async () => {
    const { checkout, git, head, lockRoot } = await world("unfinished")
    const failing = () => [{ argv: ["false"], name: "install" }]
    const outcome = await prMerge(N, { repo: REPO }, gh(head, "1").run, {
      git,
      lockRoot,
      store: null,
      types: failing,
    })
    expect(outcome.gates.find((gate) => gate.name === "types")).toMatchObject({ ok: false })
    expect(outcome.gates.find((gate) => gate.name === "types")?.detail).toStartWith(
      "could not finish the merged-tree type check: install exited 1",
    )
    expect(readdirSync(join(checkout, ".claude", "worktrees"))).toEqual([])
  })

  test("refuses a step that runs past the budget, slot waits included", async () => {
    const { git, head, lockRoot } = await world("slow")
    const slow = () => [{ argv: ["sleep", "5"], name: "check-types", types: true }]
    const outcome = await prMerge(N, { repo: REPO }, gh(head, "1").run, {
      git,
      lockRoot,
      store: null,
      types: slow,
      typesBudgetMs: 200,
    })
    expect(outcome.gates.find((gate) => gate.name === "types")?.detail).toContain(
      "check-types ran past the check's",
    )
  })

  test("--explain names the types gate and why it would run or skip, running no check", async () => {
    const behind = await world("explain-behind")
    const explained = await prMerge(N, { explain: true, repo: REPO }, gh(behind.head, "1").run, {
      git: behind.git,
      lockRoot: behind.lockRoot,
      types: () => {
        throw new Error("explain ran the check")
      },
    })
    expect(explained.kind).toBe("explained")
    expect(explained.gates.find((gate) => gate.name === "types")).toMatchObject({ ok: true })
    expect(explained.gates.find((gate) => gate.name === "types")?.detail).toMatch(
      /^runs at the merge: canary has commits [0-9a-f]{7} lacks, so pr:merge type-checks the merged tree [0-9a-f]{7} \(--explain runs none\)$/,
    )
    const holds = await world("explain-holds", { merged: true })
    const skipped = await prMerge(N, { explain: true, repo: REPO }, gh(holds.head, "0").run, {
      git: holds.git,
      lockRoot: holds.lockRoot,
    })
    expect(skipped.gates.find((gate) => gate.name === "types")?.detail).toStartWith("skipped: ")
  })

  test("ciSteps runs CI's type steps, each through run-slot as the merge train, or bare under a held slot", () => {
    const at = { canary: "c".repeat(40), checkout: "/co", worktree: "/wt" }
    const nice = process.env.RUN_SLOT_NICE
    process.env.RUN_SLOT_NICE = "10"
    try {
      expect(
        ciSteps(at).map((step) => [step.name, step.argv.join(" "), step.types ?? false]),
      ).toEqual([
        ["clone", "cp -cR /co/node_modules /wt/", false],
        ["install", "bun install --force --ignore-scripts --cwd /wt", false],
        ["check-types", `bunx turbo run check-types --filter=...[${"c".repeat(40)}]`, true],
        ["build", "bunx turbo run build --filter=./packages/* --filter=@api/hono", true],
        ["metrics", "bun packages/scripts/src/data-table-metrics.ts", false],
        ["check-types:tests", "bun run check-types:tests", true],
      ])
    } finally {
      if (nice === undefined) delete process.env.RUN_SLOT_NICE
      else process.env.RUN_SLOT_NICE = nice
    }
    expect(slotted(["tsc"], {}, "/ops/run-slot.sh")).toEqual([
      "/ops/run-slot.sh",
      "ops-merge-train",
      "--",
      "tsc",
    ])
    expect(slotted(["tsc"], { RUN_SLOT_NICE: "10" }, "/ops/run-slot.sh")).toEqual(["tsc"])
    expect(slotted(["tsc"], {}, null)).toEqual(["tsc"])
  })
})
