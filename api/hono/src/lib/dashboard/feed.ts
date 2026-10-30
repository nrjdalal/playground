import { reachesConsole } from "@packages/auth/access"
import { db, recordActivity, type ActivityActor, type ActivityEvent } from "@packages/db"
import { env } from "@packages/env/api-hono"

import {
  reply,
  runJson,
  type FeedReply,
  type PERMISSION_MODES,
  type PLAN_MODES,
} from "@/lib/dashboard/cmux"
import { normalize } from "@/lib/dashboard/deliver"
import {
  answerKeys,
  promptOnScreen,
  showsAsk,
  submitKeys,
  typeKeys,
  type Ask,
  type KeyStep,
  type ScreenPrompt,
} from "@/lib/dashboard/herdr"
import { readScreen } from "@/lib/dashboard/terminal"
import {
  feedBySession,
  listLive,
  type FeedItem,
  type Live,
  type Worker,
} from "@/lib/dashboard/workers"

// An answer as the dashboard's card sends it: each question's choices by option label, or its own words in place of a choice; a permission once or denied; a plan started with edits still asking, or sent back with an optional note.
export type FeedAnswer =
  | { answers: { choices: string[]; text: string | null }[]; kind: "question" }
  | { kind: "permission"; mode: (typeof PERMISSION_MODES)[number] }
  | { feedback: string | null; kind: "plan"; mode: (typeof PLAN_MODES)[number] }

// Who answers, as the session that signed in knows them: the actor goes into the activity row, the approver is what canApprove() judges.
export type FeedAnswering = {
  actor: ActivityActor
  answer: FeedAnswer
  approver: { banned?: boolean | null; role?: string | null }
  requestId: string
  sessionId: string
}

// Why an answer did not go, or did and could not be confirmed: BUSY (that prompt is being answered already), CMUX_FAILED (cmux or herdr could not be read, or the reply may not have gone), DISABLED (permission and plan answers are off), FORBIDDEN (this sign-in may not answer), INTERRUPTED (keys went into a herdr session's pane, yet its prompt still shows or changed partway), INVALID (the answer does not fit the prompt), NOT_FOUND (the session is not live), NOT_PENDING (no such prompt waits on that session, or a herdr session's pane no longer shows it, so nothing was typed), NOT_TAKEN (cmux took the reply, yet the prompt still waits), TERMINAL_ONLY (a herdr session's permission or plan, answered in its terminal alone), UNCONFIRMED (the reply went, but the Feed or the pane could not be read to see it land).
export const FEED_FAILURES = [
  "BUSY",
  "CMUX_FAILED",
  "DISABLED",
  "FORBIDDEN",
  "INTERRUPTED",
  "INVALID",
  "NOT_FOUND",
  "NOT_PENDING",
  "NOT_TAKEN",
  "TERMINAL_ONLY",
  "UNCONFIRMED",
] as const

export type FeedFailure = (typeof FEED_FAILURES)[number]

export type FeedResult = { at: string; ok: true } | { code: FeedFailure; ok: false; reason: string }

// TODO(login): a login only the owner can use is still being chosen for these writes (a passkey, or GitHub allowlisted to the owner); that choice narrows this, and it may take the whole session then. Today any owner session may answer, the agent sign-in included wherever it is enabled, which is why permission and plan answers stay behind PLAYGROUND_APPROVALS_ENABLED.
export const canApprove = (user: { banned?: boolean | null; role?: string | null }): boolean =>
  reachesConsole(user, "owner")

// A herdr session's pane, which answerHerdr() reads and types into: its screen, and the keys, one request each.
export type HerdrPane = {
  read: (surface: string) => Promise<string>
  settle: { attempts: number; delayMs: number }
  type: (surface: string, keys: KeyStep[]) => Promise<void>
}

export const herdrPane: HerdrPane = {
  read: (surface) => readScreen(surface, 40),
  settle: { attempts: 8, delayMs: 250 },
  type: typeKeys,
}

export type AnswerDeps = {
  approvals: boolean
  herdr?: HerdrPane
  listLive: () => Promise<Live>
  now: () => Date
  readFeed: () => Promise<unknown>
  record: (event: ActivityEvent, replying: () => Promise<void>) => Promise<void>
  reply: (answer: FeedReply) => Promise<void>
  settle: { attempts: number; delayMs: number }
}

// The record and the reply share a transaction: a reply cmux refuses rolls the record back, and a record that cannot be inserted means nothing is answered.
const recordWhileReplying: AnswerDeps["record"] = (event, replying) =>
  db.transaction(async (tx) => {
    await recordActivity(tx, event)
    await replying()
  })

export const answerDeps: AnswerDeps = {
  approvals: env.PLAYGROUND_APPROVALS_ENABLED,
  listLive,
  now: () => new Date(),
  readFeed: () => runJson(["rpc", "feed.list", '{"pending_only":true}']),
  record: recordWhileReplying,
  reply,
  settle: { attempts: 6, delayMs: 250 },
}

type Refusal = Extract<FeedResult, { ok: false }>

const refused = (code: FeedFailure, reason: string): Refusal => ({ code, ok: false, reason })

// The longest answer or note a person writes into a prompt.
export const TEXT_LIMIT = 4000

class ReplyFailed extends Error {}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// The reply for an answer that fits its prompt: one selection per question (a single choice, a multi-select's labels in the picker's own order and joined as the Feed reads them, or the person's own words), a permission's mode, or a plan's mode with its note. A permission is allowed, and a plan started, only when all of it could be shown; either can always be refused.
export function replyFor(item: FeedItem, answer: FeedAnswer): FeedReply | Refusal {
  if (item.kind !== answer.kind) {
    return refused(
      "INVALID",
      `That prompt asks for a ${item.kind} answer, not a ${answer.kind} one.`,
    )
  }
  if (item.kind === "question" && answer.kind === "question") {
    if (answer.answers.length !== item.questions.length) {
      return refused(
        "INVALID",
        `The picker asks ${item.questions.length} questions; answer each once.`,
      )
    }
    const selections: string[] = []
    for (const [i, question] of item.questions.entries()) {
      const { choices, text } = answer.answers[i] ?? { choices: [], text: null }
      const words = text ? normalize(text) : ""
      const labels = question.options.map((o) => o.label)
      if (choices.some((choice) => !choice || !labels.includes(choice))) {
        return refused("INVALID", `"${question.prompt}" has no such option.`)
      }
      const chosen = labels.filter((label) => choices.includes(label))
      if (!question.multiSelect && chosen.length > 1) {
        return refused("INVALID", `"${question.prompt}" takes one option.`)
      }
      if (chosen.length > 0 === Boolean(words)) {
        return refused(
          "INVALID",
          `Answer "${question.prompt}" with options or with words, not both or neither.`,
        )
      }
      if (words.length > TEXT_LIMIT) {
        return refused("INVALID", `An answer holds at most ${TEXT_LIMIT} characters.`)
      }
      selections.push(chosen.length ? chosen.join(", ") : words)
    }
    return { kind: "question", requestId: item.requestId, selections }
  }
  if (item.kind === "permission" && answer.kind === "permission") {
    if (answer.mode === "once" && !item.whole) {
      return refused(
        "INVALID",
        "Not all of what that tool would do can be shown here, so allow it from the session's terminal.",
      )
    }
    return { kind: "permission", mode: answer.mode, requestId: item.requestId }
  }
  if (item.kind === "plan" && answer.kind === "plan") {
    const feedback = answer.feedback ? normalize(answer.feedback) : ""
    if (feedback && answer.mode !== "deny") {
      return refused("INVALID", "A note goes with sending the plan back.")
    }
    if (feedback.length > TEXT_LIMIT) {
      return refused("INVALID", `A note holds at most ${TEXT_LIMIT} characters.`)
    }
    if (answer.mode === "manual" && !item.plan.trim()) {
      return refused(
        "INVALID",
        "That plan came with no text to show, so start it from the session's terminal.",
      )
    }
    if (answer.mode === "manual" && !item.whole) {
      return refused(
        "INVALID",
        "Only part of that plan can be shown here, so start it from the session's terminal.",
      )
    }
    return {
      feedback: feedback || null,
      kind: "plan",
      mode: answer.mode,
      requestId: item.requestId,
    }
  }
  return refused("INVALID", "That answer does not fit the prompt.")
}

// The activity row says what was answered, never with what words: a picker's answer, a plan's note or a tool's command can quote anything.
export function answerSummary(to: string, item: FeedItem, answer: FeedAnswer): string {
  if (item.kind === "question") {
    const n = item.questions.length
    return `Answered ${to}'s picker (${n} question${n > 1 ? "s" : ""})`
  }
  if (item.kind === "permission" && answer.kind === "permission") {
    const tool = item.tool || "a tool"
    return answer.mode === "once"
      ? `Allowed ${to} to run ${tool} once`
      : `Denied ${to}'s request to run ${tool}`
  }
  if (answer.kind === "plan" && answer.mode === "manual") return `Approved ${to}'s plan`
  const note = answer.kind === "plan" && answer.feedback ? normalize(answer.feedback) : ""
  return `Sent back ${to}'s plan${note ? ` with a note of ${note.length} characters` : ""}`
}

// Whether the prompt still waits on that session, or null when the Feed cannot be read.
const waits = async (
  sessionId: string,
  requestId: string,
  deps: AnswerDeps,
): Promise<boolean | null> => {
  try {
    return (feedBySession(await deps.readFeed()).get(sessionId) ?? []).some(
      (item) => item.requestId === requestId,
    )
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const answering = new Set<string>()

// Answers one prompt a live session left in cmux's Feed. cmux reports any reply as delivered, an unknown id included, so the prompt is read as waiting on that session before the reply and read again after it until it has left the Feed. Who may answer is canApprove(); permission and plan answers approve another session's actions, so they go only when PLAYGROUND_APPROVALS_ENABLED is on, judged by the prompt the Feed holds. Throws only when the activity row cannot be written: almost always before the reply, but a failure at the commit comes after it, so the prompt may be answered with no row, as it may when a reply cmux reported failed landed after all (UNCONFIRMED).
export async function answerFeed(
  { actor, answer, approver, requestId, sessionId }: FeedAnswering,
  deps: AnswerDeps = answerDeps,
): Promise<FeedResult> {
  if (!canApprove(approver)) return refused("FORBIDDEN", "Only the owner answers prompts.")
  const off = refused(
    "DISABLED",
    "Answering permission and plan prompts here is off for now: answer it in the session's terminal.",
  )
  if (answer.kind !== "question" && !deps.approvals) return off
  if (answering.has(requestId)) return refused("BUSY", "That prompt is being answered already.")
  answering.add(requestId)
  try {
    let live: Live
    try {
      live = await deps.listLive()
    } catch (error) {
      return refused("CMUX_FAILED", `cmux could not be read: ${messageOf(error)}`)
    }
    const worker = live.workers.find((w) => w.sessionId === sessionId)
    if (!worker) return refused("NOT_FOUND", "That session is not live.")
    const item = worker.feed.find((i) => i.requestId === requestId)
    if (!item) {
      return refused(
        "NOT_PENDING",
        `No such prompt waits on ${worker.name}: it may be answered already.`,
      )
    }
    if (worker.herdr && item.kind !== "question") {
      return refused(
        "TERMINAL_ONLY",
        `The Dashboard answers only a herdr session's pickers: answer this ${item.kind} in ${worker.name}'s terminal.`,
      )
    }
    if (item.kind !== "question" && !deps.approvals) return off
    const built = replyFor(item, answer)
    if ("ok" in built) return built
    const event: ActivityEvent = {
      action: "dashboard.answer",
      actor,
      summary: answerSummary(worker.name, item, answer),
    }
    if (worker.herdr) return await answerHerdr(worker, item, answer, event, deps)
    try {
      await deps.record(event, async () => {
        try {
          await deps.reply(built)
        } catch (error) {
          throw new ReplyFailed(messageOf(error))
        }
      })
    } catch (error) {
      if (!(error instanceof ReplyFailed)) throw error
      // cmux ends a reply that runs past its timeout, so one it reports failed may have landed: the Feed says which.
      const still = await waits(sessionId, requestId, deps)
      return still === false
        ? refused(
            "UNCONFIRMED",
            `cmux reported ${error.message}, yet ${worker.name}'s prompt has left the Feed: the answer may have gone. Look at its terminal.`,
          )
        : refused(
            "CMUX_FAILED",
            `The answer may not have gone through: ${error.message}. Look at ${worker.name}'s terminal before answering again.`,
          )
    }
    let read = false
    for (let i = 0; i < deps.settle.attempts; i++) {
      await sleep(deps.settle.delayMs)
      const still = await waits(sessionId, requestId, deps)
      if (still === false) return { at: deps.now().toISOString(), ok: true }
      if (still === true) read = true
    }
    return read
      ? refused(
          "NOT_TAKEN",
          `cmux took the answer, but ${worker.name}'s prompt still waits: look at its terminal.`,
        )
      : refused(
          "UNCONFIRMED",
          `The answer went, but cmux's Feed could not be read to see it land: look at ${worker.name}'s terminal.`,
        )
  } finally {
    answering.delete(requestId)
  }
}

// Pure: each question of a picker's answer as answerKeys() takes it, in order.
export const asksOf = (item: FeedItem, answer: FeedAnswer): Ask[] =>
  item.kind === "question" && answer.kind === "question"
    ? item.questions.map((question, i) => ({
        choices: answer.answers[i]?.choices ?? [],
        labels: question.options.map((o) => o.label),
        multiSelect: question.multiSelect,
        prompt: question.prompt,
        text: answer.answers[i]?.text ? normalize(answer.answers[i]?.text ?? "") : null,
      }))
    : []

// Answers a herdr session's picker by keys, since herdr 0.9.5 has no call that answers one, and this is the procedure's one full telling: the same answer a cmux session's Feed takes, from the owner's own Submit on the card, past answerFeed()'s guards (canApprove(), one answer a prompt at a time) and replyFor(); a permission or a plan is refused before it (TERMINAL_ONLY). Before the first key it reads the pane and types nothing unless the pane shows the question the card shows, its words over its options (showsAsk() in herdr.ts), and every row the answer needs (NOT_PENDING); the attempt's dashboard.answer row commits before the first key, since a key once typed cannot be taken back; after each question's keys it reads the pane until that question has gone, the next question read from there, then presses Submit answers when the answer ends on that review, and a question still showing reads INTERRUPTED. Own words go as typed text (typeKeys()), since herdr refuses its prompt call while a session is blocked.
async function answerHerdr(
  worker: Worker,
  item: FeedItem,
  answer: FeedAnswer,
  event: ActivityEvent,
  deps: AnswerDeps,
): Promise<FeedResult> {
  const pane = deps.herdr ?? herdrPane
  const surface = worker.surface
  if (!surface) return refused("NOT_FOUND", `herdr names no pane for ${worker.name}.`)
  const look = async (): Promise<ScreenPrompt> => promptOnScreen(await pane.read(surface))
  const asks = asksOf(item, answer)
  let screen: ScreenPrompt
  try {
    screen = await look()
  } catch (error) {
    return refused("CMUX_FAILED", `herdr could not read ${worker.name}'s pane: ${messageOf(error)}`)
  }
  const first = asks[0] ? answerKeys(screen, asks[0]) : null
  if (!first?.ok) {
    return refused(
      "NOT_PENDING",
      `Nothing was typed: ${first?.reason ?? "there is nothing to answer"}. Look at ${worker.name}'s terminal.`,
    )
  }
  await deps.record(event, async () => {})
  const interrupted = (why: string) =>
    refused(
      "INTERRUPTED",
      `Keys went into ${worker.name}'s pane, but ${why}: look at its terminal before answering again.`,
    )
  // The pane after the keys, read until it no longer shows what `shows` reads, or null when it still does, or undefined when it could not be read.
  const settled = async (
    shows: (screen: ScreenPrompt) => boolean,
  ): Promise<ScreenPrompt | null | undefined> => {
    let read = false
    for (let i = 0; i < pane.settle.attempts; i++) {
      await sleep(pane.settle.delayMs)
      try {
        const now = await look()
        read = true
        if (!shows(now)) return now
      } catch {}
    }
    return read ? null : undefined
  }
  let keys = first.keys
  let after: ScreenPrompt | null | undefined
  for (const [i, ask] of asks.entries()) {
    if (i > 0) {
      const next = after
      if (!next) return interrupted("the pane did not move on to the next question")
      const step = answerKeys(next, ask)
      if (!step.ok) return interrupted(step.reason)
      keys = step.keys
    }
    try {
      await pane.type(surface, keys)
    } catch (error) {
      return interrupted(`herdr took some of the keys and refused the rest (${messageOf(error)})`)
    }
    after = await settled((now) => showsAsk(now, ask))
  }
  const submit = after ? submitKeys(after) : null
  if (submit) {
    try {
      await pane.type(surface, submit)
    } catch (error) {
      return interrupted(`herdr refused the key that submits the answers (${messageOf(error)})`)
    }
    after = await settled((now) => submitKeys(now) !== null)
  }
  if (after === undefined) {
    return refused(
      "UNCONFIRMED",
      `The keys went, but ${worker.name}'s pane could not be read to see them land: look at its terminal.`,
    )
  }
  if (after === null) return interrupted("its prompt still shows")
  return { at: deps.now().toISOString(), ok: true }
}
