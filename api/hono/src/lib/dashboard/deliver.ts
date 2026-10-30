import { readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { storedAs } from "@packages/config/console"
import {
  activity,
  db,
  dashboardMessageSummary,
  recordActivity,
  type ActivityActor,
  type ActivityEvent,
} from "@packages/db"
import { and, eq, inArray } from "drizzle-orm"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import {
  ATTACHED_LABEL,
  MAX_ATTACHMENTS,
  withAttachments,
  type Attachment,
} from "@/lib/dashboard/attachments"
import {
  canForce,
  CmuxTimedOut,
  runJson,
  write,
  type Write,
  type WriteKey,
} from "@/lib/dashboard/cmux"
import { configDir, readsLive } from "@/lib/dashboard/fixture"
import { isHerdrSurface, pressEnter, prompt, promptOutcome } from "@/lib/dashboard/herdr"
import { readScreen } from "@/lib/dashboard/terminal"
import { readTail, type Entry } from "@/lib/dashboard/transcript"
import { feedBySession, listLive, listSpace, type Live, type Worker } from "@/lib/dashboard/workers"
import type { ErrorCode } from "@/lib/error"

// What to deliver: `to` is the session's name as the dashboard lists it (Worker.name), `text` is what to say, `attachments` the stored files it carries (findAttachment's, so each path is one the dashboard made), and `actor` is who says it, the signed-in person for a route. `id`, the composer's own for the message, becomes its activity row's id, so a retry of a request that went unanswered finds the message delivered rather than typing it again.
export type Delivery = {
  actor: ActivityActor
  attachments?: Attachment[]
  id?: string
  text: string
  to: string
}

// Why a delivery did not happen. CMUX_FAILED, INPUT_NOT_EMPTY, NOT_FOUND and ON_PICKER come before anything is typed (CMUX_FAILED includes a send cmux refused before its first text, tried twice here), so they can succeed on a retry once the session or cmux changes, but for an INPUT_NOT_EMPTY marked `pasted`, whose message sits unsent in the box for its retry to press Enter on; AMBIGUOUS, COMMAND, EMPTY and TOO_LONG cannot until the text or the names change. INTERRUPTED means typing began and did not finish: some or all of the message may be in the session's input or already sent, so it is never retried without a look at the session first.
export const DELIVERY_FAILURES = [
  "AMBIGUOUS",
  "CMUX_FAILED",
  "COMMAND",
  "EMPTY",
  "INPUT_NOT_EMPTY",
  "INTERRUPTED",
  "NOT_FOUND",
  "ON_PICKER",
  "TOO_LONG",
] as const

export type DeliveryFailure = (typeof DELIVERY_FAILURES)[number]

// How a route reports each refusal: its HTTP status and the API's error code, with the reason's own code under `delivery`.
export const FAILURE_STATUS: Record<DeliveryFailure, [ContentfulStatusCode, ErrorCode]> = {
  AMBIGUOUS: [409, "CONFLICT"],
  CMUX_FAILED: [502, "CMUX_FAILED"],
  COMMAND: [400, "VALIDATION_ERROR"],
  EMPTY: [400, "VALIDATION_ERROR"],
  INPUT_NOT_EMPTY: [409, "CONFLICT"],
  INTERRUPTED: [502, "CMUX_FAILED"],
  NOT_FOUND: [404, "NOT_FOUND"],
  ON_PICKER: [409, "CONFLICT"],
  TOO_LONG: [400, "VALIDATION_ERROR"],
}

// `at` is when the delivery finished, its Enter typed and its activity row written (for a retry answered by its row, when that row's transaction began, and `replayed` set); `reason` is a sentence to show as it is. `pasted` marks an INPUT_NOT_EMPTY whose message sits pasted and unsent in the box, which its retry presses Enter on, so a thread it opened is kept for that retry.
export type DeliveryResult =
  | { at: string; ok: true; replayed?: true; sessionId: string }
  | { code: DeliveryFailure; ok: false; pasted?: true; reason: string }

export const MAX_CHARS = 8000
export const MAX_LINES = 100
// Every keystroke is one cmux call of about 30ms inside an open transaction, and a text dense with \n, \r or \t splits into many, so the count is capped as well as the size.
export const MAX_KEYSTROKES = 400

type Step = { key: WriteKey } | { text: string }

// A tab would autocomplete and a control character is a keystroke, so the text arrives with tabs as four spaces, line ends as \n and no other control character (C0, DEL or C1), trimmed.
export const normalize = (text: string): string =>
  [...text.replace(/\r\n?/g, "\n").replaceAll("\t", "    ")]
    .filter((ch) => ch === "\n" || !/\p{Cc}/u.test(ch))
    .join("")
    .trim()

type Refusal = Extract<DeliveryResult, { ok: false }>

const refused = (code: DeliveryFailure, reason: string): Refusal => ({
  code,
  ok: false,
  reason,
})

// A leading / runs a slash command and a leading ! a shell command, in a session that bypasses permission prompts; invisible characters before one (a zero-width space, a word joiner) could be dropped on the way, so they are looked past.
export const COMMAND_START = /^[\p{Cf}\p{Z}\s]*[/!]/u

// A skill's command, as Claude Code takes it: a / at the very start, then a skill folder's name, then a space, a new line or the end. Anything else after the / (a capital, a dot, a slash, an invisible character) is no skill's name.
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
const SKILL_COMMAND = /^\/([a-z0-9][a-z0-9-]*)(?=[ \n]|$)/

// The skill a message would run, or null when it is not one skill's command.
export const skillCommand = (text: string): string | null => SKILL_COMMAND.exec(text)?.[1] ?? null

const commandRefusal = (skill?: string): Refusal =>
  refused(
    "COMMAND",
    skill
      ? `/${skill} is not a skill this session can run, and any other / or ! would run as a command in the session, so it is not typed.`
      : "A message starting with / or ! would run as a command in the session, so it is not typed.",
  )

// What the dashboard will not type, judged on the normalized text; `files` is how many attachments come with it, since files alone are something to send. With `skillLater`, a skill's command passes, for deliver() to check against the session's own skills once it is found; every other command is refused.
export const refusal = (text: string, files = 0, skillLater = false): Refusal | null => {
  if (!text && !files) return refused("EMPTY", "There is nothing to send.")
  if (files > MAX_ATTACHMENTS) {
    return refused("TOO_LONG", `A message carries at most ${MAX_ATTACHMENTS} files.`)
  }
  if (text.length > MAX_CHARS) {
    return refused("TOO_LONG", `A message holds at most ${MAX_CHARS} characters.`)
  }
  if (text.split("\n").length > MAX_LINES) {
    return refused("TOO_LONG", `A message holds at most ${MAX_LINES} lines.`)
  }
  if (COMMAND_START.test(text) && !(skillLater && skillCommand(text))) {
    return commandRefusal()
  }
  return null
}

// The skills a person may run as a command, from each folder given: a folder named as a skill is, holding a SKILL.md that resolves (through a symlink too) to a regular file whose frontmatter reads and does not say `user-invocable: false`. A message's words never become a path here: they are only looked up in what is read.
export async function readSkills(dirs: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => [])
    for (const name of names) {
      if (!SKILL_NAME.test(name)) continue
      try {
        const file = await realpath(join(dir, name, "SKILL.md"))
        if (!(await stat(file)).isFile()) continue
        const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(await Bun.file(file).text())
        if (!front) continue
        const meta: unknown = Bun.YAML.parse(front[1] ?? "")
        if (typeof meta !== "object" || meta === null) continue
        if ((meta as Record<string, unknown>)["user-invocable"] === false) continue
        found.add(name)
      } catch {
        continue
      }
    }
  }
  return found
}

// Where a session's skills live: Claude Code's own skills folder, and the session's project's when its cwd is known, since an empty or relative one would name a folder of the API's own. A fixture's cwds are made up, so a stack that does not read this machine reads its config folder alone.
export const skillDirs = (cwd: string, config: string, live: boolean): string[] => [
  join(config, "skills"),
  ...(live && isAbsolute(cwd) ? [join(cwd, ".claude", "skills")] : []),
]

// The skills a session may run as a command: what deliver() checks a / against, and what the composer's / menu offers.
export const sessionSkills = (cwd: string): Promise<Set<string>> =>
  readSkills(skillDirs(cwd, configDir(), readsLive()))

// `cmux send` reads \n, \r and \t inside its text as keystrokes, so a line is cut after every backslash that precedes one of those letters: sent apart, each half arrives literally.
export const pieces = (line: string): string[] => {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === "\\" && /[nrt]/.test(line[i + 1] ?? "")) {
      out.push(line.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < line.length) out.push(line.slice(start))
  return out
}

// Typed the way Claude Code's input takes a message: each line's text, Shift+Enter between lines for a newline that does not submit, then Enter. cmux 0.64's send has no paste, so a newline in its text would submit.
export const keystrokes = (text: string): Step[] => [
  ...text
    .split("\n")
    .flatMap((line, i): Step[] => [
      ...(i > 0 ? [{ key: "shift+enter" as const }] : []),
      ...pieces(line).map((piece) => ({ text: piece })),
    ]),
  { key: "enter" },
]

const RULE = /^─+$/
const NAMED_RULE = /^─.*─$/
// While messages wait in its queue, Claude Code fills its empty box with one of these dim hints (its prompt input's placeholder, 2.1.309) and draws the messages themselves above the box; read-screen drops the dimming, so a hint is matched whole.
const QUEUED_HINTS = new Set([
  "Press up to edit queued messages",
  "Press up to edit queued messages, Enter to send them immediately",
  "Press up to select a queued message to edit, or Enter to send them now",
  "Press up to select a queued message, then Enter to edit it",
])

// Text as one line, every run of spaces (a no-break one and a line end too) one space, so a box wrapped in a narrow pane reads as its words.
const flat = (text: string): string => text.replace(/\s+/g, " ").trim()

// The box's words after its ❯ prompt, or null when it does not open on one (shell mode's !).
const boxWords = (box: string[]): string | null =>
  box[0]?.startsWith("❯") ? flat(box.join(" ").slice(1)) : null

// A queue hint as a pane narrower than it draws it, cut off at the edge with an ellipsis (an 18-column pane drew "Press up to edi…" after every send to it while busy).
const cutHint = (box: string[], words: string): boolean =>
  box.length === 1 &&
  words.length > 1 &&
  words.endsWith("…") &&
  [...QUEUED_HINTS].some((hint) => hint.startsWith(words.slice(0, -1).trimEnd()))

// What a session's input box holds, as read-screen shows it between the last two rules on the screen: only its ❯ prompt or a queue hint (empty), anything more (a draft, which would be sent with the message, a ! or an open / menu, which would run it, or a picker framed by rules, which ON_PICKER normally catches first), or no rules to frame a box at all (missing: a Claude Code whose layout has changed).
export const inputState = (screen: string): "empty" | "holds" | "missing" => {
  const box = inputBox(screen)
  if (!box) return "missing"
  const words = boxWords(box)
  if (words === null) return "holds"
  return (box.length === 1 && words === "") || QUEUED_HINTS.has(words) || cutHint(box, words)
    ? "empty"
    : "holds"
}

const IMAGE_MARK = /\[Image #\d+\]/g
// Claude Code 2.1.309 folds a paste of more characters than this, or more than 2 line breaks
const FOLD_CHARS = 800

// Pure: whether the box holds this message whole and unsent, as Claude Code draws a paste of it: each image's path taken in as an [Image #n] mark, one per image, and nothing more or less, or the [Pasted text #n +k lines] a long paste folds into beside those marks, whose k counts the paste's line breaks, for a paste long enough to fold. Anything else in it is someone's draft.
export const holdsUnsent = (screen: string, text: string, images: string[]): boolean => {
  const box = inputBox(screen)
  const words = box ? boxWords(box) : null
  if (!words || (words.match(IMAGE_MARK) ?? []).length !== images.length) return false
  const left = flat(words.replace(IMAGE_MARK, " "))
  const fold = /^\[Pasted text #\d+(?: \+(\d+) lines)?\]$/.exec(left)
  const breaks = (text.match(/\n/g) ?? []).length
  if (fold) return (text.length > FOLD_CHARS || breaks > 2) && Number(fold[1] ?? 0) === breaks
  const pasted = images.reduce((rest, path) => rest.replace(path, ""), text)
  return left === flat(pasted)
}

// How a herdr session's box is read after the send: up to 8 reads 150ms apart, 1.2s in all, the first after one gap, so Claude Code has drawn the paste or taken the Enter.
export const SETTLE_GAP_MS = 150
export const SETTLE_READS = 8

// The lines between the last two rules on the screen, or null when no rules frame a box.
const inputBox = (screen: string): string[] | null => {
  const lines = screen.split("\n").map((line) => line.trimEnd())
  const bottom = lines.findLastIndex((line) => RULE.test(line))
  const top = lines.findLastIndex((line, i) => i < bottom && NAMED_RULE.test(line))
  return bottom < 1 || top < 0 ? null : lines.slice(top + 1, bottom)
}

// Pure: whether the input box starts as this message does, as Claude Code draws a paste: its first line (cut at the screen's edge), or the [Pasted text #n] or [Image #n] it folds a long paste or an image's path into.
export const holdsMessage = (screen: string, text: string): boolean => {
  const box = inputBox(screen)
  const first = (box?.[0] ?? "").replace(/^❯\s*/, "").trim()
  if (!box || !first) return false
  if (/^\[(?:Pasted text|Image) #\d+/.test(boxWords(box) ?? first)) return true
  const start =
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  return start !== "" && (start.startsWith(first) || first.startsWith(start))
}

// `board` finds the session a name names, from the board the dashboard already streams; `readSession` reads that one session again from cmux before it is typed into, and before the Enter. `canForce` says whether cmux's send takes --force, and `prompts` lists the requests the session has pending in cmux's Feed. `prompt` sends a herdr session its whole message in one call, and `pressEnter` one Enter when that call's own did not land (herdr.ts); `wait` sleeps between the reads of its box after the send, and `said` reads a session's transcript, its tail as readTail bounds it.
export type DeliverDeps = {
  board: () => Promise<Live>
  canForce: () => Promise<boolean>
  delivered: (id: string) => Promise<Date | null>
  now: () => Date
  pressEnter: (surface: string) => Promise<void>
  prompt: (surface: string, text: string) => Promise<void>
  prompts: (sessionId: string) => Promise<string[]>
  readScreen: (surface: string) => Promise<string>
  readSession: (worker: Worker) => Promise<Live>
  record: (event: ActivityEvent, typing: () => Promise<void>) => Promise<void>
  said: (worker: Worker) => Promise<Entry[]>
  skills: (cwd: string) => Promise<ReadonlySet<string>>
  wait: (ms: number) => Promise<void>
  write: (step: Write) => Promise<void>
}

// The record and the typing share a transaction: a keystroke cmux refuses rolls the record back, and a record that cannot be inserted means nothing is typed.
const recordWhileTyping: DeliverDeps["record"] = (event, typing) =>
  db.transaction(async (tx) => {
    await recordActivity(tx, event)
    await typing()
  })

// When the message with this id was recorded, if it was: its row commits with its Enter, so a row means the message went.
const deliveredAt: DeliverDeps["delivered"] = async (id) => {
  const [row] = await db
    .select({ at: activity.createdAt })
    .from(activity)
    .where(and(eq(activity.id, id), inArray(activity.action, storedAs("dashboard.message"))))
  return row?.at ?? null
}

export const deliverDeps: DeliverDeps = {
  // The hub's newest board, without waiting on a refresh in flight; hub.ts imports this module through sdk.ts, so it is loaded when first needed
  board: async () => (await import("@/lib/dashboard/hub")).dashboardHub.snapshot ?? listLive(),
  canForce,
  delivered: deliveredAt,
  now: () => new Date(),
  pressEnter,
  prompt,
  prompts: async (sessionId) =>
    (
      feedBySession(await runJson(["rpc", "feed.list", '{"pending_only":true}'])).get(sessionId) ??
      []
    ).map((item) => item.requestId),
  readScreen: (surface) => readScreen(surface, 40),
  readSession: listSpace,
  record: recordWhileTyping,
  said: async (worker) => {
    const path = (await listSpace(worker)).transcripts.get(worker.sessionId)
    return path ? readTail(path, Number.POSITIVE_INFINITY) : []
  },
  skills: sessionSkills,
  wait: (ms) => Bun.sleep(ms),
  write,
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// `timedOut`: a send of the message was killed at cmux's timeout, so its text may have landed although it reported failure. A read of the Feed that times out typed nothing, so it does not count (`sent` is false for it).
class TypingFailed extends Error {
  readonly timedOut: boolean
  constructor(
    readonly typed: number,
    readonly atEnter: boolean,
    cause: unknown,
    sent: boolean,
  ) {
    super(messageOf(cause))
    this.timedOut = sent && cause instanceof CmuxTimedOut
  }
}

// Where typing stood when it stopped: `nothing` before the first text, or `held` when the refusal's reason already says where the message stands (both stand as they are), `part` after some of the message was typed, `typed` once all of it was but not the Enter.
class TypingStopped extends Error {
  constructor(
    readonly result: Refusal,
    readonly stood: "held" | "nothing" | "part" | "typed" = "typed",
  ) {
    super(result.reason)
  }
}

// A first send failed without being killed at cmux's timeout, so nothing was typed, and a later try can pass.
class BeforeTyping {
  constructor(readonly message: string) {}
}

// Two deliveries to one session would interleave their keystrokes, so each session's deliveries run one at a time, from reading it to its Enter. The queue is this process's own: a second dashboard stack (a worktree's test stack beside the live dashboard) types into the same surface independently.
const typingLines = new Map<string, Promise<unknown>>()

// The dashboard's own last pastes into each herdr session, newest last: a later try that finds one unsent in the box (its Enter lost, though its own settle read the box empty before the paste was drawn) presses Enter on it rather than reading it as a draft. `unsent` holds the ids a try left pasted and unsent until one is delivered, so their retry that finds the box empty never pastes them twice. Both are this process's own, as typingLines is, so a restart forgets them.
export type Paste = { at: number; id?: string; images: string[]; text: string }
// A transcript's clock and the API's can differ by a moment.
const SAID_SLACK_MS = 5000

// Pure: whether the session's transcript shows the paste went, a person's message since it opening on its first line of words (or, for files alone, carrying files): true, and a box holding it again is the owner's recall (Up brings an earlier message back), never the dashboard's unsent paste; false only when the entries read reach back past the paste and none is it; null when they do not reach back that far, so whether it went is not known.
export const wentIn = (entries: Entry[], paste: Paste): boolean | null => {
  const since = paste.at - SAID_SLACK_MS
  const first = flat(
    paste.text.split("\n").find((line) => line.trim() && !line.startsWith(ATTACHED_LABEL)) ?? "",
  )
  const went = entries.some(
    (entry) =>
      entry.kind === "human" &&
      Date.parse(entry.at) >= since &&
      (first
        ? flat(entry.text.replace(IMAGE_MARK, " ")).startsWith(first)
        : (entry.attachments?.length ?? 0) > 0),
  )
  if (went) return true
  const oldest = entries[0]
  return oldest && Date.parse(oldest.at) <= since ? false : null
}
const PASTES_KEPT = 5
const pastes = new Map<string, Paste[]>()
const unsent = new Set<string>()

const oneAtATime = <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const next = (typingLines.get(key) ?? Promise.resolve()).then(work, work)
  const settled = next.catch(() => {})
  typingLines.set(key, settled)
  void settled.then(() => {
    if (typingLines.get(key) === settled) typingLines.delete(key)
  })
  return next
}

// The live sessions a name reaches, and the one a message to it goes to. Of two or more named for the dispatcher, the read has already given the role to the oldest alone (workers.ts), so that one; any other name reaches its one session, or none when two share it.
function reached(workers: Worker[], to: string): { count: number; worker: Worker | undefined } {
  const named = workers.filter((w) => w.name === to)
  const worker =
    named.find((w) => w.role === "dispatcher") ?? (named.length === 1 ? named[0] : undefined)
  return { count: named.length, worker }
}

// A retry of a message already recorded under its id, answered from its row: the session is found by name alone, as a send finds it, so one now on a picker still answers it, while an ended or doubled name leaves it to the usual refusals.
async function recorded(delivery: Delivery, deps: DeliverDeps): Promise<DeliveryResult | null> {
  const at = delivery.id ? await deps.delivered(delivery.id) : null
  if (!at) return null
  let live: Live
  try {
    live = await deps.board()
  } catch {
    return null
  }
  const { worker } = reached(live.workers, delivery.to)
  return worker
    ? { at: at.toISOString(), ok: true, replayed: true, sessionId: worker.sessionId }
    : null
}

type Target = { surface: string; worker: Worker }

// The named session as the read shows it, or why it cannot take a message.
async function target(to: string, read: () => Promise<Live>): Promise<Refusal | Target> {
  let live: Live
  try {
    live = await read()
  } catch (error) {
    return refused("CMUX_FAILED", `Could not read cmux: ${messageOf(error)}`)
  }
  const { count, worker } = reached(live.workers, to)
  if (!count) return refused("NOT_FOUND", `No live session is named ${to}.`)
  if (!worker) return refused("AMBIGUOUS", `${count} live sessions are named ${to}.`)
  if (worker.light === "needs-you") {
    return refused(
      "ON_PICKER",
      `${worker.name} is waiting on a picker or a prompt. Answer that first: typing now would answer it instead.`,
    )
  }
  const surface = live.surfaces.get(worker.sessionId)
  if (!surface) return refused("NOT_FOUND", `${worker.name} has no terminal to type into.`)
  return { surface, worker }
}

// The one way the dashboard tells a live session something, as if the owner typed it into the session's own terminal: the composer and the inbox's answers call it, and nothing else may, since nothing sends a message on the owner's behalf. It returns a refusal or a failure rather than throwing. It throws only when the activity row cannot be written: almost always on the insert, before anything is typed, but a failure at the commit comes after the Enter, so the message has gone with no row to record it. It sees a prompt cmux's Feed shows raised between two sends, but neither it nor any check here can see one raised during a single send, a key the owner presses in that terminal, or another dashboard stack typing.
export async function deliver(
  delivery: Delivery,
  deps: DeliverDeps = deliverDeps,
): Promise<DeliveryResult> {
  const attachments = delivery.attachments ?? []
  const words = normalize(delivery.text)
  // The person's own words are judged, so a leading / or ! is a command whether or not files come with it, and the caps count only what they wrote; the files' Attached lines come on top, at most MAX_ATTACHMENTS of them, and the keystroke cap below still bounds the whole. A skill's command waits for the session's own skills, read once it is found.
  const skill = skillCommand(words)
  const refusedText = refusal(words, attachments.length, true)
  if (refusedText) return refusedText
  const text = withAttachments(words, attachments)
  const images = attachments.filter((file) => file.kind === "image").map((file) => file.path)
  // A paste is this message's when it carries this id, or, for a message with none, these words.
  const isThis = (paste: Paste): boolean =>
    paste.id === delivery.id && (paste.id !== undefined || paste.text === text)
  const steps = keystrokes(text)
  if (steps.length > MAX_KEYSTROKES) {
    return refused(
      "TOO_LONG",
      "The message has too many lines and backslashes before n, r or t to type in one go.",
    )
  }
  const answered = await recorded(delivery, deps)
  if (answered) return answered
  const first = await target(delivery.to, deps.board)
  if (!("worker" in first)) return first
  const { sessionId } = first.worker
  const herdr = isHerdrSurface(first.surface)
  // Only the session found is read again: the board may be a moment old, so what cmux says of that one session decides.
  const own = () => deps.readSession(first.worker)
  return oneAtATime(sessionId, async () => {
    // Behind the session's line, so a retry that arrives while its first try is still typing reads the row that try commits.
    const at = delivery.id ? await deps.delivered(delivery.id) : null
    if (at) return { at: at.toISOString(), ok: true, replayed: true, sessionId }
    // cmux 0.65's draft guard can refuse a send whose input deliver's own screen read just proved holds no draft (Claude Code's queued-messages hint and a mid-turn prompt line read as empty by design), so every text send passes --force where this cmux has it, the first included. --force skips the guard's dialog check too, so the session's Feed is read first of all, before the session and its screen, and kept across every try: a prompt raised after it, in any gap, stops the typing. A cmux with no --force reads the Feed only for a message of several sends, as before, since a later line could land in a prompt raised meanwhile.
    let force: boolean
    let watching: boolean
    let pending: Set<string>
    const several = steps.filter((step) => "text" in step).length > 1
    try {
      // herdr sends a message as one call that it refuses while the session waits on a prompt (agent_blocked), so it needs neither cmux's --force nor its Feed
      force = herdr ? false : await deps.canForce()
      watching = !herdr && (force || several)
      pending = watching ? new Set(await deps.prompts(sessionId)) : new Set()
    } catch (error) {
      return refused("CMUX_FAILED", `Could not read cmux: ${messageOf(error)}`)
    }
    const found = await target(delivery.to, own)
    if (!("worker" in found)) return found
    if (found.worker.sessionId !== sessionId) {
      return refused("NOT_FOUND", `${delivery.to} now names another session. Send it again.`)
    }
    const { surface, worker } = found
    if (skill && !(await deps.skills(worker.cwd)).has(skill)) return commandRefusal(skill)
    const event: ActivityEvent = {
      action: "dashboard.message",
      actor: delivery.actor,
      id: delivery.id,
      summary: dashboardMessageSummary(
        worker.name,
        words,
        attachments.map((file) => file.size),
      ),
    }
    // One try, from reading the screen to the Enter. A first send that fails without being killed at cmux's timeout typed nothing and comes back as BeforeTyping, which the loop below tries once more at once, since the screen is read again and finds anything that landed after all.
    const attempt = async (): Promise<DeliveryResult | BeforeTyping> => {
      let screen: string
      try {
        screen = await deps.readScreen(surface)
      } catch (error) {
        return refused(
          "CMUX_FAILED",
          `Could not read ${worker.name}'s terminal: ${messageOf(error)}`,
        )
      }
      const input = inputState(screen)
      // A message an earlier try left unsent that has left the box since went by a late Enter or the owner's own, or was cleared by hand; either way it is never pasted twice.
      if (delivery.id && unsent.has(delivery.id) && input === "empty") {
        await deps.record(event, async () => {})
        return { at: deps.now().toISOString(), ok: true, sessionId }
      }
      // A paste of the dashboard's own that its Enter left in the box, this message's or an earlier one's, gets that Enter rather than reading as a draft; any other text in the box is someone's. Claude Code folds a long paste into [Pasted text #n +k lines], which is taken as a paste whose line breaks k counts.
      const held =
        herdr && input === "holds"
          ? (pastes.get(sessionId) ?? []).findLast((paste) =>
              holdsUnsent(screen, paste.text, paste.images),
            )
          : undefined
      // one the transcript shows went, or cannot show did not, is the owner's recall of it or may be, so it holds as a draft
      let stuck = held
      if (held) {
        try {
          if (wentIn(await deps.said(worker), held) !== false) stuck = undefined
        } catch {
          stuck = undefined
        }
      }
      if (input === "holds" && !stuck) {
        return refused(
          "INPUT_NOT_EMPTY",
          `${worker.name}'s input already holds something, or a picker covers it: a draft, or a ! or / waiting for a command. Clear it in its terminal first, since anything typed now would join it.`,
        )
      }
      if (input === "missing") {
        return refused(
          "INPUT_NOT_EMPTY",
          `Cannot find ${worker.name}'s input box on its screen: something covers it, or Claude Code's layout has changed. Look at its terminal before sending again.`,
        )
      }
      // herdr pastes the message and then presses Enter, and Claude Code can still be taking a pasted image's path in when the Enter comes, so the Enter is lost and the message sits in the box. So the box is read after the send: empty, it went; holding this message, it gets one more Enter and is read again; holding it still, or holding text that does not start as it does, it is typed but not submitted, and no client retries it unseen, but for a message with an id still holding it, which waits as INPUT_NOT_EMPTY for its retry's Enter. The box read empty just before the send, so what it holds then is this message unless someone typed into it meanwhile. After a prompt that failed as typed (`lost`), an empty box cannot tell a message that went from one never pasted, so it stays interrupted, and the outbox reads it delivered once the transcript holds it.
      // The box after a send: its first empty read, else its last.
      const settled = async (at: string, lost: unknown): Promise<string> => {
        let after = ""
        for (let i = 0; i < SETTLE_READS; i++) {
          await deps.wait(SETTLE_GAP_MS)
          try {
            after = await deps.readScreen(at)
          } catch (error) {
            throw new TypingFailed(1, true, lost ?? error, false)
          }
          if (inputState(after) === "empty") break
        }
        return after
      }
      // A box with no message of ours in it: no Enter goes into text that is not ours.
      const unseen = (after: string): TypingStopped =>
        new TypingStopped(
          refused(
            "INTERRUPTED",
            inputState(after) === "missing"
              ? `Cannot find ${worker.name}'s input box after the send, so whether the message went is not known. Look at its terminal before sending again.`
              : `${worker.name}'s input holds text that does not start as the message does, so no Enter was pressed: the message may be typed but not submitted. Look at its terminal before sending again.`,
          ),
          "held",
        )
      // `sent` is the paste the box should hold, and `own` whether it is this message's, whose Enter left unsent is this message's to retry.
      const submitted = async (
        at: string,
        lost: unknown,
        sent = text,
        own = true,
      ): Promise<void> => {
        const first = await settled(at, lost)
        if (inputState(first) === "empty") {
          if (lost) throw new TypingFailed(1, true, lost, false)
          return
        }
        if (!holdsMessage(first, sent)) throw unseen(first)
        try {
          await deps.pressEnter(at)
        } catch (error) {
          throw new TypingFailed(1, true, error, false)
        }
        const second = await settled(at, lost)
        if (inputState(second) === "empty") return
        if (!holdsMessage(second, sent)) throw unseen(second)
        // With an id the outbox tries it again on its own, and that try presses Enter on it, so it waits queued rather than failing in front of the owner.
        if (own && delivery.id) {
          unsent.add(delivery.id)
          throw new TypingStopped(
            {
              ...refused(
                "INPUT_NOT_EMPTY",
                `The message sits unsent in ${worker.name}'s input after one more Enter, so the next try presses Enter on it again.`,
              ),
              pasted: true,
            },
            "held",
          )
        }
        throw new TypingStopped(
          refused(
            "INTERRUPTED",
            `The message is typed but not submitted: ${worker.name}'s input still holds it after one more Enter. Look at its terminal before sending again.`,
          ),
          "held",
        )
      }
      try {
        await deps.record(event, async () => {
          if (herdr) {
            // read once more before the send: a herdr pane's id changes when it moves, so this read names where the session is now
            const again = await target(delivery.to, own)
            if (!("worker" in again)) throw new TypingStopped(again, "nothing")
            if (again.worker.sessionId !== sessionId) {
              throw new TypingStopped(
                refused("NOT_FOUND", `${delivery.to} now names another session. Send it again.`),
                "nothing",
              )
            }
            if (stuck && isThis(stuck)) {
              await submitted(again.surface, null)
              pastes.set(
                sessionId,
                (pastes.get(sessionId) ?? []).filter((paste) => paste !== stuck),
              )
              return
            }
            if (stuck) {
              try {
                await submitted(again.surface, null, stuck.text, false)
              } catch (error) {
                if (!(error instanceof TypingStopped || error instanceof TypingFailed)) throw error
                throw new TypingStopped(
                  refused(
                    "INPUT_NOT_EMPTY",
                    `${worker.name}'s input still holds an earlier message from here after its Enter, so this one waits.`,
                  ),
                  "nothing",
                )
              }
              const left = (pastes.get(sessionId) ?? []).filter((paste) => paste !== stuck)
              pastes.set(sessionId, left)
            }
            const at = deps.now().getTime()
            let lost: unknown = null
            try {
              await deps.prompt(again.surface, text)
            } catch (error) {
              const outcome = promptOutcome(error)
              if (outcome === "picker") {
                throw new TypingStopped(
                  refused(
                    "ON_PICKER",
                    `${worker.name} is waiting on a picker or a prompt, and herdr sent nothing. Answer that first.`,
                  ),
                  "nothing",
                )
              }
              if (outcome === "gone") {
                throw new TypingStopped(
                  refused(
                    "NOT_FOUND",
                    `${worker.name}'s Claude is not running in its pane any more.`,
                  ),
                  "nothing",
                )
              }
              // typed: herdr may have pasted it, or pasted it and pressed Enter, before the answer was lost, so the box decides below; unsent: herdr refused before sending anything
              if (outcome !== "typed") throw new TypingFailed(0, false, error, false)
              lost = error
            }
            // herdr took the paste, or may have, so it is remembered for a later try to find
            const kept = (pastes.get(sessionId) ?? []).filter((paste) => !isThis(paste))
            pastes.set(
              sessionId,
              [...kept, { at, id: delivery.id, images, text }].slice(-PASTES_KEPT),
            )
            await submitted(again.surface, lost)
            return
          }
          let begun = false
          for (const [i, step] of steps.entries()) {
            const atEnter = i === steps.length - 1
            // Enter is the keystroke that would confirm a picker, so the session is read once more before it.
            if (atEnter) {
              const again = await target(delivery.to, own)
              if (!("worker" in again)) throw new TypingStopped(again)
            }
            const text = "text" in step
            try {
              // A prompt raised since the Feed was read would take the next send; the first send of a cmux with no --force has no dialog check to skip, so it is not held for one.
              if (text && watching && (force || begun)) {
                let raised: boolean
                try {
                  raised = (await deps.prompts(sessionId)).some((id) => !pending.has(id))
                } catch (error) {
                  throw new TypingFailed(i, atEnter, error, false)
                }
                if (raised) {
                  const reason = begun
                    ? `${worker.name} raised a prompt while the message was typed, and the rest would have gone into it.`
                    : `${worker.name} raised a prompt, and the message would have gone into it. Nothing was typed.`
                  throw new TypingStopped(refused("ON_PICKER", reason), begun ? "part" : "nothing")
                }
              }
              await deps.write(text && force ? { ...step, force, surface } : { ...step, surface })
            } catch (error) {
              if (error instanceof TypingStopped || error instanceof TypingFailed) throw error
              throw new TypingFailed(i, atEnter, error, true)
            }
            begun ||= text
          }
        })
      } catch (error) {
        if (error instanceof TypingStopped) {
          if (error.stood === "nothing" || error.stood === "held") return error.result
          const left =
            error.stood === "part"
              ? `Part of it sits unsent in ${worker.name}'s input.`
              : `The message is typed but not sent: it sits in ${worker.name}'s input.`
          return refused("INTERRUPTED", `${error.result.reason} ${left}`)
        }
        if (!(error instanceof TypingFailed)) throw error
        // Any first send that fails without being killed at cmux's timeout typed nothing and is tried again: a send killed at its timeout may have landed after all, so it stays INTERRUPTED, which no client retries unseen.
        if (error.typed === 0 && !error.atEnter && !error.timedOut) {
          return new BeforeTyping(error.message)
        }
        const left = error.atEnter
          ? ` The Enter may have gone through anyway: check ${worker.name}'s terminal before sending again.`
          : error.typed > 0
            ? ` Part of it may sit unsent in ${worker.name}'s input.`
            : ""
        return refused("INTERRUPTED", `The message did not go through: ${error.message}${left}`)
      }
      return { at: deps.now().toISOString(), ok: true, sessionId: worker.sessionId }
    }
    // A message can get lost: a first send that fails without being killed at cmux's timeout typed nothing, so deliver tries it once more at once and then the outbox retries it, on its own schedule for CMUX_FAILED, so it reaches the red bubble only after both; each such try is logged with the failure's own words. A timeout is never retried here and is not logged (INTERRUPTED), since the text may have landed.
    let refusedBeforeTyping = ""
    for (const i of [0, 1]) {
      const result = await attempt()
      if (!(result instanceof BeforeTyping)) {
        if (delivery.id && result.ok) unsent.delete(delivery.id)
        return result
      }
      refusedBeforeTyping = result.message
      console.warn(
        `Dashboard message to ${worker.name} not sent (try ${i + 1} of 2): ${herdr ? "herdr" : "the terminal"} failed before anything was typed: ${result.message}${i === 0 ? "; trying again" : ""}`,
      )
    }
    return refused("CMUX_FAILED", `The message did not go through: ${refusedBeforeTyping}`)
  })
}
