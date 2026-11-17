import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { takeLock } from "../pr-merge/merge"
import { writeAtomic } from "../write-atomic"
import type { Context } from "./tick"

// The boot check (issue 2612): once per boot it lets go of a merge lock taken before the boot, runs git fsck on the shared store through run-slot, repairs a torn loose object only a gate-owned worktree names, and alerts on any other break, changing nothing there.

// The worktrees the merge gate owns, by folder name under the checkout's .claude/worktrees, where types.ts builds merge-types' path.
export const GATE_WORKTREES = ["merge-types"]
// fsck stops at the first torn loose object, so each repair takes one more pass.
const PASSES = 10

export type BootDeps = {
  alert: (title: string, text: string) => Promise<void>
  lockRoot: string
  tell: (text: string) => Promise<void>
}

type Tree = { gitDir: string; head: string; path: string }

const TORN = /loose object ([0-9a-f]{40,64}) \(stored in [^)]+\) is corrupt/
const LEFTOVER = /invalid reflog entry ([0-9a-f]{40,64})/

const git = (ctx: Context, cwd: string, ...args: string[]) =>
  ctx.run(["git", "-C", cwd, ...args], 120_000)

const lines = (out: string): string[] =>
  out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

// A merge lock taken before the boot is stale on that alone, since every process of the old boot is dead and a pid written then can name a live one now; it goes where pr:merge lets one go, tagged boot.
const freeStaleLock = async (lockRoot: string, boot: number): Promise<string | null> => {
  const lock = join(lockRoot, "merge.lock")
  const taken = await stat(join(lock, "pr"))
    .catch(() => stat(lock))
    .catch(() => null)
  if (!taken || taken.mtimeMs >= boot) return null
  const pr = (await readFile(join(lock, "pr"), "utf8").catch(() => "")).trim() || "unnamed"
  const to = join(lockRoot, "merge-locks", `${pr}-${Date.now()}-boot`)
  await mkdir(dirname(to), { recursive: true })
  await rename(lock, to)
  return `boot-check: the merge lock for ${pr}, taken at ${new Date(taken.mtimeMs).toISOString()} before the boot at ${new Date(boot).toISOString()}, moved into ${to}`
}

// Every worktree with its HEAD and its own git folder, where its HEAD reflog lives.
const treesOf = async (ctx: Context): Promise<Tree[]> => {
  const list = await git(ctx, ctx.repo, "worktree", "list", "--porcelain")
  const trees: Tree[] = []
  for (const block of list.out.split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (!path) continue
    const gitDir = (await git(ctx, path, "rev-parse", "--absolute-git-dir")).out.trim()
    trees.push({ gitDir, head: /^HEAD ([0-9a-f]+)$/m.exec(block)?.[1] ?? "", path })
  }
  return trees
}

// A worktree's HEAD reflog as its shas, newest first; a line the cut tore reads as none.
const reflogOf = async (tree: Tree): Promise<string[]> =>
  (await readFile(join(tree.gitDir, "logs", "HEAD"), "utf8").catch(() => ""))
    .split("\n")
    .flatMap((line) => /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) /.exec(line)?.slice(1, 3) ?? [])
    .reverse()

// The newest commit a worktree's reflog holds that reads whole, never the torn one.
const lastGood = async (ctx: Context, tree: Tree, torn: string): Promise<string | null> => {
  for (const sha of await reflogOf(tree)) {
    if (sha === torn || /^0+$/.test(sha)) continue
    if ((await git(ctx, ctx.repo, "cat-file", "-e", `${sha}^{commit}`)).code === 0) return sha
  }
  return null
}

const report = async (deps: BootDeps, found: string[]) => {
  const shown = found.slice(0, 5)
  await deps.tell(
    `boot-check: git fsck after the boot found a break for a hand repair: ${shown.join("; ")}`,
  )
  await deps.alert(
    "The git store has a break after the boot",
    [...shown.map((line) => `- 🧱 ${line}`), "- 🔧 Nothing was changed there."].join("\n"),
  )
}

// Moves the torn object aside and re-points the worktree's HEAD when HEAD named it, under the merge lock, since a merge checks out into the gate's worktree; false while a live merge holds the lock.
const repair = async (
  ctx: Context,
  deps: BootDeps,
  tree: Tree,
  file: string,
  torn: string,
  good: string | null,
): Promise<boolean> => {
  const lock = await takeLock(deps.lockRoot, "boot-check")
  if ("holder" in lock) return false
  try {
    const tornDir = join(ctx.ops, "git-torn")
    const aside = join(tornDir, `${torn}-${Date.now()}`)
    await mkdir(tornDir, { recursive: true })
    await rename(file, aside)
    let head = "HEAD was another commit and stays"
    if (good) {
      const point = await git(ctx, tree.path, "update-ref", "--no-deref", "HEAD", good)
      if (point.code !== 0) throw new Error(`update-ref in ${tree.path}: ${point.out.trim()}`)
      head = `HEAD re-pointed to ${good}, the last good commit its reflog holds`
    }
    await deps.tell(
      `boot-check: repaired ${tree.path}: torn object ${torn} moved to ${aside}; ${head}`,
    )
  } finally {
    await lock.release()
  }
  return true
}

// One fsck pass: "clean" when fsck passes or names only the reflog lines a moved-aside object leaves, "again" after a repair, "held" while a live merge holds the lock, "told" once a break it leaves is reported.
const pass = async (ctx: Context, deps: BootDeps): Promise<"again" | "clean" | "held" | "told"> => {
  const fsck = await ctx.run(
    [
      join(ctx.ops, "run-slot.sh"),
      "ops-tick",
      "--",
      "git",
      "-C",
      ctx.repo,
      "fsck",
      "--no-dangling",
      "--no-progress",
    ],
    30 * 60_000,
  )
  if (fsck.code === 0) return "clean"
  const moved = await readdir(join(ctx.ops, "git-torn")).catch(() => [] as string[])
  const found = [...new Set(lines(fsck.out).filter((line) => !line.startsWith("run-slot.sh:")))]
  const broken = found.filter((line) => {
    const sha = LEFTOVER.exec(line)?.[1]
    return !sha || !moved.some((name) => name.startsWith(`${sha}-`))
  })
  if (found.length && !broken.length) return "clean"
  if (!broken.length) throw new Error(`git fsck exited ${fsck.code} naming nothing`)
  const torn = broken.map((line) => TORN.exec(line)?.[1]).find(Boolean)
  if (!torn) {
    await report(deps, broken)
    return "told"
  }
  const common = (
    await git(ctx, ctx.repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
  ).out.trim()
  const file = join(common, "objects", torn.slice(0, 2), torn.slice(2))
  const owners: Tree[] = []
  for (const tree of await treesOf(ctx))
    if (tree.head === torn || (await reflogOf(tree)).includes(torn)) owners.push(tree)
  const [tree] = owners
  const gate =
    owners.length === 1 &&
    GATE_WORKTREES.some(
      (name) => tree!.path === join(dirname(common), ".claude", "worktrees", name),
    )
  const good = gate && tree!.head === torn ? await lastGood(ctx, tree!, torn) : null
  if (gate && (tree!.head !== torn || good)) {
    return (await repair(ctx, deps, tree!, file, torn, good)) ? "again" : "held"
  }
  const named = owners.length
    ? owners.map((t) => t.path).join(", ")
    : "no worktree's HEAD or reflog"
  await report(deps, [`${file} is torn, named by ${named}`])
  return "told"
}

// The boot check for the boot at boot (readUpSince), once per boot, kept in tick/boot-check.json once it finishes; a pass that waits on a live merge's lock or throws keeps nothing, so the next minute inside the boot window tries again.
export const bootCheckPass = async (ctx: Context, boot: number, deps: BootDeps) => {
  const statePath = join(ctx.ops, "tick", "boot-check.json")
  const state = JSON.parse(await readFile(statePath, "utf8").catch(() => "null")) as {
    boot?: number
  } | null
  if (state?.boot === boot) return
  const freed = await freeStaleLock(deps.lockRoot, boot)
  if (freed) await deps.tell(freed)
  let result = await pass(ctx, deps)
  for (let i = 1; i < PASSES && result === "again"; i++) result = await pass(ctx, deps)
  if (result === "held") return
  if (result === "again") await report(deps, [`still broken after ${PASSES} repairs`])
  await writeAtomic(statePath, JSON.stringify({ at: ctx.now.toISOString(), boot }))
}
