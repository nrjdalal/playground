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

// ops-tick's nightly-clean beat: what no merge's cleanup reaches, in order: stale worktrees, branches, worktree containers and Docker's dangling images and build cache, the turbo cache over 2 days old; then one log line, an Inbox update when 1 GB or more was freed, and one delete decision for what only the owner's Approve may remove.

const GB = 1024 ** 3
const TURBO_CACHE = join(homedir(), ".cache", "turbo", "playground")

export type Pr = { headRefOid: string; state: "CLOSED" | "MERGED" | "OPEN" }
export type Prs = { byBranch: Map<string, Pr>; byNumber: Map<number, Pr> }
export type Ref = { name: string; sha: string }
export type Target = { kind: "branch" | "container" | "volume" | "worktree"; name: string }
export type Worktree = { branch: string | null; path: string }

// What the beat reads and runs beyond ctx.run, so a test hands it fakes: the merge-time cleanup's deps, free bytes on the data folder's disk, the PRs of branches and numbers (null when GitHub cannot be read), and the turbo cache's folder.
export type NightDeps = {
  cleanup: () => Promise<CleanupDeps | null>
  free: (dir: string) => number
  prs: (ctx: Context, branches: string[], numbers: number[]) => Promise<Prs | null>
  turbo: string
}

type State = { at?: string; decision?: { id: string; targets: Target[] }; denied?: string[] }

const keyOf = (t: Target): string => `${t.kind} ${t.name}`
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

// Pure: the worktrees whose PR is merged or closed, each with that PR: its branch's newest PR, else a review-<n> or test-<n> clone's PR n; a worktree with no PR, or an open one, stays.
export const staleWorktrees = (worktrees: Worktree[], prs: Prs): (Worktree & { pr: Pr })[] =>
  worktrees.flatMap((w) => {
    const n = /^(?:review|test)-(\d+)$/.exec(basename(w.path))?.[1]
    const pr =
      (w.branch ? prs.byBranch.get(w.branch) : undefined) ??
      (n ? prs.byNumber.get(Number(n)) : undefined)
    return pr !== undefined && pr.state !== "OPEN" ? [{ ...w, pr }] : []
  })

// Pure: what the branch step does. A local branch merged into origin/canary, or one whose merged or closed PR still holds its head, goes with -D (the main checkout's HEAD is main, so -d would refuse one merged into canary alone), and a remote one whose merged or closed PR holds its head is deleted on origin, since GitHub restores it from the PR's page; an unmerged local branch with no PR, or one ahead of its PR's head, goes to the decision list. A kept branch (canary, main, the live dashboard's), one a worktree has checked out, and one with an open PR stay.
export const staleBranches = (input: {
  checkedOut: Set<string>
  keep: Set<string>
  local: Ref[]
  merged: Set<string>
  prs: Map<string, Pr>
  remote: Ref[]
}): { decide: string[]; local: string[]; remote: string[] } => {
  const done = (pr: Pr | undefined, sha: string) =>
    pr !== undefined && pr.state !== "OPEN" && pr.headRefOid === sha
  const out = {
    decide: [] as string[],
    local: [] as string[],
    remote: [] as string[],
  }
  for (const b of input.local) {
    if (input.keep.has(b.name) || input.checkedOut.has(b.name)) continue
    const pr = input.prs.get(b.name)
    if (input.merged.has(b.name) || done(pr, b.sha)) out.local.push(b.name)
    else if (pr?.state !== "OPEN") out.decide.push(b.name)
  }
  for (const r of input.remote)
    if (!input.keep.has(r.name) && done(input.prs.get(r.name), r.sha)) out.remote.push(r.name)
  return out
}

// Pure: what the docker step removes and asks. An exited playground-<worktree>-db or -redis container whose worktree folder is gone is removed; the live dashboard's database (and pglaunch's beside it), a Vibeground copy and a running container stay, and any other container over 1 GB goes to the decision list.
export const staleContainers = (
  listed: { name: string; size: number; state: string }[],
  folders: string[],
  live: (container: string) => boolean,
): { decide: string[]; remove: string[] } => {
  const here = new Set(folders.map((f) => f.replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase()))
  const out = { decide: [] as string[], remove: [] as string[] }
  for (const c of listed) {
    if (live(c.name) || c.name.startsWith("playground-vibe-")) continue
    const worktree = /^playground-(.+)-(?:db|redis)$/.exec(c.name)?.[1]
    if (worktree && c.state === "exited" && !here.has(worktree.toLowerCase()))
      out.remove.push(c.name)
    else if (c.size > GB) out.decide.push(c.name)
  }
  return out
}

// Pure: docker system df -v's volumes no container uses (its Links a string, "0") that hold over 1 GB, for the decision list.
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

// Pure: the night's delete decision, each target named whole (playground rm --decision matches full paths), as many as fit the Inbox's 4,000 characters; the rest wait for the next night.
export const decisionOf = (
  from: string,
  targets: Target[],
): { item: object; targets: Target[] } => {
  const named: Target[] = []
  let what = ""
  for (const t of targets) {
    const line = `- ${t.kind} \`${t.name}\`\n`
    if (what.length + line.length > 3800) break
    named.push(t)
    what += line
  }
  return {
    item: {
      from,
      kind: "decision",
      preview: {
        type: "delete",
        what: what.trimEnd(),
        why: "The nightly cleanup found these left over: a worktree with work no merge landed, a branch with no merged PR, or a container or volume over 1 GB that no rule removes. Approve removes each on the next night's run; Deny keeps them, and they are not asked again.",
      },
      title: `Delete ${named.length} leftover${named.length === 1 ? "" : "s"} the nightly cleanup found`,
    },
    targets: named,
  }
}

// Pure: whether a cleanWorktree line kept work only the owner's Approve may drop: uncommitted or unpushed work, or rm's unlanded-work refusal that names --discard.
export const discardable = (line: string): boolean =>
  / (uncommitted work|unpushed commits)$/.test(line) || line.includes("--discard removes it anyway")

// --silent, since bun run's "$ bun ..." line goes to stderr, which ctx.run joins after stdout, and get's JSON would not parse
const ask = async (ctx: Context, args: string[], stdin?: string) =>
  ctx.run(["bun", "run", "--silent", "--cwd", ctx.repo, "ask", ...args], 120_000, stdin)

const idOf = (out: string): string | undefined =>
  lines(out)
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f-]{36}$/.test(l))

// Carries out last night's approved targets, closes a denied or set-aside one (keeping its targets out of later asks), and answers whether it is still open.
async function settleLast(
  ctx: Context,
  state: State,
  main: string,
  done: string[],
): Promise<boolean> {
  const last = state.decision
  if (!last) return false
  const got = await ask(ctx, ["get", last.id])
  const status = (() => {
    try {
      return (JSON.parse(got.out) as { status?: string }).status
    } catch {
      return undefined
    }
  })()
  if (got.code !== 0 || !status) {
    done.push(`decision ${last.id} unreadable, dropped`)
    state.decision = undefined
    return false
  }
  if (status === "open") return true
  if (status === "approved") {
    const cli = join(ctx.repo, "packages", "scripts", "src", "playground", "cli.ts")
    const runs: Record<Target["kind"], (name: string) => string[]> = {
      branch: (name) => ["git", "-C", main, "branch", "-D", name],
      container: (name) => ["docker", "rm", "-fv", name],
      volume: (name) => ["docker", "volume", "rm", name],
      worktree: (name) => [
        "bun",
        "--no-env-file",
        cli,
        "rm",
        "--worktree",
        name,
        "--discard",
        "--decision",
        last.id,
        "--reason",
        "nightly-clean, approved",
      ],
    }
    let gone = 0
    for (const t of last.targets) if ((await ctx.run(runs[t.kind](t.name))).code === 0) gone++
    await ask(ctx, [
      "ack",
      last.id,
      "--no-link",
      `nightly-clean removed ${gone} of ${last.targets.length}`,
    ])
    done.push(`decision ${last.id} approved: removed ${gone} of ${last.targets.length}`)
  } else {
    await ask(ctx, ["get", last.id, "--ack"])
    state.denied = [...new Set([...(state.denied ?? []), ...last.targets.map(keyOf)])]
    done.push(`decision ${last.id} ${status}: its ${last.targets.length} kept`)
  }
  state.decision = undefined
  return false
}

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
    const decide: Target[] = []
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
    const open = await settleLast(ctx, state, main, said).catch((err: Error) => {
      said.push(`last decision: failed: ${err.message}`)
      return false
    })
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
      const n = /^(?:review|test)-(\d+)$/.exec(basename(w.path))?.[1]
      return n ? [Number(n)] : []
    })
    const names = [...new Set([...(await local()), ...remote].map((r) => r.name))]
    const prs = await deps.prs(ctx, names, numbers)
    await step("worktrees", async () => {
      if (!cleanup) return "no main checkout found, none read"
      if (!prs) return "GitHub unreadable, none read"
      const out: string[] = []
      for (const w of staleWorktrees(worktrees, prs)) {
        const line = await cleanWorktree(w.path, "nightly-clean", cleanup, {
          pushed: w.pr.headRefOid,
        })
        out.push(line)
        if (discardable(line)) decide.push({ kind: "worktree", name: w.path })
      }
      return out.length ? out.join("; ") : "none stale"
    })
    await step("branches", async () => {
      if (!prs) return "GitHub unreadable, none read"
      const listed = (await git(["worktree", "list", "--porcelain"])).out
      const checkedOut = [...listed.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]!)
      const merged = await git(["branch", "--merged", "origin/canary", "--format=%(refname:short)"])
      const plan = staleBranches({
        checkedOut: new Set(checkedOut),
        keep: new Set(["canary", "main", cleanup?.liveBranch ?? ""]),
        local: await local(),
        merged: new Set(merged.code === 0 ? lines(merged.out) : []),
        prs: prs.byBranch,
        remote,
      })
      let locals = 0
      for (const name of plan.local) if ((await git(["branch", "-D", name])).code === 0) locals++
      let remotes = 0
      for (const name of plan.remote)
        if ((await git(["push", "-q", "origin", "--delete", name])).code === 0) remotes++
      for (const name of plan.decide) decide.push({ kind: "branch", name })
      return `deleted ${locals} local, ${remotes} remote; ${plan.decide.length} to decide`
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
      let removed = 0
      for (const name of plan.remove)
        if ((await ctx.run(["docker", "rm", "-fv", name])).code === 0) removed++
      for (const name of plan.decide) decide.push({ kind: "container", name })
      const df = await ctx.run(["docker", "system", "df", "-v", "--format", "{{json .}}"])
      for (const name of staleVolumes(df.out)) decide.push({ kind: "volume", name })
      const slot = (argv: string[]) =>
        ctx.run([join(ctx.ops, "run-slot.sh"), "ops-tick", "--", ...argv], 30 * 60_000)
      const images = await slot(["docker", "image", "prune", "-f"])
      const cache = await slot(["docker", "builder", "prune", "-f"])
      return `removed ${removed} containers; image prune ${images.code === 0 ? "ran" : "failed"}, build cache prune ${cache.code === 0 ? "ran" : "failed"}`
    })
    await step("turbo", () => pruneTurbo(deps.turbo, ctx.now))
    const purged = trashSince(
      await Bun.file(join(ctx.ops, "log", "trash-purge.log"))
        .text()
        .catch(() => ""),
      Date.parse(state.at ?? "") || ctx.now.getTime() - 86_400_000,
    )
    said.push(`trash: ${purged} batches purged since the last run`)
    const after = deps.free(data)
    const roster = await Bun.file(join(data, "roster.json"))
      .json()
      .catch(() => null)
    const from = managerOf((roster as { agents?: unknown } | null)?.agents, "ops")
    const asked = decide.filter((t) => !(state.denied ?? []).includes(keyOf(t)))
    if (asked.length) {
      const { item, targets } = decisionOf(from, asked)
      const posted = await ask(ctx, ["new"], JSON.stringify(item))
      const id = idOf(posted.out)
      if (id) {
        if (open && state.decision)
          await ask(ctx, [
            "settle",
            state.decision.id,
            "--note",
            `Carried into the next night's decision, ${id}`,
          ])
        state.decision = { id, targets }
        said.push(`decision ${id}: ${targets.length} targets`)
      } else said.push(`decision: not posted: ${lines(posted.out).at(-1) ?? ""}`)
    } else if (open && state.decision) {
      await ask(ctx, ["settle", state.decision.id, "--note", "Its targets are gone"])
      state.decision = undefined
    }
    if (after - before >= GB)
      await ask(
        ctx,
        ["new"],
        JSON.stringify({
          from,
          kind: "update",
          preview: { outcome: "finding" },
          title: `The nightly cleanup freed ${gbOf(after - before)} GB: free disk ${gbOf(before)} GB, now ${gbOf(after)} GB`,
        }),
      )
    state.at = ctx.now.toISOString()
    await mkdir(join(ctx.ops, "tick"), { recursive: true })
    await writeAtomic(statePath, JSON.stringify(state))
    await mkdir(join(ctx.ops, "log"), { recursive: true })
    await appendFile(
      join(ctx.ops, "log", "nightly-clean.log"),
      `${ctx.now.toISOString().replace(/\.\d{3}Z$/, "Z")} free ${gbOf(before)} GB, now ${gbOf(after)} GB; ${said.join("; ")}\n`,
    )
  }

// Pure: one gh api graphql answer read into prs, its b<i> aliases by branch and n<i> by number, a null alias (a number that is no PR) skipped; false when it holds no repository. Its stdout's one JSON line alone, since that answer exits 1 with its data and errors there and a "gh: ..." line on stderr, which ctx.run joins after it.
export const readPrs = (out: string, branches: string[], numbers: number[], prs: Prs): boolean => {
  let found: Record<string, unknown> | undefined
  try {
    found = (
      JSON.parse(out.split("\n")[0] ?? "") as { data?: { repository?: Record<string, unknown> } }
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

// This machine's: auto_end's cleanup deps, statfs, GitHub's PRs in batched GraphQL reads through gh, and the shared turbo cache.
const liveNight: NightDeps = {
  cleanup: cleanupDeps,
  free: (dir) => {
    const fs = statfsSync(dir)
    return fs.bavail * fs.bsize
  },
  prs: async (ctx, branches, numbers) => {
    const url = (await ctx.run(["git", "-C", ctx.repo, "remote", "get-url", "origin"])).out.trim()
    const repo = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url)
    if (!repo) return null
    const q = JSON.stringify
    const fields = "state headRefOid"
    const parts = [
      ...branches.map(
        (b, i) =>
          `b${i}: pullRequests(headRefName: ${q(b)}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}, states: [OPEN, MERGED, CLOSED]) { nodes { ${fields} } }`,
      ),
      ...numbers.map((n, i) => `n${i}: pullRequest(number: ${n}) { ${fields} }`),
    ]
    const prs: Prs = { byBranch: new Map(), byNumber: new Map() }
    for (let i = 0; i < parts.length; i += 100) {
      const query = `query { repository(owner: ${q(repo[1])}, name: ${q(repo[2])}) { ${parts.slice(i, i + 100).join(" ")} } }`
      const read = await ctx.run(["gh", "api", "graphql", "-f", `query=${query}`], 120_000)
      if (!readPrs(read.out, branches, numbers, prs)) return null
    }
    return prs
  },
  turbo: TURBO_CACHE,
}
