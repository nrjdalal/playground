import type { Entry, FeedItem, Worker } from "@api/hono"
import { useEffect, useEffectEvent, useRef } from "react"

import { chatLabel } from "@/lib/agent-label"
import {
  answerFeedPrompt,
  isPrimary,
  isProbe,
  waitLabel,
  type FeedAnswerBody,
} from "@/lib/dashboard"

// What waits on you in a session's stream, in one shape whatever its terminal holds (a picker, a permission prompt, a plan). The card renders this. Decisions the factory posts for you are Playground's Inbox instead (lib/inbox.ts).
export type NeedsYouOption = {
  description: string | null
  id: string
  label: string
  recommended: boolean
}

export type NeedsYouQuestion = {
  allowText: boolean
  header: string | null
  id: string
  multiSelect: boolean
  options: NeedsYouOption[]
  prompt: string
  // Words that stand in for a choice rather than add to it (a Feed picker): typing clears the choice and picking clears the words.
  textInstead?: boolean
  // What the words box is called, when the question gives it a name of its own.
  textLabel?: string | null
}

export type NeedsYouKind = "permission" | "plan" | "question"

// What a card shows verbatim under its title, as plain text that hides nothing: a permission's input as code, a plan's text as written (markdown would drop an HTML comment or a link definition from sight).
export type NeedsYouBody = { kind: "code" | "text"; text: string }

// at is when it was asked, which places it in the session's stream; null is now, under the latest step.
export type NeedsYou = {
  at: string | null
  body?: NeedsYouBody | null
  context: string | null
  from: string
  // Set for a prompt from a session herdr runs: its picker is answered here, by keys into its pane, and its permission or plan in its terminal alone.
  herdr?: true
  // Set for a prompt from a session the dashboard hosts on the Agent SDK, which has no terminal to answer it in.
  hosted?: true
  id: string
  kind: NeedsYouKind
  questions: NeedsYouQuestion[]
  title: string
}

// Each question's answer by its id, the choices by option label.
export type NeedsYouAnswer = { answers: Record<string, { choices: string[]; text: string | null }> }

// state colours the summary: done (delivered or read), pending, or failed.
export type NeedsYouState = "done" | "failed" | "pending"

// summary is the one-line outcome the card collapses to ("Delivered to Greed"); state, when given, says whether the answer reached its asker, so a recorded answer that was not delivered warns rather than celebrates.
// A refusal's sent says the answer may have gone out anyway (the terminal took it and could not show it landing), so sending again is a deliberate step; without it nothing was sent.
export type OnAnswer = (
  item: NeedsYou,
  answer: NeedsYouAnswer,
) => Promise<
  | { ok: true; state?: NeedsYouState; summary: string }
  | { ok: false; reason: string; sent?: boolean }
>

// The answer route's refusals after which the answer may already be in the session.
const MAY_HAVE_GONE = new Set(["CMUX_FAILED", "INTERRUPTED", "NOT_TAKEN", "UNCONFIRMED"])

export const mayHaveGone = (feed: unknown): boolean => MAY_HAVE_GONE.has(String(feed))

// What a card holds for one question as it is being answered: the options picked, by label, and the words typed.
export type NeedsYouGiven = { choices: string[]; text: string }

// A question is answered by a choice or by words, a note alone included.
export const isAnswered = (given: NeedsYouGiven | undefined): boolean =>
  given !== undefined && (given.choices.length > 0 || given.text.trim() !== "")

// Where Next, Submit and their keys take a card from the question at index: on to the next question once this one is answered, and Submit from the last once every one is; null while something is missing. The card decides this itself, since Questionnaire's own checks count only its own controls and would refuse a note given alone.
export function nextStep(given: NeedsYouGiven[], index: number): "next" | "submit" | null {
  if (!isAnswered(given[index])) return null
  if (index < given.length - 1) return "next"
  return given.every(isAnswered) ? "submit" : null
}

// Why Submit is off, its hover and screen-reader words, from the first question still unanswered; null once every one is.
export function submitWhy(questions: NeedsYouQuestion[], given: NeedsYouGiven[]): string | null {
  const open = questions.findIndex((_, index) => !isAnswered(given[index]))
  if (open === -1) return null
  const { allowText, options } = questions[open]
  if (options.length === 0) return "Write your answer first"
  return allowText ? "Pick an option or write your answer first" : "Pick an option first"
}

// at is when it was answered, which decides when the collapsed line leaves the stream.
export type NeedsYouResolution = {
  at?: string
  choices: string[]
  state: NeedsYouState
  summary: string
  text: string | null
}

// One card as a stream shows it: the item, how to answer it (null while it can only be answered in the session's terminal), and once answered what became of it.
export type StreamNeed = {
  item: NeedsYou
  onAnswer: OnAnswer | null
  resolution: NeedsYouResolution | null
}

// A stream's step (a transcript entry, or a chat message with its time) or a card slotted among them.
export type StreamItem<T extends { at: string } = Entry> =
  | { entry: T; kind: "entry" }
  | { kind: "need"; need: StreamNeed }

// The DOM id of an item's card, which a sidebar row links to.
export const needsYouAnchor = (id: string): string => `needs-you-${id}`

// Pure: a URL hash as an anchor, without its #, decoded; a malformed escape (a hand-typed or cut-off link) reads as written rather than throwing, so the page still renders.
export const hashAnchor = (hash: string): string => {
  const raw = hash.replace(/^#/, "")
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// A Feed item's id as a card knows it, so its anchor and a sidebar row's link never meet an inbox item's.
const feedNeedId = (requestId: string): string => `feed-${requestId}`

export const PERMISSION_ALLOW = "Allow once"
export const PERMISSION_DENY = "Deny"
export const PLAN_START = "Start it"
export const PLAN_BACK = "Send it back"

const choice = (label: string, description: string | null = null): NeedsYouOption => ({
  description,
  id: label,
  label,
  recommended: false,
})

// What a Feed item asks, as a card shows it. A permission shows the whole input the tool was given and a plan its text, so what is approved is what was read; when either was cut short, or a permission came with nothing to show, only refusing it is offered here.
export function feedItemNeed(worker: Worker, item: FeedItem, approvals = false): NeedsYou {
  // Where to approve something that cannot be approved here: the terminal, and here only refusing it, when approvals are on. The session the dashboard hosts has no terminal: unanswered, it is refused after 10 minutes (PROMPT_TIMEOUT_MS in sdk.ts). A herdr session's permission or plan card answers nothing, and its footer names the terminal.
  const elsewhere = (approve: string, refuse: string) =>
    worker.herdr
      ? "Not all of it can be shown here."
      : worker.hosted
        ? approvals
          ? `Not all of it can be shown here: ${refuse} here, or it is refused after 10 minutes.`
          : `Not all of it can be shown here, so it is refused after 10 minutes.`
        : approvals
          ? `Not all of it can be shown here: ${approve} from the session's terminal, or ${refuse} here.`
          : `Not all of it can be shown here: answer it in the session's terminal.`
  // A prompt waits now, so its card stands under the latest step, after the tool call that raised it.
  const base = {
    at: null,
    from: worker.name,
    id: feedNeedId(item.requestId),
    ...(worker.herdr && { herdr: true as const }),
    ...(worker.hosted && { hosted: true as const }),
  }
  if (item.kind === "question") {
    return {
      ...base,
      body: null,
      context: null,
      kind: "question",
      questions: item.questions.map((question, i) => ({
        allowText: true,
        header: question.header,
        id: `q${i}`,
        multiSelect: question.multiSelect,
        options: question.options.map((o) => choice(o.label, o.description)),
        prompt: question.prompt,
        textInstead: true,
        textLabel: question.options.length ? "Or answer in your own words" : null,
      })),
      // One question titles its card; several are named by their count, each keeping its own prompt.
      title:
        item.questions.length === 1
          ? (item.questions[0]?.prompt ?? "A picker")
          : `${item.questions.length} questions`,
    }
  }
  if (item.kind === "permission") {
    const shown = item.whole
    return {
      ...base,
      body: { kind: "code", text: item.input.trim() || item.detail },
      context: shown ? item.description : elsewhere("allow it", "deny it"),
      kind: "permission",
      questions: [
        {
          allowText: false,
          header: null,
          id: "mode",
          multiSelect: false,
          options: shown
            ? [choice(PERMISSION_ALLOW), choice(PERMISSION_DENY)]
            : [choice(PERMISSION_DENY)],
          prompt: "Allow it?",
        },
      ],
      title: `${item.tool || "A tool"} asks to run`,
    }
  }
  const shown = item.whole
  return {
    ...base,
    body: { kind: "text", text: item.plan },
    context: shown ? null : elsewhere("start it", "send it back"),
    kind: "plan",
    questions: [
      {
        allowText: true,
        header: null,
        id: "mode",
        multiSelect: false,
        options: shown ? [choice(PLAN_START), choice(PLAN_BACK)] : [choice(PLAN_BACK)],
        prompt: "Start this plan?",
        textLabel: "A note, if you send it back",
      },
    ],
    title: "A plan to start",
  }
}

// The route's body for a card's answer, or why it does not fit: a picker's answers go in question order, a permission's choice becomes once or deny, a plan's becomes manual or deny with the words as its note.
export function feedAnswerBody(
  item: FeedItem,
  answer: NeedsYouAnswer,
): { body: FeedAnswerBody; ok: true } | { ok: false; reason: string } {
  if (item.kind === "question") {
    const both = item.questions.some((_, i) => {
      const given = answer.answers[`q${i}`]
      return Boolean(given?.choices.length && given.text)
    })
    if (both) return { ok: false, reason: "Pick an option or write your own answer, not both." }
    return {
      body: {
        answers: item.questions.map((_, i) => {
          const given = answer.answers[`q${i}`]
          return { choices: given?.choices ?? [], text: given?.text ?? null }
        }),
        kind: "question",
      },
      ok: true,
    }
  }
  const given = answer.answers.mode
  const [picked] = given?.choices ?? []
  if (item.kind === "permission") {
    if (picked === PERMISSION_ALLOW) return { body: { kind: "permission", mode: "once" }, ok: true }
    if (picked === PERMISSION_DENY) return { body: { kind: "permission", mode: "deny" }, ok: true }
    return { ok: false, reason: "Allow it once or deny it." }
  }
  if (picked === PLAN_START) {
    if (given?.text) return { ok: false, reason: "A note goes with sending the plan back." }
    return { body: { feedback: null, kind: "plan", mode: "manual" }, ok: true }
  }
  if (picked === PLAN_BACK) {
    return { body: { feedback: given?.text ?? null, kind: "plan", mode: "deny" }, ok: true }
  }
  return { ok: false, reason: "Start the plan or send it back." }
}

// Every prompt a session's terminal holds, a herdr session's transcript shows, or the session the dashboard hosts holds, as cards. A picker can always be answered here; a permission or a plan only while approvals are on, and otherwise only in the session's terminal (or, for the hosted one, not at all: it is refused after 10 minutes). A herdr session's picker is answered by keys into its pane (answerHerdr() in the API), and its permission or plan in its terminal alone.
export function feedNeeds(worker: Worker, approvals: boolean): StreamNeed[] {
  return worker.feed.map((feedItem) => {
    const item = feedItemNeed(worker, feedItem, approvals)
    const answerable = feedItem.kind === "question" || (!worker.herdr && approvals)
    const onAnswer: OnAnswer = async (_, answer) => {
      const built = feedAnswerBody(feedItem, answer)
      if (!built.ok) return built
      const { error } = await answerFeedPrompt(worker.sessionId, feedItem.requestId, built.body)
      if (error) {
        return { ok: false, reason: error.message, sent: mayHaveGone(error.feed) }
      }
      return { ok: true, state: "done", summary: "Sent to its session" }
    }
    return { item, onAnswer: answerable ? onAnswer : null, resolution: null }
  })
}

// What waits on you in one session: its Feed prompts, and in the primary dispatcher's (isPrimary, by the name the API gives it as primary), first, what needs you in Playground's Inbox (inbox, its ids in the list's order), the Inbox being the primary's alone (#i520). The first is where its sidebar row goes.
export const sessionWaiting = (
  worker: Worker,
  inbox: string[] = [],
  primary: string | null = null,
): string[] =>
  // a probe's pickers are its spawner's to answer, so they light no alarm and stay out of Needs you
  worker.role !== "dispatcher" && isProbe(worker.name)
    ? []
    : [
        ...(isPrimary(worker, primary) ? inbox : []),
        ...worker.feed.map((item) => feedNeedId(item.requestId)),
      ]

// Pure: the live sessions stopped at a Feed prompt, or named among posters (those waiting on an inbox item they posted), by session id. The board ranks them with Waiting on you.
export const waitingSessions = (
  workers: Worker[] | null,
  posters: ReadonlySet<string> = new Set(),
): Set<string> =>
  new Set(
    (workers ?? [])
      .filter((worker) => sessionWaiting(worker).length > 0 || posters.has(worker.name))
      .map((worker) => worker.sessionId),
  )

// Pure: the notice a session's view shows while it waits at a prompt its terminal no longer holds: on you, in red, for a dispatcher's own (onYou), named as its chat names it (chatLabel, primary the name the API gives the first); any other session waits on Playground, a plain notice. null while it waits on no such prompt.
export const lostPrompt = (
  worker: Worker,
  primary: string | null = null,
): { onYou: boolean; title: string } | null => {
  if (worker.feed.length > 0 || worker.lifecycle !== "needsInput") return null
  const onYou = worker.role === "dispatcher"
  return { onYou, title: `${chatLabel(worker, primary)} · ${waitLabel(onYou)}` }
}

// One place where something waits on you, as the Dashboard lists it: a live session, how many, and the link to its first card (the newest Inbox item, else the oldest prompt); label names it as its chat does (chatLabel), name is its session's own.
export type NeedsYouPlace = {
  count: number
  first: string
  href: string
  key: string
  label: string
  name: string
  sessionId: string | null
}

// Pure: each dispatcher's place when something waits on you there (its prompts, and the primary's Inbox, primary naming it), as only a dispatcher waits on you; any other session waits on a dispatcher. Nothing while the board is still connecting.
export function needsYouPlaces(
  inbox: string[],
  workers: Worker[] | null,
  primary: string | null = null,
): NeedsYouPlace[] {
  const places: NeedsYouPlace[] = []
  for (const worker of workers ?? []) {
    if (worker.role !== "dispatcher") continue
    const [first, ...rest] = sessionWaiting(worker, inbox, primary)
    if (!first) continue
    places.push({
      count: rest.length + 1,
      first,
      href: `/dashboard?worker=${encodeURIComponent(worker.sessionId)}#${needsYouAnchor(first)}`,
      key: `session:${worker.sessionId}`,
      label: chatLabel(worker, primary),
      name: worker.name,
      sessionId: worker.sessionId,
    })
  }
  return places
}

// Pure: where the card an anchor names (needs-you-<id>) shows, as a link to it: the live session whose view holds the Feed prompt, or the dispatcher's for an inbox item; null for none, or while the board is still connecting. A link with no ?worker= (a bookmark of /dashboard before it opened your chat) follows it to its card.
export function cardHref(
  anchor: string,
  inbox: string[],
  workers: Worker[] | null,
  primary: string | null = null,
): string | null {
  if (!workers || !isNeedsYouAnchor(anchor)) return null
  const id = anchor.slice(needsYouAnchor("").length)
  const worker = workers.find((w) => sessionWaiting(w, inbox, primary).includes(id))
  return worker ? `/dashboard?worker=${encodeURIComponent(worker.sessionId)}#${anchor}` : null
}

// A time that cannot be read sorts first, so an untimed step never pulls cards in front of it.
const time = (at: string): number => {
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

// Pure: a session's steps with its cards slotted in where each was asked. A card asked before the oldest step shown leads, and one asked now (at null) closes the stream, under the latest step. An answered card leaves once it was answered before the oldest step shown, so it collapses in place when answered and an old session does not open on a pile of answered lines; none shows before any step has.
export function streamItems<T extends { at: string }>(
  entries: T[],
  needs: StreamNeed[],
): StreamItem<T>[] {
  const oldest = entries[0] ? time(entries[0].at) : null
  const timed = needs
    .filter(
      (need) =>
        need.item.at !== null &&
        (!need.resolution ||
          (oldest !== null && time(need.resolution.at ?? need.item.at) >= oldest)),
    )
    .sort((a, b) => time(a.item.at ?? "") - time(b.item.at ?? ""))
  const items: StreamItem<T>[] = []
  let next = 0
  for (const entry of entries) {
    while (next < timed.length && time(timed[next]?.item.at ?? "") <= time(entry.at)) {
      const need = timed[next++]
      if (need) items.push({ kind: "need", need })
    }
    items.push({ entry, kind: "entry" })
  }
  for (const need of timed.slice(next)) items.push({ kind: "need", need })
  for (const need of needs) if (need.item.at === null) items.push({ kind: "need", need })
  return items
}

const TARGET_EVENT = "needs-you:target"

// Pure: whether an anchor names a card rather than a chat message.
export const isNeedsYouAnchor = (anchor: string): boolean => anchor.startsWith(needsYouAnchor(""))

// A sidebar row asks for its first card: the link's hash carries it to a page that opens, and this event to the page already open, where following the same link again changes nothing the router sees.
export function targetNeedsYou(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(TARGET_EVENT, { detail: needsYouAnchor(id) }))
}

// Brings the card a sidebar row asked for into view once the page is ready (ready: its steps have loaded, so nothing later scrolls it away), by the URL's hash or by targetNeedsYou; any other hash, a footnote's, stays the browser's. scrollTo says whether it reached the card; one that is not on the page yet is tried again on the next render.
export function useNeedsYouTarget(ready: boolean, scrollTo: (anchor: string) => boolean): void {
  const wanted = useRef<string | null>(null)
  const done = useRef<string | null>(null)
  const seen = useRef<string | null>(null)
  const scroll = useEffectEvent(scrollTo)
  useEffect(() => {
    const onTarget = (event: Event) => {
      const anchor = (event as CustomEvent<string>).detail
      if (!isNeedsYouAnchor(anchor)) return
      wanted.current = anchor
      done.current = null
      if (ready && scroll(wanted.current)) done.current = wanted.current
    }
    window.addEventListener(TARGET_EVENT, onTarget)
    return () => window.removeEventListener(TARGET_EVENT, onTarget)
  }, [ready])
  useEffect(() => {
    const hash = hashAnchor(window.location.hash)
    // a link followed since names the place now, over an earlier row's click
    if (hash !== seen.current) {
      seen.current = hash
      if (hash && isNeedsYouAnchor(hash)) wanted.current = hash
    }
    const target = wanted.current
    if (!ready || !target || done.current === target) return
    if (scroll(target)) done.current = target
  })
}
