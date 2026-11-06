import { appendFile, mkdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { managerOf } from "@packages/config/kinds"
import { orgOf } from "@packages/config/org"
import { dataDir } from "@packages/env/data-dir"
import { readPolicy, ruleSettings, type Settings, ticketCardSettings } from "@packages/settings"

import { scheduled } from "../ops-job/job"
import type { Beat, Context } from "../ops-tick/tick"
import { writeAtomic } from "../write-atomic"
import { cardOf, dayOf, inWindow, type Line, type Pr, type Seen, stepLinesOf } from "./card"

// ops-ticket-card: once a minute inside its window, the day's watched tickets read from the lines file into one Inbox card, edited only when its text changes, with each step first seen appended to the day's steps file; every input is a setting (ticketCard.*), and GitHub is read at most once every 5 minutes a ticket.

const GITHUB_MS = 5 * 60_000

// The job's own memory: the day's card (its id and poster, and the text last written), each listed ticket's step first-seen times, kept across days, and each ticket's last GitHub read.
export type State = {
  card?: { day: string; from: string; id: string; text: string }
  prs: Record<string, { at: number; pr?: Pr }>
  seen: Seen
}

const read = async (path: string): Promise<any> =>
  path
    ? Bun.file(path)
        .json()
        .catch(() => undefined)
    : undefined

const pathIn = (data: string, path: string) => (!path || isAbsolute(path) ? path : join(data, path))

export const statePath = (ops: string) => join(ops, "ops-ticket-card.state.json")

// The lines file's lines, each read into the card's Line, kept to the tickets its `clock` record names (the ones the watched channels' digest registered, so a line a mention elsewhere raised stays off) and to the prefixes the settings name (none, every prefix); a file with no `clock` record shows none.
export const linesIn = (file: any, prefixes: string[]): Line[] =>
  Object.values((file?.lines ?? {}) as Record<string, any>)
    .filter(
      (l) =>
        typeof l?.id === "string" &&
        Object.hasOwn(file?.clock ?? {}, l.id) &&
        (!prefixes.length || prefixes.includes(l.id.split("-")[0])),
    )
    .map((l) => ({
      id: l.id,
      mine: l.mine === true,
      open: l.open !== false,
      shownAt: Number(l.shownAt) || 0,
      ...(typeof l.state === "string" ? { state: l.state } : {}),
      ...(l.theirs ? { theirs: true } : {}),
      ...(typeof l.urgency === "string" ? { urgency: l.urgency } : {}),
    }))

// A sent record's skips: each <kind>-skip:<ticket>:<area> key, the ticket's area.
export const skipsIn = (record: any): Record<string, string> =>
  Object.fromEntries(
    Object.keys(record ?? {}).flatMap((key) => {
      const [kind, ticket, area] = key.split(":")
      return kind?.endsWith("-skip") && ticket && area ? [[ticket, area]] : []
    }),
  )

// A ticket's newest pull request in the org whose title or body names its id, as GitHub's search answers it, with its draft, checks, approvals and merge read from the PR itself.
export const prOf = async (
  ctx: Pick<Context, "run">,
  org: string,
  id: string,
): Promise<Pr | undefined> => {
  const found = await ctx.run(
    [
      "gh",
      "search",
      "prs",
      "--owner",
      org,
      `"${id}"`,
      "--json",
      "body,title,updatedAt,url",
      "--limit",
      "20",
    ],
    60_000,
  )
  if (found.code !== 0) throw new Error(`gh search prs: ${found.out.trim().split("\n").at(-1)}`)
  const named = new RegExp(`(^|[^A-Za-z0-9-])${id}([^0-9]|$)`, "i")
  const hits = (
    JSON.parse(found.out || "[]") as {
      body?: string
      title?: string
      updatedAt: string
      url: string
    }[]
  )
    .filter((h) => named.test(h.title ?? "") || named.test(h.body ?? ""))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (!hits[0]) return undefined
  const viewed = await ctx.run(
    ["gh", "pr", "view", hits[0].url, "--json", "isDraft,mergedAt,reviews,statusCheckRollup,url"],
    60_000,
  )
  if (viewed.code !== 0) throw new Error(`gh pr view: ${viewed.out.trim().split("\n").at(-1)}`)
  const pr = JSON.parse(viewed.out) as {
    isDraft: boolean
    mergedAt: string | null
    reviews?: { author?: { login?: string }; state: string }[]
    statusCheckRollup?: { conclusion?: string; state?: string; status?: string }[]
    url: string
  }
  // each reviewer's newest review counts, so an approval a later change request replaced is no approval
  const last = new Map<string, string>()
  for (const r of pr.reviews ?? [])
    if (r.author?.login && r.state !== "COMMENTED") last.set(r.author.login, r.state)
  const results = (pr.statusCheckRollup ?? []).map((c) =>
    (c.conclusion || c.state || c.status || "").toUpperCase(),
  )
  const checks: Pr["checks"] = !results.length
    ? "none"
    : results.some((r) =>
          ["ACTION_REQUIRED", "CANCELLED", "ERROR", "FAILURE", "TIMED_OUT"].includes(r),
        )
      ? "red"
      : results.every((r) => ["NEUTRAL", "SKIPPED", "SUCCESS"].includes(r))
        ? "green"
        : "pending"
  return {
    approvals: [...last.values()].filter((s) => s === "APPROVED").length,
    checks,
    draft: pr.isDraft,
    merged: !!pr.mergedAt,
    url: pr.url,
  }
}

// One bun run ask call with the item on stdin: the item's id on a post, null when the card is closed to edits
const ask = async (
  ctx: Pick<Context, "repo" | "run">,
  verb: string[],
  item: object,
): Promise<string | null> => {
  const r = await ctx.run(
    ["bun", "run", "--silent", "--cwd", ctx.repo, "ask", ...verb],
    120_000,
    JSON.stringify(item),
  )
  if (r.code === 0)
    return (
      r.out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /^[0-9a-f-]{36}$/.test(l)) ?? ""
    )
  if (verb[0] === "edit" && /closed|no inbox item/i.test(r.out)) return null
  throw new Error(`bun run ask ${verb[0]}: ${r.out.trim().split("\n").at(-1)}`)
}

export type Io = { data: string; org?: string; settings: Settings }

// One beat: nothing outside the window, with no lines file set or with one it cannot read; else the card's text from the files and GitHub, written only when it changed, a closed card or a new day getting a new card, and each new step appended to the day's steps file; each ticket's read counts toward its 5 minutes even when it fails, keeping its last PR, and the reads and steps are saved before the card is written, so a failing read or ask repeats neither; a failed read throws once the beat has saved.
export const beat = async (
  ctx: Pick<Context, "now" | "ops" | "repo" | "run">,
  io: Io,
): Promise<void> => {
  const get = <K extends Parameters<typeof ticketCardSettings.get>[1]>(key: K) =>
    ticketCardSettings.get(io.settings, key)
  const linesFile = pathIn(io.data, get("ticketCard.linesFile"))
  const now = ctx.now.getTime()
  if (!linesFile || !inWindow(get("ticketCard.window"), now)) return
  const zone = ruleSettings.get(io.settings, "clock.ownerZone")
  const day = dayOf(now, zone)
  const path = statePath(ctx.ops)
  const state: State = (await read(path)) ?? { prs: {}, seen: {} }
  const file = await read(linesFile)
  if (!file || typeof file !== "object") return
  const lines = linesIn(file, get("ticketCard.prefixes"))
  const skips = skipsIn(await read(pathIn(io.data, get("ticketCard.skipsFile"))))
  const failed: string[] = []
  for (const line of lines) {
    const had = state.prs[line.id]
    const settled = had?.pr?.merged && !line.open
    if (!io.org || line.theirs || skips[line.id] || settled || (had && now - had.at < GITHUB_MS))
      continue
    const pr = await prOf(ctx, io.org, line.id).catch((e: Error) => {
      failed.push(`${line.id}: ${e.message}`)
      return had?.pr
    })
    state.prs[line.id] = { at: now, pr }
  }
  // a step goes in the steps file on the day it is first seen alone, so first-seen times carry across days, kept to the tickets the lines file still lists
  const listed = new Set(lines.map((line) => line.id))
  const before: Seen = Object.fromEntries(
    Object.entries(state.seen).filter(([id]) => listed.has(id)),
  )
  const { seen, text } = cardOf(
    {
      approvals: get("ticketCard.approvals"),
      deployedStates: get("ticketCard.deployedStates"),
      lines,
      linkBase: get("ticketCard.linkBase"),
      prs: Object.fromEntries(Object.entries(state.prs).map(([id, p]) => [id, p.pr])),
      reopened: (await read(pathIn(io.data, get("ticketCard.reopenedFile"))))?.reopened ?? {},
      skips,
      verdicts: (await read(pathIn(io.data, get("ticketCard.verdictsFile")))) ?? {},
      window: get("ticketCard.window"),
      zone,
    },
    before,
    now,
  )
  const save = (card: State["card"]) =>
    writeAtomic(path, JSON.stringify({ card, prs: state.prs, seen } satisfies State))
  await save(state.card)
  const steps = stepLinesOf(before, seen, zone)
  if (steps.length) {
    const dir = pathIn(io.data, get("ticketCard.diaryDir"))
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, `${day}-steps.md`), `${steps.join("\n")}\n`)
  }
  const title = get("ticketCard.title")
  let card = state.card?.day === day ? state.card : undefined
  if (card?.text !== text) {
    const edited = card
      ? await ask(ctx, ["edit", card.id], {
          from: card.from,
          kind: "update",
          preview: { outcome: "finding", text },
          title,
        })
      : null
    if (edited === null) {
      const roster = await read(join(ctx.ops, "..", "roster.json"))
      const from = managerOf(roster?.agents, "ops")
      const id = await ask(ctx, ["new"], {
        from,
        kind: "update",
        preview: { outcome: "finding", text },
        title,
      })
      if (!id) throw new Error("bun run ask new printed no id")
      card = { day, from, id, text }
    } else card = { ...card!, text }
  }
  await save(card)
  if (failed.length) throw new Error(`gh read failed for ${failed.join("; ")}`)
}

export const BEATS: Beat[] = [
  {
    cron: "* * * * *",
    name: "ticket-card",
    run: async (ctx) => {
      const data = dataDir()
      const policy = await readPolicy(data)
      if (policy.refusal !== undefined) throw new Error(`the settings refuse: ${policy.refusal}`)
      await beat(ctx, { data, org: orgOf(process.env).work.org, settings: policy.settings })
    },
    to: "none: it edits its one Inbox card",
  },
]

if (import.meta.main) scheduled("ops-ticket-card", BEATS)
