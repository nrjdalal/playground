import type { InboxAction, InboxItem } from "@api/hono"
import { useQuery } from "@tanstack/react-query"

import { agentLabel } from "@/lib/agent-label"
import { apiClient, unwrap } from "@/lib/api/client"
import { isProbe } from "@/lib/dashboard"
import { needsYouAnchor } from "@/lib/needs-you"
import type { ShownState } from "@/lib/status-icons"
import { fullTime } from "@/lib/time"

export const INBOX_QUERY_KEY = ["inbox"] as const

// A new item shows in the Inbox and its tab's count within this long, without a reload.
export const INBOX_REFRESH_MS = 5_000

export async function fetchInbox() {
  const { data, error } = await unwrap(apiClient.v1.inbox.$get())
  if (error) throw new Error(error.message)
  return data
}

// seen is the updatedAt the card showed, so the API refuses an answer to words edited since.
export async function answerItem(
  { id, updatedAt }: Pick<InboxItem, "id" | "updatedAt">,
  action: InboxAction,
  text?: string,
  note?: string,
) {
  const { data, error } = await unwrap(
    apiClient.v1.inbox[":id"].answer.$post({
      json: { action, note, seen: updatedAt, text },
      param: { id },
    }),
  )
  if (error) throw new Error(error.message)
  return data
}

// A secret ask's value, posted once to its own route and kept nowhere here; seen as an answer's.
export async function provideSecret(
  { id, updatedAt }: Pick<InboxItem, "id" | "updatedAt">,
  value: string,
) {
  const { data, error } = await unwrap(
    apiClient.v1.inbox[":id"].secret.$post({ json: { seen: updatedAt, value }, param: { id } }),
  )
  if (error) throw new Error(error.message)
  return data
}

// The update named: one he clicked.
export async function markRead(ids: string[]) {
  const { data, error } = await unwrap(apiClient.v1.inbox.read.$post({ json: { ids } }))
  if (error) throw new Error(error.message)
  return data
}

export async function retryItem(id: string) {
  const { data, error } = await unwrap(apiClient.v1.inbox[":id"].retry.$post({ param: { id } }))
  if (error) throw new Error(error.message)
  return data
}

export async function dismissItems(ids: string[]) {
  const { data, error } = await unwrap(apiClient.v1.inbox.dismiss.$post({ json: { ids } }))
  if (error) throw new Error(error.message)
  return data
}

// Puts an open decision or draft away until a time, when it asks again; it leaves the list and the count until then.
export async function scheduleItem(id: string, at: string) {
  const { data, error } = await unwrap(
    apiClient.v1.inbox[":id"].schedule.$post({ json: { at }, param: { id } }),
  )
  if (error) throw new Error(error.message)
  return data
}

// The inbox every dashboard surface reads, one query so the Inbox tab's count and the list never disagree. DashboardProvider's observer polls (every dashboard page mounts it), and the tab's dot's polls in a hidden tab too (TAB_DOT_POLLING); the rest read its cache.
export function useInbox(
  enabled: boolean,
  { background = false, poll = false }: { background?: boolean; poll?: boolean } = {},
) {
  return useQuery({ enabled, ...inboxPolling({ background, poll }) })
}

// The inbox read's polling: every INBOX_REFRESH_MS when poll, and in a hidden tab too when background, which the tab's dot needs and a plain interval skips.
export const inboxPolling = ({ background, poll }: { background: boolean; poll: boolean }) => ({
  queryFn: fetchInbox,
  queryKey: INBOX_QUERY_KEY,
  refetchInterval: poll ? INBOX_REFRESH_MS : (false as const),
  refetchIntervalInBackground: background,
})

export const itemTag = (item: Pick<InboxItem, "ref">): string => `#i${item.ref}`

// Pure: when an item was dismissed or closed by its poster, on any answer that holds one; null on one that does not, a resolution included, which closed without a dismissal.
const answeredDismissedAt = (item: InboxItem): string | null => {
  const answer = item.answer
  return answer && "dismissedAt" in answer && answer.dismissedAt ? answer.dismissedAt : null
}

// Pure: an answer that did not reach its poster and that he has not dismissed, which offers Retry (11 answers failed unseen on 9 Oct).
export const sendFailed = (item: InboxItem): boolean =>
  item.kind !== "update" && item.delivery?.status === "failed" && !answeredDismissedAt(item)

// The failures Retry is offered after, the API's RETRY_CODES restated since the web imports its types alone (a test holds the two equal): nothing was typed, so a retry cannot type the answer twice.
export const RETRY_CODES = ["CMUX_FAILED", "INPUT_NOT_EMPTY", "NOT_FOUND", "ON_PICKER"] as const

// Pure: an answer that failed to send that Retry can safely follow; after any other failure it may be in the session already, so it offers Dismiss alone.
export const retryable = (item: InboxItem): boolean =>
  sendFailed(item) &&
  item.delivery?.status === "failed" &&
  (RETRY_CODES as readonly string[]).includes(item.delivery.code)

// The API's ACKS_STAMPED_FROM restated, since the web imports its types alone (a test holds the two equal): an answer delivered before then may have been acked with no stamp, so it reads as closed.
export const ACKS_STAMPED_FROM = "2026-10-12T08:05:50.000Z"

// Pure: a go, an answer to carry out (Approve, Edit, Send, Draft), which closes only with where it landed or why there is no link.
export const isGo = (choice: string): boolean => (GO_CHOICES as readonly string[]).includes(choice)

// The API's GO_CHOICES restated (a test holds the two equal).
export const GO_CHOICES = ["approve", "draft", "edit", "send"] as const

// Pure: whether an open draft offers Draft beside Send: a Slack draft, which Slack's MCP server saves as a draft, never a Linear comment, whose API creates none; the API's savesDraft decides the same (a test holds the two equal).
export const canDraft = (item: InboxItem): boolean =>
  item.kind === "draft" && item.status === "open" && kindWord(item) === "Slack draft"

// The item's answer once it holds a choice, his or a settle's; null before that, a Schedule put-away included, which holds only when to ask again. An update's answer, a resolution included, holds none.
const chosen = (item: InboxItem) =>
  item.kind !== "update" && item.answer && "choice" in item.answer ? item.answer : null

// Pure: whether a card a chat reply collapsed opens again to its full self, its answers and Schedule back: an open decision or draft whose answer is that reply, its poster not done with it, which an answer or a Schedule from the card replaces.
export const reopenable = (item: InboxItem): boolean => {
  const answer = chosen(item)
  return item.status === "open" && answer?.choice === "replied" && !answer.ackedAt
}

// Pure: whether Schedule is offered, the API's scheduleItem rule restated: an open decision or draft whose answer holds no choice yet, one still sleeping included, which Schedule puts away again, or a chat reply its poster is not done with.
export const schedulable = (item: InboxItem): boolean =>
  item.kind !== "update" && item.status === "open" && (!chosen(item) || reopenable(item))

// Pure: whether a key opens or folds a card a chat reply collapsed: E alone, Caps Lock's too, never typed in the card's box, held down or composing text.
export const reopenKey = (key: Omit<CardKey, "keyCode">): boolean =>
  key.key.toLowerCase() === "e" &&
  !(key.altKey || key.ctrlKey || key.metaKey || key.shiftKey || key.repeat || key.isComposing) &&
  key.target !== "box"

// A zone's offset from UTC at a moment, daylight saving included.
const offsetAt = (zone: string, t: number) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
      month: "numeric",
      second: "numeric",
      timeZone: zone,
      year: "numeric",
    })
      .formatToParts(t)
      .map(({ type, value }) => [type, Number(value)]),
  )
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return wall - Math.floor(t / 1000) * 1000
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

// One of Schedule's fixed times: when it asks again, its name, and that moment in the owner's zone with its day.
export type ScheduleChoice = { at: string; label: string; when: string }

// Pure: Schedule's fixed times in the owner's zone (the clock.ownerZone setting), soonest first: in 30 minutes, 1 hour and 3 hours, this evening's 18:00 while it is ahead, the next 09:00 (Today or Tomorrow), the coming Monday's 09:00 and next week's same weekday at 09:00; a moment two of them share is kept once, a named time winning over an "In N" one, and Today, Tomorrow or Next <weekday> over Monday.
export function scheduleChoices(now: Date, zone: string): ScheduleChoice[] {
  const t = now.getTime()
  const local = new Date(t + offsetAt(zone, t))
  const day = local.getUTCDay()
  // a wall-clock hour in the zone, this many days from today, as a UTC time, at the offset that day has
  const zoneAt = (days: number, hour: number) => {
    const wall = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + days,
      hour,
    )
    return wall - offsetAt(zone, wall - offsetAt(zone, wall))
  }
  const nineToday = zoneAt(0, 9) > t
  const named: [number, string][] = [
    [zoneAt(0, 18), "This evening 18:00"],
    [zoneAt(nineToday ? 0 : 1, 9), nineToday ? "Today 09:00" : "Tomorrow 09:00"],
    [zoneAt(7, 9), `Next ${DAYS[day]} 09:00`],
    [zoneAt((8 - day) % 7 || 7, 9), "Monday 09:00"],
  ]
  const ahead: [number, string][] = [
    [t + 30 * 60_000, "In 30 minutes"],
    [t + 3_600_000, "In 1 hour"],
    [t + 3 * 3_600_000, "In 3 hours"],
  ]
  // two times meet when they show the same minute, since an "In N" one keeps now's seconds
  const seen = new Set<number>()
  return [...named, ...ahead]
    .filter(([at]) => {
      const minute = Math.floor(at / 60_000)
      if (at <= t || seen.has(minute)) return false
      seen.add(minute)
      return true
    })
    .sort(([a], [b]) => a - b)
    .map(([at, label]) => {
      const shown = new Date(at + offsetAt(zone, at))
      const hh = String(shown.getUTCHours()).padStart(2, "0")
      const mm = String(shown.getUTCMinutes()).padStart(2, "0")
      const when = `${DAYS[shown.getUTCDay()]} ${shown.getUTCDate()} ${MONTHS[shown.getUTCMonth()]}, ${hh}:${mm}`
      return { at: new Date(at).toISOString(), label, when }
    })
}

// Pure: the moment Pick a time names, a day from the Calendar at a time field's "HH:MM" in this browser's time zone, or null while it names none: no day, a time that does not read, or a moment not after now, which Set refuses.
export function pickedAt(day: Date | undefined, time: string, now: Date): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!day || !match) return null
  const at = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number(match[1]),
    Number(match[2]),
  )
  return at.getTime() > now.getTime() ? at : null
}

// Pure: whether an item asks something of the owner now: an open decision or draft, an answer that failed to send, or an update not read yet. A chat reply took an item off his hands, so it waits on its poster alone.
export const needsYou = (item: InboxItem): boolean =>
  item.kind === "update"
    ? item.readAt === null
    : (item.status === "open" && chosen(item)?.choice !== "replied") || sendFailed(item)

// Pure: the ids of what waits on the owner in the Inbox, in the list's order, so Playground's row's link reaches the first.
export const inboxWaiting = (items: InboxItem[]): string[] =>
  items.filter(needsYou).map((item) => item.id)

// An answered decision or draft its poster has not closed, or a read update, stays in the list as its result this long, so he sees it land, then moves to Done.
export const DONE_AFTER_MS = 10 * 60 * 1000

// A chat reply stays in the list this long, so he sees it taken, then moves to In progress while its poster carries it out.
export const PROGRESS_AFTER_MS = 5 * 60 * 1000

// Pure: when an item was settled: answered, for an update read, and for a chat reply once its poster closed it or he dismissed it; null while it still asks something of him, or while its poster is still carrying a reply out.
const settledAt = (item: InboxItem): number | null => {
  if (needsYou(item)) return null
  const answer = chosen(item)
  if (item.kind !== "update" && answer?.choice === "replied") {
    const closed = answer.ackedAt ?? answer.dismissedAt
    return closed ? Date.parse(closed) : null
  }
  return Date.parse(
    item.kind === "update" ? (item.readAt ?? item.updatedAt) : (answer?.at ?? item.updatedAt),
  )
}

// Pure: the time Done orders an item by: when he dismissed it or its poster closed it, else when it settled, once that is DONE_AFTER_MS ago; null while it is still in the list at now.
const doneAt = (item: InboxItem, now: number): number | null => {
  const at = settledAt(item)
  if (at === null) return null
  const dismissed = answeredDismissedAt(item)
  if (dismissed) return Date.parse(dismissed)
  return now - at >= DONE_AFTER_MS ? at : null
}

// Pure: the list as shown at now: the items still in it, in the API's order; Archived, what he set aside to talk about later (Archive's `cleared`) and has not dismissed, newest first, out of the list at once, a dismissed one going to Done; and Done, those he dismissed or their poster closed, or that settled over DONE_AFTER_MS ago, the newest first. Nothing is deleted.
export function inboxView(
  items: InboxItem[],
  now: number,
): { archived: InboxItem[]; done: InboxItem[]; progress: InboxItem[]; shown: InboxItem[] } {
  // a set-aside whose send failed stays in the list and its count, offering Retry, until it reaches its poster or he dismisses it
  const shelved = (item: InboxItem) =>
    item.status === "cleared" && !answeredDismissedAt(item) && !sendFailed(item)
  const archived = items.filter(shelved).sort((a, b) => b.ref - a.ref)
  const rest = items.filter((item) => !shelved(item))
  const done = rest
    .filter((item) => doneAt(item, now) !== null)
    .sort((a, b) => (doneAt(b, now) ?? 0) - (doneAt(a, now) ?? 0) || b.ref - a.ref)
  const open = rest.filter((item) => doneAt(item, now) === null)
  // a chat reply its poster is still carrying out waits on the poster alone, so five minutes on it leaves the list for its own shelf
  const working = (item: InboxItem) => {
    const answer = chosen(item)
    return reopenable(item) && answer !== null && now - Date.parse(answer.at) >= PROGRESS_AFTER_MS
  }
  return {
    archived,
    done,
    progress: open.filter(working).sort((a, b) => b.ref - a.ref),
    shown: open.filter((item) => !working(item)),
  }
}

// Pure: the list as he sees it: the items in his order keep their places and one that left drops out, while one that arrived since waits in held, newest first, until he takes it. With no order yet, every item shows in the API's order, and with nothing left in view what arrived shows at once, since nothing can move under him.
export function pinnedView(
  shown: InboxItem[],
  order: readonly string[] | null,
): { held: InboxItem[]; rows: InboxItem[] } {
  if (order === null) return { held: [], rows: shown }
  const byId = new Map(shown.map((item) => [item.id, item]))
  const rows = order.flatMap((id) => byId.get(id) ?? [])
  const held = shown.filter((item) => !order.includes(item.id)).sort((a, b) => b.ref - a.ref)
  return rows.length === 0 ? { held: [], rows: held } : { held, rows }
}

export const newLabel = (count: number): string => `${count} new update${count === 1 ? "" : "s"}`

// Pure: the card a take hands focus to, the first it put on top, but only while the pill he took holds focus, since the pill leaves and focus would drop to the page; a take by a link, or one whose pill lost focus, moves no focus.
export const focusAfterTake = <T>(
  pill: { contains: (node: never) => boolean } | null,
  active: unknown,
  first: T | null,
): T | null => (pill?.contains(active as never) ? first : null)

// How long a row's buttons stay paused after it moves under him, so a click meant for another item never lands on it.
export const MOVED_PAUSE_MS = 1_000

// Pure: the rows whose place changed since the last render, or that were not there; none on the first read.
export const movedRows = (before: readonly string[] | null, after: readonly string[]): string[] =>
  before === null ? [] : after.filter((id, index) => before.indexOf(id) !== index)

// Pure: one render's step: the rows that moved since the last read rows, and the rows to compare the next read with; while the inbox loads (ids null) nothing is kept, so its first read moves nothing.
export const movedStep = (
  before: string[] | null,
  ids: string[] | null,
): { before: string[] | null; moved: string[] } =>
  ids === null ? { before, moved: [] } : { before: ids, moved: movedRows(before, ids) }

// A key pressed on a card, as cardKey and reopenKey read it: where it was pressed, its box, a labelled ask's choice or elsewhere.
export type CardKey = {
  altKey: boolean
  ctrlKey: boolean
  isComposing: boolean
  key: string
  keyCode: number
  metaKey: boolean
  repeat: boolean
  shiftKey: boolean
  target: "box" | "choice" | "elsewhere"
}

// Pure: what a card does with Cmd/Ctrl+Enter, the Questionnaire's submit key, by where it was pressed: null leaves the key alone (a labelled ask's picked side goes through the Questionnaire's submit, and Shift, Alt or a key that composes text is not the shortcut); "leave" keeps a key pressed on a link or a button from the Questionnaire, so the browser does what it does there (Cmd+Enter on Open thread opens it in a tab); in the card's box, "send" presses the draft's Send, and "hold" takes the key with nothing to send, a repeat or a labelled ask with no side picked included, so the item is never checked and marked invalid.
export function cardKey(
  key: CardKey,
  card: {
    choosing: boolean
    draftReady: boolean
    picked: boolean
  },
): "hold" | "leave" | "send" | null {
  if (key.key !== "Enter" || !(key.metaKey || key.ctrlKey) || key.shiftKey || key.altKey)
    return null
  if (key.isComposing || key.keyCode === 229) return null
  if (key.target === "elsewhere") return "leave"
  if (card.choosing) return card.picked ? null : "hold"
  if (key.repeat) return "hold"
  return card.draftReady ? "send" : "hold"
}

// Pure: why a labelled ask's Send is off, its hover and screen-reader words, until a side is picked.
export const sendWhy = (pick: "approve" | "deny" | null): string | null =>
  pick === null ? "Pick Approve or Deny first" : null

// Pure: whether Dismiss is offered: an answered decision or draft, one that failed to send included, one he replied to in chat, which stays open, or any update, read or not, still in the list; dismissing an update marks it read.
export const dismissable = (item: InboxItem): boolean =>
  (item.kind === "update" || item.status !== "open" || chosen(item)?.choice === "replied") &&
  !answeredDismissedAt(item)

// Pure: the line over the list: what needs him, the drafts, the answers that failed to send and the unread updates, each left out at none. A chat reply took an item off his hands, so it reads here no more.
export function inboxSummary(items: InboxItem[]): string | null {
  const open = items.filter(
    (item) =>
      item.kind !== "update" && item.status === "open" && chosen(item)?.choice !== "replied",
  )
  const decisions = open.filter((item) => item.kind === "decision").length
  const drafts = open.filter((item) => item.kind === "draft").length
  const failed = items.filter(sendFailed).length
  const unread = items.filter((item) => item.kind === "update" && item.readAt === null).length
  const parts = [
    decisions ? `${decisions} need${decisions === 1 ? "s" : ""} you` : null,
    drafts ? `${drafts} draft${drafts === 1 ? "" : "s"}` : null,
    failed ? `${failed} failed to send` : null,
    unread ? `${unread} unread` : null,
  ].filter((part) => part !== null)
  return parts.length ? parts.join(" · ") : null
}

// The word an item's band gives its kind: a decision by what Approve does, a draft as one, an update by its outcome.
export function kindWord(item: InboxItem): string {
  if (item.kind === "draft") {
    return httpsUrl(item.preview.link)?.hostname === "linear.app" ? "Linear comment" : "Slack draft"
  }
  if (item.kind === "update") {
    const word = item.preview.outcome
    return word.charAt(0).toUpperCase() + word.slice(1)
  }
  const words = {
    ask: "Ask",
    budget: "Budget",
    delete: "Delete",
    schema: "Schema",
    secret: "Secret",
    ship: "Ship",
    slack: "Slack",
    ticket: "New ticket",
  } as const
  return words[item.preview.type]
}

// Pure: whether an answer is carried out: a go is carried out only once its poster closes it with where it landed.
const carriedOut = (item: InboxItem): boolean => {
  const answer = chosen(item)
  // a settle is no go, so it is never carried out
  if (item.kind === "update" || !answer || answer.choice === "settled") return false
  const delivery = item.delivery
  const read = delivery?.status === "delivered" && delivery.via === "cli"
  // delivered before acks were stamped, so it may have been acked with no stamp, as the API's stale read takes it
  const unstamped =
    delivery?.status === "delivered" && Date.parse(answer.at) < Date.parse(ACKS_STAMPED_FROM)
  return (
    Boolean(answer.ackedAt || answer.link || ("noLink" in answer && answer.noLink)) ||
    unstamped ||
    // a cli-read reply waits for its ack like any go, so the card reads as being worked on
    (read && answer.choice !== "replied" && !isGo(answer.choice))
  )
}

// Where an item stands, which its card's colour says: open while it needs him, sending while a go or a chat reply is being carried out, done once its poster closed it, failed when the answer did not reach its poster, closed once denied, discarded, settled, read, a Draft Slack refused, or a failure he dismissed.
export type ItemState = "closed" | "done" | "failed" | "open" | "sending"

// Pure: a Draft its poster closed with no link, which only Slack refusing it leaves (draft_already_exists), so nothing was saved.
const draftRefused = (item: InboxItem): boolean => {
  const answer = chosen(item)
  return (
    item.kind === "draft" &&
    answer?.choice === "draft" &&
    Boolean("noLink" in answer && answer.noLink)
  )
}

export function itemState(item: InboxItem): ItemState {
  if (sendFailed(item)) return "failed"
  if (needsYou(item)) return "open"
  // a secret he provided is done once every environment took it, and failed while any did not
  const provided = chosen(item)
  if (provided?.choice === "provided") {
    if (!provided.results) return "sending"
    return provided.results.every((result) => result.exitCode === 0) ? "done" : "failed"
  }
  // a chat reply is being carried out by its poster until it is closed, then done
  if (item.kind !== "update" && chosen(item)?.choice === "replied")
    return carriedOut(item) ? "done" : "sending"
  const answer = chosen(item)
  if (item.kind === "update" || !answer || !isGo(answer.choice)) return "closed"
  if (draftRefused(item)) return "closed"
  if (carriedOut(item)) return "done"
  // a failure he dismissed never reached its poster, so no one is carrying it out
  return item.delivery?.status === "failed" ? "closed" : "sending"
}

// Each state's light, the sidebar's state that means the same, so its icon and colour come from status-icons.ts's one table: waiting on him, being carried out, carried out, failed to send, closed.
const INBOX_LIGHTS: Record<ItemState, ShownState> = {
  closed: "idle",
  done: "done",
  failed: "failing",
  open: "waiting",
  sending: "working",
}

// Pure: the light a card draws beside its title; null for an unread update, which keeps its dot.
export const inboxLight = (item: InboxItem): ShownState | null =>
  item.kind === "update" && item.readAt === null ? null : INBOX_LIGHTS[itemState(item)]

// Pure: when an item changed after it was posted (an answer, its delivery, its poster's ack, settle or edit), from its updatedAt; null for one unchanged since. An update counts only its poster's edit, since his read stamps readAt with updatedAt and his Dismiss or a resolve gives it an answer.
export const changedAt = (item: InboxItem): string | null =>
  Date.parse(item.updatedAt) - Date.parse(item.createdAt) >= 1000 &&
  (item.kind !== "update" ||
    (item.answer === null &&
      (item.readAt === null || Date.parse(item.updatedAt) > Date.parse(item.readAt))))
    ? item.updatedAt
    : null

// Pure: whether a card reads Updated: it changed after the look before this one (since, null before any) and by the time this look began (upto), so a change made as he looks shows in place and none reads Updated twice.
export const updatedSince = (
  item: InboxItem,
  since: string | null,
  upto: string | null,
): boolean => {
  const at = changedAt(item)
  if (at === null || upto === null) return false
  return (
    (since === null || Date.parse(at) > Date.parse(since)) && Date.parse(at) <= Date.parse(upto)
  )
}

// Pure: the session that took an item's answer, which is not its poster once the poster has ended; a row from before the taker was recorded reads as its poster.
export const takenBy = (item: InboxItem): string =>
  item.delivery?.status === "delivered" && item.delivery.to ? item.delivery.to : item.from

// Pure: what became of an answer, in the words the list shows once an item is answered.
export function outcomeLine(item: InboxItem): string | null {
  // an item still sleeping holds no choice, and asks him nothing until its time
  if (item.kind === "update" || !item.answer || !("choice" in item.answer)) return null
  if (draftRefused(item) && item.answer.choice === "draft")
    return `Draft not saved: ${item.answer.noLink}`
  // closed by its poster, decided another way: the owner gave no answer, so nothing was delivered
  if (item.answer.choice === "settled") {
    const by = `Answered by ${agentLabel(item.answer.by)}`
    return item.answer.note ? `${by} · ${item.answer.note}` : by
  }
  // when, and each environment's exit status: all a secret's card ever shows of it
  if (item.answer.choice === "provided") {
    const results = (item.answer.results ?? []).map(
      (result) =>
        `${result.environment}: ${result.exitCode === null ? "stopped" : `exit ${result.exitCode}`}`,
    )
    return [`Provided at ${fullTime(item.answer.at)}`, ...results].join(" · ")
  }
  const who = agentLabel(takenBy(item))
  // being carried out by its poster until it is closed, where the close's link shows in the footer
  // his words lead, so the card says what is being done
  if (item.answer.choice === "replied") {
    const said = item.answer.said ? `You replied "${item.answer.said}"` : "You replied"
    return carriedOut(item) ? said : `${said} · ${who} is on it…`
  }
  const done = {
    approve: "You approved it",
    clear: "You set it aside for later",
    deny: "You denied it",
    discard: "You discarded it",
    draft: item.answer.editedText
      ? "You saved it as a draft with changes"
      : "You saved it as a draft",
    edit: "You approved it with changes",
    send: item.answer.editedText ? "You sent it with changes" : "You sent it",
  }[item.answer.choice]
  const delivery = item.delivery
  if (isGo(item.answer.choice) && delivery?.status !== "failed" && !carriedOut(item)) {
    if (item.answer.choice === "draft") return `${done} · Saving a Slack draft…`
    const slack = item.kind === "decision" && item.preview.type === "slack"
    if (item.answer.choice !== "send" && !slack) return `${done} · Being carried out by ${who}…`
    return `${done} · ${kindWord(item) === "Linear comment" ? "Sending to Linear…" : "Sending in Slack…"}`
  }
  const reached =
    delivery?.status === "delivered"
      ? delivery.via === "cli"
        ? `Read by ${who}`
        : `Delivered to ${who}`
      : delivery?.status === "failed"
        ? // typing began (INTERRUPTED) or the adapter threw (ERROR): the answer may be in the session already
          delivery.code === "INTERRUPTED" || delivery.code === "ERROR"
          ? `Send unconfirmed: ${delivery.reason}`
          : `Send failed: ${delivery.reason}`
        : "Delivery pending"
  return item.answer.noLink
    ? `${done} · ${reached} · No link: ${item.answer.noLink}`
    : `${done} · ${reached}`
}

// Pure: what a link points to, named from the link itself when its poster gave no label: a Linear ticket's ID, a pull request or issue as owner/repo#N, Open thread for a Slack link, else the site.
const linkName = (url: URL): string => {
  const host = url.hostname
  if (host === "slack.com" || host.endsWith(".slack.com")) return "Open thread"
  if (host === "linear.app")
    return /\/issue\/([a-z][a-z0-9]*-\d+)/i.exec(url.pathname)?.[1]?.toUpperCase() ?? "Linear"
  const github =
    host === "github.com" && /^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(url.pathname)
  if (github) return `${github[1]}/${github[2]}#${github[3]}`
  const compare = host === "github.com" && /^\/([^/]+)\/([^/]+)\/compare\//.exec(url.pathname)
  return compare ? `${compare[1]}/${compare[2]} compare` : host
}

// Pure: a link the dashboard opens, https alone; null for anything else.
const httpsUrl = (link?: string): URL | null => {
  if (!link) return null
  try {
    const url = new URL(link)
    return url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

// Pure: where an item will land, given upfront, for its place line: a draft's thread as Open thread, a slack, ship or ticket decision's place by its link's name, or why there is none yet; null once its poster's ack links where it landed, which the result line shows instead.
export function upfrontLink(
  item: InboxItem,
): { href: string; label: string } | { reason: string } | null {
  if (item.kind === "update" || chosen(item)?.link) return null
  const preview = item.preview
  if (item.kind === "decision" && !(PLACED_TYPES as readonly string[]).includes(item.preview.type))
    return null
  const url = httpsUrl("link" in preview ? preview.link : undefined)
  if (url) return { href: url.href, label: item.kind === "draft" ? "Open thread" : linkName(url) }
  return "noLink" in preview && preview.noLink ? { reason: preview.noLink } : null
}

// The decisions whose preview names where they land, the API's PLACED_TYPES restated (a test holds the two equal).
export const PLACED_TYPES = ["ship", "slack", "ticket"] as const

// Pure: where an answered item was carried out, named for what was done: the poster's https URL and its label, else a name drawn from the link; null without one.
export function resultLink(item: InboxItem): { href: string; label: string } | null {
  if (item.kind === "update") return null
  const answer = chosen(item)
  const url = httpsUrl(answer?.link)
  if (!url) return null
  return { href: url.href, label: answer?.linkLabel ?? linkName(url) }
}

// Pure: the oldest open decision or draft a session posted, which it depends on, so it reads Waiting on your inbox, with the orange eye, linked to that item; null when it posted none still open, or is a probe, which waits on its spawner, never the owner.
export function inboxWaitOf(
  items: readonly InboxItem[],
  name: string,
): { id: string; ref: number } | null {
  if (isProbe(name)) return null
  const open = items
    .filter(
      (item) =>
        item.from === name &&
        item.kind !== "update" &&
        item.status === "open" &&
        chosen(item)?.choice !== "replied",
    )
    .sort((a, b) => a.ref - b.ref)[0]
  return open ? { id: open.id, ref: open.ref } : null
}

// Pure: the sessions waiting on an open decision or draft they posted, probes left out; a chat reply took the item off the owner's hands, so its poster reads there no more.
export const inboxPosters = (items: readonly InboxItem[]): Set<string> =>
  new Set(
    items
      .filter(
        (item) =>
          item.kind !== "update" &&
          item.status === "open" &&
          chosen(item)?.choice !== "replied" &&
          !isProbe(item.from),
      )
      .map((item) => item.from),
  )

// Pure: whether a link's anchor (needs-you-<id>) names an item the inbox holds, so the view opens its Inbox tab to show it.
export const inboxTarget = (anchor: string, items: readonly InboxItem[]): boolean => {
  const prefix = needsYouAnchor("")
  return anchor.startsWith(prefix) && items.some((item) => item.id === anchor.slice(prefix.length))
}
