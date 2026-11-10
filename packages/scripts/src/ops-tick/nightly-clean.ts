import { statfsSync } from "node:fs"
import { appendFile, lstat, mkdir, readdir, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

import { managerOf } from "@packages/config/kinds"

import {
  type CleanupDeps,
  cleanupDeps,
  cleanWorktree,
} from "../../../../scripts/ops/optimizer/auto_end"
import { writeAtomic } from "../write-atomic"
import type { Context } from "./tick"

// ops-tick's nightly-clean beat: what no merge's cleanup reaches, in order: stale worktrees (trashed, each restorable), branches (each head archived as a tag first), worktree containers and Docker's dangling images and build cache, the turbo cache over 2 days old; then one log line, one outbox line to ops naming each removal, and an Inbox update when 1 GB or more was freed. It asks no decision: each container or volume no rule removes is kept and named as kept.

const GB = 1024 ** 3
// The freed-space finding's link, a dashboard path the card resolves against the app's own URL, so no host is written here.
export const FREED_LINK = "- 💾 Free disk shows on the [System page](/dashboard/system)."
const TURBO_CACHE = join(homedir(), ".cache", "turbo", "playground")

export type Pr = { headRefOid: string; state: "CLOSED" | "MERGED" | "OPEN"; url: string }
// repo is the repository's https URL, which the branch step's archive tags are pushed through.
export type Prs = { byBranch: Map<string, Pr>; byNumber: Map<number, Pr>; repo?: string }
export type Ref = { name: string; sha: string }
export type Worktree = { branch: string | null; path: string }

// What the beat reads and runs beyond ctx.run, so a test hands it fakes: the merge-time cleanup's deps, free bytes on the data folder's disk, the PRs of branches and numbers (null when GitHub cannot be read), the turbo cache's folder, the clock the cap's pacing reads, and the sleep it waits on.
export type NightDeps = {
  cleanup: () => Promise<CleanupDeps | null>
  free: (dir: string) => number
  now: () => number
  prs: (ctx: Context, branches: string[], numbers: number[]) => Promise<Prs | null>
  sleep: (ms: number) => Promise<void>
  turbo: string
}

// The beat's own record: the last run's time alone; a decision or denied key an older run wrote is read past and dropped on the next write.
type State = { at?: string }

const lines = (out: string): string[] => out.split("\n").filter((l) => l.trim())
const gbOf = (bytes: number): string => (bytes / GB).toFixed(1)

// Pure: docker's sizes ("63B", "1.2GB", "512kB (virtual 2GB)") in bytes, the first figure alone.
export const bytesOf = (size: string): number => {
  const m = /^([\d.]+)\s*([kKMGT]?B)/.exec(size.trim())
  if (!m) return 0
  const scale = { B: 1, GB: 1e9, KB: 1e3, MB: 1e6, TB: 1e12, kB: 1e3 }[m[2]!] ?? 1
  return Number(m[1]) * scale
}

// Pure: git worktree list --porcelain's worktrees directly in <main>/.claude/worktrees, each with its branch or null when detached.
export const worktreesIn = (porcelain: string, main: string): Worktree[] =>
  porcelain.split("\n\n").flatMap((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (!path || dirname(path) !== join(main, ".claude", "worktrees")) return []
    return [{ branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null, path }]
  })

// Pure: the PR number a review-<n> or test-<n> clone's folder names, else undefined.
const cloneOf = (path: string): number | undefined => {
  const n = /^(?:review|test)-(\d+)$/.exec(basename(path))?.[1]
  return n ? Number(n) : undefined
}

// Pure: the worktrees whose PR is merged or closed, each with that PR: its branch's newest PR, else a review-<n> or test-<n> clone's PR n; a worktree with no PR, or an open one, stays.
export const staleWorktrees = (worktrees: Worktree[], prs: Prs): (Worktree & { pr: Pr })[] =>
  worktrees.flatMap((w) => {
    const n = cloneOf(w.path)
    const pr =
      (w.branch ? prs.byBranch.get(w.branch) : undefined) ??
      (n === undefined ? undefined : prs.byNumber.get(n))
    return pr !== undefined && pr.state !== "OPEN" ? [{ ...w, pr }] : []
  })

// Pure: what the branch step does. A local branch merged into origin/canary, or one whose merged or closed PR still holds its head, goes with -D (the main checkout's HEAD is main, so -d would refuse one merged into canary alone), and a remote one whose merged or closed PR holds its head is deleted on origin, since GitHub restores it from the PR's page; an unmerged local branch with no PR, or one ahead of its PR's head, goes to the archive list, whose head is tagged on origin before any delete, so the tag holds the old head. A kept branch (canary, main, the live dashboard's), one a worktree has checked out, and one with an open PR stay.
export const staleBranches = (input: {
  checkedOut: Set<string>
  keep: Set<string>
  local: Ref[]
  merged: Set<string>
  prs: Map<string, Pr>
  remote: Ref[]
}): { archive: string[]; local: string[]; remote: string[] } => {
  const done = (pr: Pr | undefined, sha: string) =>
    pr !== undefined && pr.state !== "OPEN" && pr.headRefOid === sha
  const out = {
    archive: [] as string[],
    local: [] as string[],
    remote: [] as string[],
  }
  for (const b of input.local) {
    if (input.keep.has(b.name) || input.checkedOut.has(b.name)) continue
    const pr = input.prs.get(b.name)
    if (input.merged.has(b.name) || done(pr, b.sha)) out.local.push(b.name)
    else if (pr?.state !== "OPEN") out.archive.push(b.name)
  }
  for (const r of input.remote)
    if (!input.keep.has(r.name) && done(input.prs.get(r.name), r.sha)) out.remote.push(r.name)
  return out
}

// Pure: what the docker step removes and names as kept. An exited playground-<worktree>-db or -redis container whose worktree folder is gone is removed; the live dashboard's database (and pglaunch's beside it), a Vibeground copy, a running container and any other name stay, and one over 1 GB is named as kept, but the live dashboard's, pglaunch's and a Vibeground copy, which stay unnamed.
export const staleContainers = (
  listed: { name: string; size: number; state: string }[],
  folders: string[],
  live: (container: string) => boolean,
): { keep: string[]; remove: string[] } => {
  const here = new Set(folders.map((f) => f.replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase()))
  const out = { keep: [] as string[], remove: [] as string[] }
  for (const c of listed) {
    if (live(c.name) || c.name.startsWith("playground-vibe-")) continue
    const worktree = /^playground-(.+)-(?:db|redis)$/.exec(c.name)?.[1]
    if (worktree && c.state === "exited" && !here.has(worktree.toLowerCase()))
      out.remove.push(c.name)
    else if (c.size > GB) out.keep.push(c.name)
  }
  return out
}

// Pure: docker system df -v's volumes no container uses (its Links a string, "0") that hold over 1 GB, each kept and named as kept.
export const staleVolumes = (df: string): string[] => {
  try {
    const volumes = (
      JSON.parse(df) as { Volumes?: { Links?: string; Name?: string; Size?: string }[] }
    ).Volumes
    return (volumes ?? [])
      .filter((v) => v.Name && Number(v.Links) === 0 && bytesOf(v.Size ?? "") > GB)
      .map((v) => v.Name!)
  } catch {
    return []
  }
}

// Pure: the batches trash-purge.log's lines after since removed, from each line's "removed <n>".
export const trashSince = (log: string, since: number): number =>
  lines(log).reduce((sum, line) => {
    const [at = "", word, n] = line.split(" ")
    return Date.parse(at) > since && word === "removed" ? sum + (Number(n) || 0) : sum
  }, 0)

// The shared turbo cache's files last modified over days ago, removed; the line saying how many and how much, or why none was.
export async function pruneTurbo(dir: string, now: Date, days = 2): Promise<string> {
  const cutoff = now.getTime() - days * 86_400_000
  let removed = 0
  let kept = 0
  let freed = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) =>
    err.code === "ENOENT" ? `no folder ${dir}` : `unreadable ${dir}: ${err.code ?? err.message}`,
  )
  if (typeof entries === "string") return entries
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    const info = await lstat(path).catch(() => null)
    if (!info) continue
    if (info.mtimeMs >= cutoff) {
      kept++
      continue
    }
    if (
      !(await unlink(path).then(
        () => true,
        () => false,
      ))
    )
      continue
    removed++
    freed += info.size
  }
  return `removed ${removed}, kept ${kept}, freed ${Math.round(freed / 1_048_576)} MB`
}

// rm quarantines at most 3 paths a session per minute; the beat paces every move its worktree step makes under that cap, cleanWorktree's own included, waiting before a 4th inside the minute so rm's tripwire stays quiet, retries a refused move once the minute is out, and names what a bound on the total wait leaves for the next run. Other beats run beside this one (tick.ts starts each due beat on its own), so the wait holds up nothing.
const RM_CAP = /quarantined \d+ paths in the last minute/
const CAP_WAIT_MS = 60_000
const CAP_WAIT_BOUND_MS = 600_000
// The refs API's answer for a sha GitHub does not hold (measured, 422).
const UNKNOWN_SHA = /Object does not exist/

// Pure: whether a cleanWorktree line kept work the standing approval may trash: uncommitted or unpushed work, or rm's unlanded-work refusal that names --discard.
export const discardable = (line: string): boolean =>
  /: (uncommitted work|unpushed commits)$/.test(line) ||
  line.includes("--discard removes it anyway")

// --silent, since bun run's "$ bun ..." line goes to stderr, which ctx.run joins after stdout, and get's JSON would not parse
const ask = async (ctx: Context, args: string[], stdin?: string) =>
  ctx.run(["bun", "run", "--silent", "--cwd", ctx.repo, "ask", ...args], 120_000, stdin)

const cliOf = (ctx: Context): string =>
  join(ctx.repo, "packages", "scripts", "src", "playground", "cli.ts")

// A worktree's trash move under the owner's standing approval, the nightly cleanup acting on its own: playground rm --worktree --discard with the fixed reason nightly-clean, no delete decision asked, the id it prints the one playground rm --restore brings back.
const trashWorktree = (ctx: Context, path: string) =>
  ctx.run([
    "bun",
    "--no-env-file",
    cliOf(ctx),
    "rm",
    "--worktree",
    path,
    "--discard",
    "--reason",
    "nightly-clean",
  ])

// Pure: the trash id a playground rm trash move printed, the one playground rm --restore takes.
export const trashIdOf = (out: string): string | undefined =>
  /\d{8}T\d{6}Z-[A-Za-z0-9][A-Za-z0-9-]*\/\d+/.exec(out)?.[0]

// One night's run: each step logged, a failed step named and the rest run on.
export const nightlyClean =
  (deps: NightDeps = liveNight) =>
  async (ctx: Context) => {
    const statePath = join(ctx.ops, "tick", "nightly-clean.json")
    const state = (await Bun.file(statePath)
      .json()
      .catch(() => ({}))) as State
    const data = dirname(ctx.ops)
    const before = deps.free(data)
    const said: string[] = []
    // Each removal and each kept leftover, named for the outbox line to ops: a removal with its trash id or archive tag, a keep with why.
    const removed: string[] = []
    const kept: string[] = []
    let mark = before
    const step = async (name: string, body: () => Promise<string>) => {
      const line = await body().catch((err: Error) => `failed: ${err.message}`)
      const now = deps.free(data)
      said.push(`${name}: ${line} (${gbOf(now - mark)} GB)`)
      mark = now
    }
    const cleanup = await deps.cleanup()
    const main = cleanup?.main ?? ctx.repo
    const git = (args: string[]) => ctx.run(["git", "-C", main, ...args])
    const fetched = await ctx.run(
      [
        join(ctx.ops, "run-slot.sh"),
        "ops-tick",
        "--",
        "git",
        "-C",
        main,
        "fetch",
        "-q",
        "--prune",
        "origin",
      ],
      10 * 60_000,
    )
    if (fetched.code !== 0) said.push(`fetch: failed, so the refs read are the last fetch's`)
    const refs = async (where: string, format: string): Promise<Ref[]> =>
      lines((await git(["for-each-ref", where, `--format=${format} %(objectname)`])).out)
        .map((l) => ({ name: l.split(" ")[0]!, sha: l.split(" ")[1] ?? "" }))
        .filter((r) => r.name !== "HEAD")
    const local = () => refs("refs/heads", "%(refname:short)")
    const remote = await refs("refs/remotes/origin", "%(refname:lstrip=3)")
    const worktrees = worktreesIn((await git(["worktree", "list", "--porcelain"])).out, main)
    const numbers = worktrees.flatMap((w) => {
      const n = cloneOf(w.path)
      return n === undefined ? [] : [n]
    })
    const names = [...new Set([...(await local()), ...remote].map((r) => r.name))]
    const prs = await deps.prs(ctx, names, numbers)
    await step("worktrees", async () => {
      if (!cleanup) return "no main checkout found, none read"
      if (!prs) return "GitHub unreadable, none read"
      const out: string[] = []
      let waited = 0
      const moves: number[] = []
      const left = (path: string) => {
        out.push(
          `left ${path} for the next run: rm's cap held past the ${CAP_WAIT_BOUND_MS / 60_000}-minute wait`,
        )
        kept.push(`worktree ${path} left for the next run: rm's cap held past the wait bound`)
      }
      // The pace goes before every call that can reach rm, cleanWorktree's own move included, so a 4th move inside the minute never lands and rm's tripwire pages no one, under the same bound as the retry; false past the bound, where the worktree is named for the next run and rm is not called.
      const paced = async (): Promise<boolean> => {
        const recent = moves.filter((at) => deps.now() - at < CAP_WAIT_MS)
        if (recent.length < 3) return true
        if (waited + CAP_WAIT_MS > CAP_WAIT_BOUND_MS) return false
        const pause = CAP_WAIT_MS - (deps.now() - recent[0]!)
        if (pause > 0) {
          await deps.sleep(pause)
          waited += pause
        }
        return true
      }
      for (const w of staleWorktrees(worktrees, prs)) {
        if (!(await paced())) {
          left(w.path)
          continue
        }
        const line = await cleanWorktree(w.path, "nightly-clean", cleanup, {
          pr: w.pr.url,
          pushed: w.pr.headRefOid,
        })
        out.push(line)
        if (line.startsWith("removed ")) moves.push(deps.now())
        if (!discardable(line)) continue
        // The owner's standing approval: trashed with no decision, the 7-day trash holds it and playground rm --restore brings it back. The retry below stays for the callers this session shares with.
        if (!(await paced())) {
          left(w.path)
          continue
        }
        let moved = await trashWorktree(ctx, w.path)
        if (moved.code === 0) moves.push(deps.now())
        let capped = moved.code !== 0 && RM_CAP.test(moved.out)
        while (capped && waited + CAP_WAIT_MS <= CAP_WAIT_BOUND_MS) {
          await deps.sleep(CAP_WAIT_MS)
          waited += CAP_WAIT_MS
          moved = await trashWorktree(ctx, w.path)
          if (moved.code === 0) moves.push(deps.now())
          capped = moved.code !== 0 && RM_CAP.test(moved.out)
        }
        const id = trashIdOf(moved.out)
        if (moved.code === 0 && id) {
          out.push(`trashed ${w.path} as ${id}, restorable with playground rm --restore ${id}`)
          removed.push(`worktree ${w.path} as trash ${id} (playground rm --restore ${id})`)
        } else if (capped) left(w.path)
        else {
          out.push(`kept ${w.path}: its trash move failed: ${lines(moved.out).at(-1) ?? ""}`)
          kept.push(`worktree ${w.path} kept: its trash move failed`)
        }
      }
      return out.length ? out.join("; ") : "none stale"
    })
    await step("branches", async () => {
      if (!prs) return "GitHub unreadable, none read"
      const listed = (await git(["worktree", "list", "--porcelain"])).out
      const checkedOut = [...listed.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]!)
      const merged = await git(["branch", "--merged", "origin/canary", "--format=%(refname:short)"])
      const locals = await local()
      const plan = staleBranches({
        checkedOut: new Set(checkedOut),
        keep: new Set(["canary", "main", cleanup?.liveBranch ?? ""]),
        local: locals,
        merged: new Set(merged.code === 0 ? lines(merged.out) : []),
        prs: prs.byBranch,
        remote,
      })
      let deleted = 0
      for (const name of plan.local) if ((await git(["branch", "-D", name])).code === 0) deleted++
      let remotes = 0
      for (const name of plan.remote)
        if ((await git(["push", "-q", "origin", "--delete", name])).code === 0) remotes++
      // The archive tag is pushed through the git refs API, as the ship's tag step does, before any delete, so the tag holds the old head and git branch <name> archive/<name> brings the branch back. A branch whose origin head is not the local head the tag would hold stays whole, since the tag would not hold what the origin delete drops.
      const shas = new Map(locals.map((r) => [r.name, r.sha]))
      const api = prs.repo?.replace(/^https:\/\/github\.com\//, "repos/")
      const out: string[] = []
      for (const name of plan.archive) {
        const tag = `archive/${name}`
        const sha = shas.get(name) ?? ""
        const originRef = remote.find((r) => r.name === name)
        if (originRef && originRef.sha !== sha) {
          const why = `origin's head is ${originRef.sha}, not the local head ${sha}`
          out.push(`kept ${name}: ${why}`)
          kept.push(`branch ${name} kept: ${why}`)
          continue
        }
        const made = api
          ? await ctx.run([
              "gh",
              "api",
              "-X",
              "POST",
              `${api}/git/refs`,
              "-f",
              `ref=refs/tags/${tag}`,
              "-f",
              `sha=${sha}`,
            ])
          : { code: 1, out: "no repository read" }
        // A head GitHub does not hold, a branch never pushed, would go public with a push, so it stays with a local archive tag alone, named the night that tag is made and quiet on every night after.
        if (made.code !== 0 && UNKNOWN_SHA.test(made.out)) {
          const local = await git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`])
          if (local.code === 0 && lines(local.out)[0] === sha) continue
          if ((await git(["tag", tag, sha])).code === 0) {
            out.push(
              `kept ${name}: its head ${sha} is not on GitHub, so it is tagged ${tag} locally alone`,
            )
            kept.push(`branch ${name} kept: its head is not on GitHub, tagged ${tag} locally`)
          } else {
            out.push(
              `kept ${name}: its head ${sha} is not on GitHub, and its local ${tag} tag failed`,
            )
            kept.push(`branch ${name} kept: its head is not on GitHub, its local tag failed`)
          }
          continue
        }
        if (made.code !== 0) {
          // The tag already at this head, as a retried night finds, holds it: the deletes go on.
          const there = await git(["ls-remote", "origin", `refs/tags/${tag}`])
          const at =
            lines(there.out)[0]?.split(/\t/)[1] === `refs/tags/${tag}`
              ? (lines(there.out)[0]?.split(/\t/)[0] ?? "")
              : ""
          if (there.code !== 0 || at !== sha) {
            out.push(`kept ${name}: its ${tag} tag failed: ${lines(made.out).at(-1) ?? ""}`)
            kept.push(`branch ${name} kept: its ${tag} tag failed`)
            continue
          }
        }
        const originDeleted =
          !originRef || (await git(["push", "-q", "origin", "--delete", name])).code === 0
        if (!originDeleted) {
          out.push(`kept ${name}: its origin delete failed, its ${tag} tag holds the head`)
          kept.push(`branch ${name} kept: its origin delete failed`)
          continue
        }
        const localDeleted = (await git(["branch", "-D", name])).code === 0
        if (localDeleted) {
          out.push(
            `archived ${name} as ${tag} at ${sha}, deleted${originRef ? " on origin and" : ""} locally`,
          )
          removed.push(`branch ${name} as tag ${tag} at ${sha}`)
        } else {
          out.push(`kept ${name}: its local delete failed, its ${tag} tag holds the head`)
          kept.push(`branch ${name} kept: its local delete failed`)
        }
      }
      return `deleted ${deleted} local, ${remotes} remote; ${out.length ? out.join("; ") : "none to archive"}`
    })
    await step("docker", async () => {
      const listed = await ctx.run([
        "docker",
        "ps",
        "-a",
        "--size",
        "--format",
        "{{.Names}}\t{{.State}}\t{{.Size}}",
      ])
      if (listed.code !== 0) return "docker unreadable, none read"
      const folders = await readdir(join(main, ".claude", "worktrees")).catch(() => null)
      if (!folders) return "the worktrees folder unreadable, none removed"
      const plan = staleContainers(
        lines(listed.out).map((l) => {
          const [name = "", state = "", size = ""] = l.split("\t")
          return { name, size: bytesOf(size), state }
        }),
        folders,
        cleanup?.live ?? (() => true),
      )
      const gone: string[] = []
      const left: string[] = []
      for (const name of plan.remove)
        if ((await ctx.run(["docker", "rm", "-fv", name])).code === 0)
          gone.push(`container ${name}`)
        else left.push(`container ${name} kept: its removal failed`)
      for (const name of plan.keep)
        left.push(`container ${name} kept: over 1 GB, no rule removes it`)
      const df = await ctx.run(["docker", "system", "df", "-v", "--format", "{{json .}}"])
      for (const name of staleVolumes(df.out))
        left.push(`volume ${name} kept: unused and over 1 GB, no rule removes it`)
      removed.push(...gone)
      kept.push(...left)
      const slot = (argv: string[]) =>
        ctx.run([join(ctx.ops, "run-slot.sh"), "ops-tick", "--", ...argv], 30 * 60_000)
      const images = await slot(["docker", "image", "prune", "-f"])
      const cache = await slot(["docker", "builder", "prune", "-f"])
      return `removed ${gone.length} containers${gone.length ? ` (${gone.join(", ")})` : ""}; ${left.length ? left.join("; ") : "none kept"}; image prune ${images.code === 0 ? "ran" : "failed"}, build cache prune ${cache.code === 0 ? "ran" : "failed"}`
    })
    await step("turbo", () => pruneTurbo(deps.turbo, ctx.now))
    const purged = trashSince(
      await Bun.file(join(ctx.ops, "log", "trash-purge.log"))
        .text()
        .catch(() => ""),
      Date.parse(state.at ?? "") || ctx.now.getTime() - 86_400_000,
    )
    said.push(`trash: ${purged} batches purged since the last run`)
    const named = [...removed, ...kept]
    if (named.length)
      await ctx.send(
        "ops",
        `nightly-clean removed ${removed.length}, kept ${kept.length}: ${named.join("; ")}`,
      )
    const after = deps.free(data)
    const roster = await Bun.file(join(data, "roster.json"))
      .json()
      .catch(() => null)
    const from = managerOf((roster as { agents?: unknown } | null)?.agents, "ops")
    if (after - before >= GB)
      await ask(
        ctx,
        ["new"],
        JSON.stringify({
          from,
          kind: "update",
          preview: { outcome: "finding", text: FREED_LINK },
          title: `The nightly cleanup freed ${gbOf(after - before)} GB: free disk ${gbOf(before)} GB, now ${gbOf(after)} GB`,
        }),
      )
    await mkdir(join(ctx.ops, "tick"), { recursive: true })
    await writeAtomic(statePath, JSON.stringify({ at: ctx.now.toISOString() } satisfies State))
    await mkdir(join(ctx.ops, "log"), { recursive: true })
    await appendFile(
      join(ctx.ops, "log", "nightly-clean.log"),
      `${ctx.now.toISOString().replace(/\.\d{3}Z$/, "Z")} free ${gbOf(before)} GB, now ${gbOf(after)} GB; ${said.join("; ")}\n`,
    )
  }

// Pure: one gh api graphql answer read into prs, its b<i> aliases by branch and n<i> by number, a null alias (a number that is no PR) skipped; false when it holds no repository. Its stdout's JSON alone, read up to the "gh: ..." lines of stderr, which ctx.run joins straight after it, since gh ends the body with no newline and an answer with errors exits 1 with its data and errors there.
export const readPrs = (out: string, branches: string[], numbers: number[], prs: Prs): boolean => {
  let found: Record<string, unknown> | undefined
  try {
    found = (
      JSON.parse(out.split(/(?<=^|[}\n])gh: /)[0] ?? "") as {
        data?: { repository?: Record<string, unknown> }
      }
    ).data?.repository
  } catch {
    return false
  }
  if (!found) return false
  for (const [alias, value] of Object.entries(found)) {
    const at = Number(alias.slice(1))
    if (alias.startsWith("b")) {
      const pr = (value as { nodes?: Pr[] } | null)?.nodes?.[0]
      if (pr) prs.byBranch.set(branches[at]!, pr)
    } else if (value) prs.byNumber.set(numbers[at]!, value as Pr)
  }
  return true
}

// This machine's: auto_end's cleanup deps, statfs, GitHub's PRs in batched GraphQL reads through gh, the shared turbo cache, and a real sleep.
const liveNight: NightDeps = {
  cleanup: cleanupDeps,
  free: (dir) => {
    const fs = statfsSync(dir)
    return fs.bavail * fs.bsize
  },
  now: () => Date.now(),
  prs: async (ctx, branches, numbers) => {
    const url = (await ctx.run(["git", "-C", ctx.repo, "remote", "get-url", "origin"])).out.trim()
    const repo = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url)
    if (!repo) return null
    const q = JSON.stringify
    const fields = "state headRefOid url"
    const parts = [
      ...branches.map(
        (b, i) =>
          `b${i}: pullRequests(headRefName: ${q(b)}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}, states: [OPEN, MERGED, CLOSED]) { nodes { ${fields} } }`,
      ),
      ...numbers.map((n, i) => `n${i}: pullRequest(number: ${n}) { ${fields} }`),
    ]
    const prs: Prs = {
      byBranch: new Map(),
      byNumber: new Map(),
      repo: `https://github.com/${repo[1]}/${repo[2]}`,
    }
    for (let i = 0; i < parts.length; i += 100) {
      const query = `query { repository(owner: ${q(repo[1])}, name: ${q(repo[2])}) { ${parts.slice(i, i + 100).join(" ")} } }`
      const read = await ctx.run(["gh", "api", "graphql", "-f", `query=${query}`], 120_000)
      if (!readPrs(read.out, branches, numbers, prs)) return null
    }
    return prs
  },
  sleep: (ms) => Bun.sleep(ms),
  turbo: TURBO_CACHE,
}
