// The ticket progress card, pure: the day's watched tickets in, the card's text and each step's first-seen time out, with nothing read or written here (cli.ts does the reading and writing).

// A ticket's line as the lines file holds it: whose it is, whether it is still open, when it first showed, and its urgency.
export type Line = {
  id: string
  // the owner's ticket: assigned to the owner
  mine: boolean
  open: boolean
  // when the line first showed, epoch ms
  shownAt: number
  // someone else's ticket, which the card names as a colleague's and follows no further
  theirs?: boolean
  urgency?: string
}

// A ticket's pull request as GitHub reads it: draft or ready, its checks' rollup, its approvals at its head, merged or not.
export type Pr = {
  approvals: number
  checks: "green" | "none" | "pending" | "red"
  draft: boolean
  merged: boolean
  url: string
}

export type Inputs = {
  approvals: number
  lines: Line[]
  // the base a ticket's id is appended to for its link, "" for none
  linkBase: string
  prs: Record<string, Pr | undefined>
  // each reopened ticket, by id, when it was seen reopened
  reopened: Record<string, string>
  // each skipped ticket's area, by id
  skips: Record<string, string>
  verdicts: Record<string, { at: string; kind: string }>
  window: Window
  zone: string
}

export type Window = { days: number[]; end: string; start: string }

// When the job first saw each ticket's step done, by ticket then step, so a time stays put across beats.
export type Seen = Record<string, Record<string, string>>

export const STEPS = [
  "taken",
  "cause found",
  "PR open",
  "CI green",
  "approvals",
  "merged",
  "done",
] as const
export type Step = (typeof STEPS)[number]

// The queue's order: Urgent first, then High, Medium and Low, then a ticket with no urgency, each oldest first.
const RANK: Record<string, number> = { High: 1, Low: 3, Medium: 2, Urgent: 0 }

const at = (day: string, hhmm: string) =>
  Date.parse(`${day}T${hhmm === "24:00" ? "23:59:59.999" : `${hhmm}:00`}Z`)

// Today's window as two instants, or null on a day it skips.
export const windowOf = (window: Window, now: number): { end: number; start: number } | null => {
  const day = new Date(now).toISOString().slice(0, 10)
  if (!window.days.includes(new Date(now).getUTCDay())) return null
  return { end: at(day, window.end), start: at(day, window.start) }
}

export const inWindow = (window: Window, now: number): boolean => {
  const today = windowOf(window, now)
  return !!today && now >= today.start && now < today.end
}

// A UTC instant as a clock time in the owner's zone: "1:09 pm".
export const clockOf = (iso: string | number, zone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    timeZone: zone,
  })
    .format(new Date(iso))
    .toLowerCase()

// The owner's calendar day of an instant, YYYY-MM-DD in the owner's zone, which names the day's card and its steps file.
export const dayOf = (now: number, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: zone,
    year: "numeric",
  }).format(new Date(now))

// The lines the card shows, in the queue's order: every open line of the owner's or no one's, and every line that first showed today, a colleague's last.
export const linesOf = (lines: Line[], now: number, zone: string): Line[] => {
  const today = (line: Line) => dayOf(line.shownAt, zone) === dayOf(now, zone)
  const rank = (line: Line) => RANK[line.urgency ?? ""] ?? 4
  const ours = lines
    .filter((line) => !line.theirs && (line.open || today(line)))
    .sort((a, b) => rank(a) - rank(b) || a.shownAt - b.shownAt)
  return [...ours, ...lines.filter((line) => line.theirs && today(line))]
}

// Which of a ticket's steps are done now, with each step's own detail (a draft, red checks, approvals so far).
export const stepsOf = (
  line: Line,
  inputs: Inputs,
): { detail: Partial<Record<Step, string>>; done: Set<Step> } => {
  const pr = inputs.prs[line.id]
  const done = new Set<Step>()
  const detail: Partial<Record<Step, string>> = {}
  if (line.mine) done.add("taken")
  if (inputs.verdicts[line.id]) done.add("cause found")
  if (pr) {
    done.add("PR open")
    if (pr.draft) detail["PR open"] = "draft"
    if (pr.checks === "green") done.add("CI green")
    if (pr.checks === "red") detail["CI green"] = "red"
    detail.approvals = `${Math.min(pr.approvals, inputs.approvals)}/${inputs.approvals}`
    if (pr.approvals >= inputs.approvals) done.add("approvals")
    if (pr.merged) done.add("merged")
  }
  if (!line.open) done.add("done")
  return { detail, done }
}

const row = (mark: string, step: string, right: string) =>
  `${mark} ${step.padEnd(12)}${right}`.trimEnd()

// One ticket's block: its head, then each step's mark with its detail and the time it was first seen done; the step after the last one done is in flight.
const blockOf = (line: Line, inputs: Inputs, seen: Seen): string[] => {
  if (line.theirs) return [`${line.id} · a colleague's`]
  const skip = inputs.skips[line.id]
  if (skip) return [`${line.id} · skipped, ${skip}`]
  const { detail, done } = stepsOf(line, inputs)
  const last = STEPS.findLastIndex((step) => done.has(step))
  const flight = last >= 0 ? STEPS[last + 1] : undefined
  const reopened = inputs.reopened[line.id]
  return [
    `${line.id} · ${line.urgency ?? "no urgency"} · ${line.mine ? "yours" : "not taken"}`,
    ...(reopened ? [`↩️ reopened    ${clockOf(reopened, inputs.zone)}`] : []),
    ...STEPS.map((step) => {
      const time =
        done.has(step) && seen[line.id]?.[step]
          ? clockOf(seen[line.id]![step]!, inputs.zone)
          : undefined
      return row(
        done.has(step) ? "✅" : step === flight ? "⏳" : "⬜",
        step,
        [detail[step], time].filter(Boolean).join(", "),
      )
    }),
  ]
}

const fence = (rows: string[]) => ["```", ...rows, "```"].join("\n")

// The card's text and each step's first-seen time, this beat's new ones added; a step a ticket has lost (a merge undone) keeps its old time, unshown.
export const cardOf = (inputs: Inputs, seen: Seen, now: number): { seen: Seen; text: string } => {
  const iso = new Date(now).toISOString()
  const lines = linesOf(inputs.lines, now, inputs.zone)
  const next: Seen = structuredClone(seen)
  for (const line of lines)
    if (!line.theirs && !inputs.skips[line.id])
      for (const step of stepsOf(line, inputs).done)
        next[line.id] = { ...next[line.id], [step]: next[line.id]?.[step] ?? iso }
  const today = windowOf(inputs.window, now)
  const watch = [
    today
      ? `WATCH ${clockOf(today.start, inputs.zone)} → ${clockOf(today.end, inputs.zone)}`
      : "WATCH off today",
    `tickets today  ${lines.length}`,
  ]
  const links = lines
    .filter((line) => !line.theirs)
    .flatMap((line) => [
      ...(inputs.linkBase ? [`[${line.id}](${inputs.linkBase}${line.id})`] : []),
      ...(inputs.prs[line.id] ? [`[${line.id} PR](${inputs.prs[line.id]!.url})`] : []),
    ])
  const blocks = lines.length
    ? lines.map((line) => fence(blockOf(line, inputs, next)))
    : [fence(["no tickets yet today"])]
  const bullets = [
    "- 🕐 Updated {now}. I edit this card on every change.",
    ...(links.length ? [`- 🔗 ${links.join(", ")}`] : []),
  ]
  return { seen: next, text: [...blocks, fence(watch), bullets.join("\n")].join("\n\n") }
}

// The steps a beat saw done for the first time, one steps-file line each, in the owner's zone: "- 1:09 pm NG-1 taken".
export const stepLinesOf = (before: Seen, after: Seen, zone: string): string[] =>
  Object.entries(after).flatMap(([id, steps]) =>
    STEPS.filter((step) => steps[step] && !before[id]?.[step]).map(
      (step) => `- ${clockOf(steps[step]!, zone)} ${id} ${step}`,
    ),
  )
