import { existsSync } from "node:fs"
import { mkdir, unlink } from "node:fs/promises"
import { join } from "node:path"

import { opsDir, REPO, scheduled } from "../ops-job/job"
import { preToolUseGuards } from "../ops-tick/guard-probe"
import type { Beat, Context } from "../ops-tick/tick"
import { writeAtomic } from "../write-atomic"

// ops-restore: puts a lost main checkout back by the playbook's restore steps (LIFECYCLE.md, Restoring the main checkout), from the Dashboard's checkout, which a wiped main checkout leaves standing, and with no hook, since every guard runs from the main checkout and fails closed once it is gone.

// Two looks this far apart, each finding a guard gone, before it acts: a pull or an install can leave a bundle missing for a moment.
export const SECOND_LOOK_MS = 290_000

// A look this long after the one before it starts the count again, since the job was off or the Mac asleep between them: two beats of the 5-minute cron.
export const IN_A_ROW_MS = 600_000

// A run that holds the main checkout for its upkeep (the ship's step 5, `playground update`, run in a run slot, the links it runs, and any install, since a holder's command names no folder), read from each run slot's holder pid.
const UPKEEP = /playground update|playground\/update\.ts|link-skills\.sh|bun install/

type State = { failed?: string; last: string; missing: string[]; since: string }

// The file a healthy look keeps origin's URL in, since a lost .git takes the URL with it, and the Dashboard's checkout, a worktree of the main checkout, reads its git through that .git too.
export const originPath = (ops: string): string => join(ops, "restore", "origin.txt")

// The registered guards whose bundle and source are both gone from the main checkout.
export const missingGuards = (main: string, guards: string[]): string[] =>
  guards.filter(
    (name) =>
      !existsSync(join(main, "scripts", "hooks", "bundled", `${name}.js`)) &&
      !existsSync(join(main, "scripts", "hooks", `${name}.ts`)),
  )

// Whether a run slot's holder runs the main checkout's upkeep: each `<slot>.holder` names its holder's pid second, and ps reads that pid's command.
export const upkeepHeld = async (ctx: Context): Promise<boolean> => {
  const holders = [...new Bun.Glob("run-slot*.holder").scanSync({ cwd: ctx.ops, dot: true })]
  for (const holder of holders) {
    const pid = (
      await Bun.file(join(ctx.ops, holder))
        .text()
        .catch(() => "")
    ).split(/\s+/)[1]
    if (!pid || !/^\d+$/.test(pid)) continue
    const { out } = await ctx.run(["ps", "-o", "command=", "-p", pid], 10_000)
    if (UPKEEP.test(out)) return true
  }
  return false
}

export type Restore = {
  guards: string[] | (() => Promise<string[]>)
  main: string
  upkeep?: (ctx: Context) => Promise<boolean>
}

// One look: a guard gone on two looks in a row, with no upkeep holding the main checkout, runs the restore once, records what the checkout held before it, and tells ops and the dispatcher what it did; a failed step is told once and not tried again until the guards are back.
export const restoreBeat =
  ({ guards, main, upkeep = upkeepHeld }: Restore) =>
  async (ctx: Context) => {
    const dir = join(ctx.ops, "restore")
    const statePath = join(dir, "state.json")
    const registered = typeof guards === "function" ? await guards() : guards
    const missing = missingGuards(main, registered)
    const state = (await Bun.file(statePath)
      .json()
      .catch(() => null)) as State | null
    const now = ctx.now.toISOString()
    if (!missing.length) {
      if (state) await unlink(statePath)
      const url = await ctx.run(["git", "-C", main, "remote", "get-url", "origin"], 30_000)
      const kept = await Bun.file(originPath(ctx.ops))
        .text()
        .catch(() => "")
      if (url.code === 0 && url.out.trim() && kept.trim() !== url.out.trim()) {
        await mkdir(dir, { recursive: true })
        await writeAtomic(originPath(ctx.ops), `${url.out.trim()}\n`)
      }
      return
    }
    await mkdir(dir, { recursive: true })
    const fresh = !state || ctx.now.getTime() - Date.parse(state.last ?? state.since) > IN_A_ROW_MS
    if (fresh) {
      const failed = state?.failed ? { failed: state.failed } : {}
      await writeAtomic(statePath, JSON.stringify({ ...failed, last: now, missing, since: now }))
      return
    }
    await writeAtomic(statePath, JSON.stringify({ ...state, last: now }))
    if (state.failed) return
    const apart = ctx.now.getTime() - Date.parse(state.since)
    if (apart < SECOND_LOOK_MS) return
    if (await upkeep(ctx)) return
    const tell = async (text: string) => {
      for (const to of ["ops", "dispatcher"]) await ctx.send(to, text).catch(() => false)
    }
    let statusFile = ""
    const fail = async (step: string, out: string) => {
      const why = out.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 160) ?? ""
      await writeAtomic(statePath, JSON.stringify({ ...state, failed: step, last: now }))
      await tell(
        `ops-restore: ${missing.length} guards were gone from ${main}, and its restore stopped at ${step}${why ? `: ${why}` : ""}.${statusFile ? ` Its git status before it began is in ${statusFile}.` : ""} It tries again once the guards are back; restore the rest by LIFECYCLE.md's steps, or, with the guards still gone, by its true-block route there.`,
      )
    }
    const git = (...args: string[]) => ctx.run(["git", "-C", main, ...args], 300_000)
    let held =
      "had no .git and was restored in place; every worktree of it, the Dashboard's included, needs `git worktree repair` from that worktree"
    if (existsSync(join(main, ".git"))) {
      // what the checkout held before the checkout throws it away, kept whole in a file and named in the report, since the main checkout stays clean and anything but the loss is news
      const lines = (await git("status", "--porcelain")).out.split("\n").filter(Boolean)
      const other = lines.filter((line) => !line.startsWith(" D "))
      statusFile = join(dir, `status-${now}.txt`)
      await writeAtomic(statusFile, `${lines.join("\n")}\n`)
      held = `had ${lines.length - other.length} files deleted and ${other.length ? `also held ${other.slice(0, 5).join("; ")}${other.length > 5 ? ` and ${other.length - 5} more` : ""}` : "nothing else"} (git status in ${statusFile})`
      const back = await git("checkout", "--", ".")
      if (back.code !== 0) return fail("git checkout -- .", back.out)
    } else {
      const url = (
        await Bun.file(originPath(ctx.ops))
          .text()
          .catch(() => "")
      ).trim()
      if (!url) return fail("reading origin's URL", `none kept in ${originPath(ctx.ops)}`)
      for (const args of [
        ["init"],
        ["remote", "add", "origin", url],
        ["fetch", "origin"],
        ["checkout", "-f", "-B", "main", "origin/main"],
      ]) {
        const step = await git(...args)
        if (step.code !== 0) return fail(`git ${args.join(" ")}`, step.out)
      }
    }
    const runSlot = join(ctx.repo, "scripts", "ops", "run-slot.sh")
    const install = await ctx.run(
      ["bash", runSlot, "ops-restore", "--", "bun", "install", "--cwd", main],
      1_800_000,
    )
    if (install.code !== 0) return fail("bun install", install.out)
    const link = await ctx.run(["bash", join(main, "scripts", "link-skills.sh")], 600_000)
    if (link.code !== 0) return fail("link-skills.sh", link.out)
    const left = missingGuards(main, registered)
    if (left.length) return fail("the check after it", `still gone: ${left.join(", ")}`)
    await unlink(statePath)
    await tell(
      `ops-restore: ${missing.length} guards were gone from ${main} on two looks ${Math.round(apart / 60_000)} minutes apart; it restored the checkout by LIFECYCLE.md's steps, installed and ran link-skills.sh, and every guard starts again. The checkout ${held}.`,
    )
  }

// The main checkout the job restores, named by --main, since the job runs from the Dashboard's checkout.
const mainOf = (argv: string[]): string => {
  const at = argv.indexOf("--main")
  const main = at === -1 ? undefined : argv[at + 1]
  if (!main) {
    console.error("ops-restore: --main <main checkout> names the checkout it restores")
    process.exit(2)
  }
  return main
}

// The guards read at each beat, from the settings the main checkout's own wrappers run while it holds them, else the Dashboard's, so a registration change needs no restart.
const guardsOf = (main: string) => async () =>
  preToolUseGuards(existsSync(join(main, "scripts", "factory-settings.json")) ? main : REPO)

if (import.meta.main) {
  const main = mainOf(process.argv)
  const beats: Beat[] = [
    {
      cron: "*/5 * * * *",
      name: "restore",
      run: restoreBeat({ guards: guardsOf(main), main }),
      to: "ops and the dispatcher, once a restore runs or stops",
    },
  ]
  scheduled("ops-restore", beats, opsDir())
}
