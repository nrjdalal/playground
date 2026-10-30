import { parseArgs } from "node:util"

import { z } from "zod"

import type { GitHub } from "@/plugins/changelog/github"
import {
  commitDetail,
  entryFromRelease,
  HAND_KINDS,
  imageRefs,
  mergeEntries,
  oneLine,
  pullKey,
  releaseKey,
  ruleEntries,
  staleKeys,
  type NewEntry,
  type Pull,
  type Seed,
} from "@/plugins/changelog/sources"
import type { ChangelogImage } from "@/plugins/changelog/types"

// bun run changelog's commands, apart from the process: each turns its arguments into rows and hands them to `write` with the actor it names, so a test drives every command with a fake GitHub and a fake database.

export const USAGE = `usage: bun run changelog sync     adds every merge into canary and every version on main it lacks; ops runs it every 5 minutes
       bun run changelog seed     sync, plus the rules of 6 Oct and the drafted lines; safe to run again
       bun run changelog seed --refresh-detail   the seed, rewriting every merge's line and detail by today's rule and removing the merges it no longer keeps
       bun run changelog add --kind ops|rule|setting --text "<one line>" [--link <url>] [--actor <name>]
       bun run changelog fixture  made-up rows and screenshots for a test stack; refused on a stack that reads this machine`

// refreshDetail rewrites a row's line and detail with the ones given, a detail of none included, rather than keeping its own.
export type Write = (
  entries: NewEntry[],
  actor: string,
  options?: { refreshDetail?: boolean },
) => Promise<{ added: NewEntry[]; skipped: NewEntry[]; updated: number }>

export type Deps = {
  // Removes the rows of these source keys, returning how many went.
  drop: (keys: string[]) => Promise<number>
  github: GitHub
  known: (keys: string[]) => Promise<Set<string>>
  // Every merge's source key the changelog holds.
  pullKeys: () => Promise<string[]>
  seed: Seed
  // Keeps one screenshot's bytes in the changelog folder, returning its id, or null when they are not an image.
  store: (bytes: Uint8Array) => Promise<string | null>
  // Which of these source keys hold a row with screenshots already.
  withImages: (keys: string[]) => Promise<Set<string>>
  write: Write
}

export class UsageError extends Error {}

// Sync runs every 5 minutes, so the newest 100 merges cover any gap a stopped loop leaves; the seed reads back to its floor.
const SYNC_PULLS = 100
const SEED_PULLS = 1000

const actorOption = { actor: { type: "string" } } as const

const handSchema = z.strictObject({
  kind: z.enum(HAND_KINDS),
  link: z.url({ protocol: /^https?$/ }).optional(),
  text: oneLine,
})

const actorOf = (actor: string | undefined, fallback: string): string => {
  if (actor !== undefined && !actor.trim()) throw new UsageError("--actor needs a name")
  return actor?.trim() ?? fallback
}

// What one run wrote, as the lines the CLI prints: each row added, then how many were there already.
export function report({ added, skipped }: Awaited<ReturnType<Write>>): string[] {
  const lines = added.map((entry) => `added ${entry.kind}: ${entry.text}`)
  if (skipped.length)
    lines.push(`already there: ${skipped.length} (${skipped.map((e) => e.sourceKey).join(", ")})`)
  if (!added.length && !skipped.length) lines.push("nothing to add")
  return lines
}

// One PR's before and after screenshots, copied into the changelog folder; an image that will not download or is not an image is left out and named in `problems`, so one bad link never stops the run.
async function copyImages(deps: Deps, pull: Pull, problems: string[]): Promise<ChangelogImage[]> {
  let comments: string[]
  try {
    comments = await deps.github.comments(pull)
  } catch (err) {
    problems.push(
      `#${pull.number}: comments not read (${err instanceof Error ? err.message : err})`,
    )
    return []
  }
  const images: ChangelogImage[] = []
  for (const ref of imageRefs(pull.body, comments)) {
    try {
      const id = await deps.store(await deps.github.download(ref.url))
      if (id) images.push({ alt: ref.alt, id })
      else problems.push(`#${pull.number}: ${ref.url} is not a PNG, JPEG, GIF or WebP`)
    } catch (err) {
      problems.push(
        `#${pull.number}: ${ref.url} not copied (${err instanceof Error ? err.message : err})`,
      )
    }
  }
  return images
}

// Every merge into canary from the seed's floor on, and each version on main the changelog lacks (only those are read in full, so a run every 5 minutes costs two GitHub calls when nothing is new). A merge new to the changelog has its screenshots copied; the seed also copies them for a merge already there without any, which backfills the rows synced before images were kept. A merge whose body gives no detail takes its squash commit's, read for a merge new to the changelog, or for every merge on a refresh.
async function syncEntries(
  deps: Deps,
  limit: number,
  backfill: boolean,
  refresh: boolean,
  problems: string[],
): Promise<{ entries: NewEntry[]; pulls: Pull[]; unread: Set<string> }> {
  const [pulls, tags] = await Promise.all([deps.github.merged(limit), deps.github.releaseTags()])
  const known = await deps.known(tags.map(releaseKey))
  const releases = await Promise.all(
    tags.filter((tag) => !known.has(releaseKey(tag))).map((tag) => deps.github.release(tag)),
  )
  const merges = mergeEntries(deps.seed, pulls)
  const keys = merges.flatMap((entry) => (entry.sourceKey ? [entry.sourceKey] : []))
  const there = await deps.known(keys)
  const unread = new Set<string>()
  const done = backfill ? await deps.withImages(keys) : there
  for (const entry of merges) {
    if (!entry.sourceKey) continue
    const pull = pulls.find((p) => pullKey(p) === entry.sourceKey)
    if (!pull) continue
    if (!entry.detail && pull.mergeCommit && (refresh || !there.has(entry.sourceKey))) {
      try {
        entry.detail = commitDetail(await deps.github.commitMessage(pull))
      } catch (err) {
        unread.add(entry.sourceKey)
        problems.push(
          `#${pull.number}: merge commit not read (${err instanceof Error ? err.message : err})`,
        )
      }
    }
    if (!done.has(entry.sourceKey)) entry.images = await copyImages(deps, pull, problems)
  }
  return { entries: [...merges, ...releases.map(entryFromRelease)], pulls, unread }
}

export async function runCommand(argv: string[], deps: Deps): Promise<string[]> {
  const [command, ...rest] = argv
  if (command === "add") {
    const { positionals, values } = parseArgs({
      args: rest,
      options: {
        ...actorOption,
        kind: { type: "string" },
        link: { type: "string" },
        text: { type: "string" },
      },
    })
    if (positionals.length)
      throw new UsageError(`add takes no bare words: ${positionals.join(" ")}`)
    const parsed = handSchema.safeParse({
      kind: values.kind,
      link: values.link,
      text: values.text,
    })
    if (!parsed.success) {
      throw new UsageError(
        parsed.error.issues.map((i) => `--${i.path.join(".")}: ${i.message}`).join("; "),
      )
    }
    const entry: NewEntry = {
      ...parsed.data,
      at: new Date(),
      link: parsed.data.link ?? null,
      sourceKey: null,
    }
    return report(await deps.write([entry], actorOf(values.actor, "cli")))
  }
  const refresh = command === "seed" && rest.length === 1 && rest[0] === "--refresh-detail"
  if ((command === "sync" || command === "seed") && (rest.length === 0 || refresh)) {
    const problems: string[] = []
    const seed = command === "seed"
    const { entries, pulls, unread } = await syncEntries(
      deps,
      seed ? SEED_PULLS : SYNC_PULLS,
      seed,
      refresh,
      problems,
    )
    if (seed) entries.push(...ruleEntries(deps.seed))
    const actor = seed ? "seed" : "ops-dashboard"
    // a refresh leaves the line and detail of a merge whose commit it could not read, rather than rewriting them
    const held = entries.filter(
      (entry) => refresh && entry.sourceKey && unread.has(entry.sourceKey),
    )
    const result = await deps.write(
      entries.filter((entry) => !held.includes(entry)),
      actor,
      { refreshDetail: refresh },
    )
    if (held.length) {
      const heldResult = await deps.write(held, actor)
      result.added.push(...heldResult.added)
      result.skipped.push(...heldResult.skipped)
    }
    const copied = entries.reduce((sum, entry) => sum + (entry.images?.length ?? 0), 0)
    // A refresh also removes the merges the sync no longer keeps (the publish step's bookkeeping), within the numbers it read, since every merge's row is rebuilt from its PR.
    const kept = new Set(entries.flatMap((entry) => (entry.sourceKey ? [entry.sourceKey] : [])))
    const removed = refresh ? await deps.drop(staleKeys(await deps.pullKeys(), pulls, kept)) : 0
    return [
      `${command}: added ${result.added.length}, already there ${result.skipped.length}${result.updated ? `, updated ${result.updated}` : ""}${removed ? `, removed ${removed}` : ""}${copied ? `, screenshots copied ${copied}` : ""}`,
      ...problems.map((problem) => `problem: ${problem}`),
    ]
  }
  throw new UsageError(USAGE)
}
