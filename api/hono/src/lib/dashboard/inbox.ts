import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ActivityActor, Database } from "@packages/db"
import { inboxItem, thread } from "@packages/db"
import { dataDir } from "@packages/env/data-dir"
import { extensionsDir, slackSettings } from "@packages/settings"
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"

import { ID_PATTERN } from "./attachments"

// Playground's Inbox: what the factory posts for the owner, one row of inbox_item each, through the bun run ask CLI alone. A decision previews exactly what Approve does, a draft is a Slack message or Linear comment to send, and an update is an outcome to read. The dashboard records his answer and types it into the posting session through deliver(); the dashboard itself never sends, merges or files anything. Nothing here imports the API's env or an @/ path, so the CLI runs from any shell and the web reads its types.

const LIMITS = { line: 200, name: 120, prs: 50, text: 4000 }

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), "Must be one line")

const words = z.string().trim().min(1).max(LIMITS.text)

// A Slack link reaches the owner in the app form they open, never the archives form; slack.linkConverter names the command that rewrites one, and slack.sendServer the MCP server a send goes through, each read from the extensions' policy when a message is made, "" when unset or unreadable.
const ARCHIVES = /\b(?:[a-z0-9-]+\.)?slack\.com\/archives\//i
const slack = (key: "slack.linkConverter" | "slack.sendServer"): string => {
  try {
    const policy = JSON.parse(readFileSync(join(extensionsDir(dataDir()), "policy.json"), "utf8"))
    return slackSettings.get({ schemaVersion: 1, values: policy.values ?? {} }, key)
  } catch {
    return ""
  }
}
const archivesMessage = (): string => {
  const converter = slack("slack.linkConverter")
  return `A Slack link goes in its app form (https://app.slack.com/client/...), never .../archives/...${converter ? `; rewrite it with ${converter}` : ""}`
}

// A mention reaches the owner as a name they read, never Slack's raw token: a user, a user group, a channel, or @here, @channel or @everyone.
const MENTION_TOKEN =
  /<(?:@[UW][A-Z0-9]+|#C[A-Z0-9]+|!subteam\^[A-Z0-9]+|!(?:here|channel|everyone))(?:\|[^>]*)?>/
const MENTION_MESSAGE =
  "A raw Slack mention token (<@U...>, <!subteam^...>, <!here>, <#C...>) is refused: write mentions as readable names (@name, @team-name); the poster resolves IDs when posting"

// A draft, or a slack decision, speaks in the owner's own voice, and the owner's rule is first person singular: I, never we, us, our, ours or ourselves. The all-caps US is the country, not the pronoun, so it alone passes.
const OWNER_VOICE = /\b(?:ourselves|ours|our|we|us)\b/gi
const OWNER_VOICE_MESSAGE =
  "A draft, or a slack decision, speaks in the owner's voice, and the owner's rule is first person singular: I, never we, us, our, ours or ourselves (code, quoted words, US the country and hyphenated names like us-east-1 aside)"

// Pure: the first owner's-voice word a text holds outside fenced and inline code, double-quoted spans and blockquote lines, since those are someone else's words; a link (bare, or Slack's <url|label>) is an address, not a voice. Null when none.
const ownerVoiceWord = (text: string): string | null => {
  const clean = text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/^[ \t]*>.*$/gm, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/<[^<>|]+\|[^<>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
  for (const match of clean.matchAll(OWNER_VOICE)) {
    if (match[0] === "US") continue
    // a hyphen right after reads as a compound's half, us-east-1, not the pronoun
    if (clean[(match.index ?? 0) + match[0].length] === "-") continue
    return match[0]
  }
  return null
}

// An ask that has the owner quit, restart, close or stop something names what its poster found still depending on it: any form of the four verbs, but a past form after after, since, because or while, a determiner and one word ("after the dashboard restarted").
const TAKES_DOWN =
  /\b(?:quit(?:s|ting)?|restart(?:s|ed|ing)?|clos(?:e|es|ed|ing)|stop(?:s|ped|ping)?)\b/i
const PASSING_MENTION =
  /\b(?:after|since|because|while)\s+(?:the|a|an|its|their|this|that)\s+[\w'-]+\s+(?:quit|restarted|closed|stopped)\b/gi
const TAKES_DOWN_MESSAGE =
  'An ask to quit, restart, close or stop something carries preview.checked, one line saying what still depends on it ("none", or the list; a close that takes nothing down, such as a pull request, is "none"), found by checking the runtimes in ops/jobs.json in the data folder, the live processes under the target, the sessions in it, and the Dashboard\'s /api/health; post it only when nothing would break'

// Where an item will land, given upfront: the Slack thread, channel or DM, the compare or pull request, the Linear team or project; or, with no place yet, why (`noLink`).
const place = {
  link: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional(),
  noLink: oneLine(LIMITS.line).optional(),
}

// The kinds of file an ask can carry, each opened in the Inbox's viewer by its own renderer.
export const INBOX_ATTACHMENT_KINDS = ["code", "doc", "html", "image", "pdf"] as const
export type InboxAttachmentKind = (typeof INBOX_ATTACHMENT_KINDS)[number]

export const MAX_INBOX_ATTACHMENTS = 20

// A label pairs a before with an after in one group, a group being a section's one-line heading.
const attachmentPlace = {
  group: oneLine(LIMITS.line).optional(),
  label: z.enum(["after", "before"]).optional(),
}

// What a poster names: a file on this Mac, its kind read from its extension when left out, which bun run ask copies in before posting.
export const attachmentSourceSchema = z.strictObject({
  ...attachmentPlace,
  kind: z.enum(INBOX_ATTACHMENT_KINDS).optional(),
  src: z.string().min(1).max(4096),
})

// What the item keeps: the copy's id in the attachments folder, its kind and the source's file name.
export const attachmentSchema = z.strictObject({
  ...attachmentPlace,
  id: z.string().regex(ID_PATTERN),
  kind: z.enum(INBOX_ATTACHMENT_KINDS),
  name: oneLine(LIMITS.name),
})

export type InboxAttachment = z.infer<typeof attachmentSchema>

// What the other side has said so far, one line per message in their words' gist, oldest first, so a Slack message or draft reads in its context.
const soFar = z
  .array(z.strictObject({ said: oneLine(LIMITS.line), who: oneLine(LIMITS.name) }))
  .min(1)
  .max(12)
  .optional()

// A name that goes into a sink's argv: never empty, never read as a flag, no space.
const argName = z
  .string()
  .max(LIMITS.name)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Must be a lowercase name: letters, digits, dot, dash")

export const SECRET_ENVIRONMENTS = ["development", "preview", "production"] as const

// Where a secret ask's value goes, the allowlist in code: Vercel alone, `vercel env add` once an environment for one project.
export const secretSinkSchema = z.strictObject({
  environments: z
    .array(z.enum(SECRET_ENVIRONMENTS))
    .min(1)
    .refine((list) => new Set(list).size === list.length, "Name each environment once"),
  project: argName,
  scope: argName,
  type: z.literal("vercel"),
})

export type SecretSink = z.infer<typeof secretSinkSchema>

// Pure: the one command a sink runs for an environment; the value goes on its stdin alone, so it is never in an argv a process list shows.
export const sinkArgv = (key: string, sink: SecretSink, environment: string): string[] => [
  "vercel",
  "env",
  "add",
  key,
  "--environment",
  environment,
  "--project",
  sink.project,
  "--scope",
  sink.scope,
  "--yes",
]

// Runs a sink's argv with the value on its stdin and returns its exit code: null once stopped at its time limit, 127 when it could not start. secret-sink.ts holds the real one; a test passes its own.
export type SinkRun = (argv: string[], stdin: string) => Promise<number | null>

// What Approve does, one shape per kind of approval the owner keeps (playbook's ask rule): a Slack message, a ship of canary, a new Linear ticket, a delete, a schema, a budget, or a plain ask, whose words say what its poster does on Approve, for a decision no other shape fits (a production port, a work request from outside the chain, or a step only he can take, such as plugging in the Mac, where Approve means done and Deny means he can't). An ask may label each side in ELI5 / ASD-STE100, one line; the card then shows its text as the quoted block above the two labelled options. A secret asks for a value instead of a yes, which goes straight to its sink and is kept nowhere.
export const previewSchema = z.discriminatedUnion("type", [
  z.strictObject({
    approve: oneLine(LIMITS.line).optional(),
    attachments: z.array(attachmentSchema).min(1).max(MAX_INBOX_ATTACHMENTS).optional(),
    checked: oneLine(LIMITS.line).optional(),
    deny: oneLine(LIMITS.line).optional(),
    text: words,
    type: z.literal("ask"),
  }),
  z.strictObject({
    ...place,
    text: words,
    thread: soFar,
    to: oneLine(LIMITS.name),
    type: z.literal("slack"),
  }),
  z.strictObject({
    ...place,
    prs: z
      .array(z.strictObject({ number: z.number().int().positive(), title: oneLine(LIMITS.line) }))
      .min(1)
      .max(LIMITS.prs),
    sha: z.string().regex(/^[0-9a-f]{7,40}$/, "Must be a commit SHA"),
    type: z.literal("ship"),
  }),
  z.strictObject({
    body: words,
    ...place,
    team: oneLine(LIMITS.name),
    title: oneLine(LIMITS.line),
    type: z.literal("ticket"),
  }),
  z.strictObject({ type: z.literal("delete"), what: words, why: words }),
  z.strictObject({ shape: words, type: z.literal("schema") }),
  z.strictObject({ amount: oneLine(LIMITS.name), type: z.literal("budget"), why: words }),
  z.strictObject({
    key: z
      .string()
      .max(LIMITS.name)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Must be an environment variable's name"),
    sink: secretSinkSchema,
    type: z.literal("secret"),
  }),
])

const link = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .optional()

// A draft's words, who they go to by a short name ("a colleague's thread"), and the thread they reply in, which its card links to.
export const draftSchema = z.strictObject({
  ...place,
  text: words,
  thread: soFar,
  to: oneLine(LIMITS.name),
})

// An update is an outcome, never progress: one of these five, so a step or an ETA has no way in. It may show an ask's words and files read-only, for something to look at that asks nothing.
export const OUTCOMES = ["alert", "decision", "finding", "merged", "shipped"] as const

export const updateSchema = z.strictObject({
  attachments: z.array(attachmentSchema).min(1).max(MAX_INBOX_ATTACHMENTS).optional(),
  link,
  outcome: z.enum(OUTCOMES),
  text: words.optional(),
})

const base = { from: oneLine(64), title: oneLine(LIMITS.line) }

// What a poster sends ask: a decision when kind is left out, as every ask was.
export const inboxInputSchema = z
  .preprocess(
    (value) =>
      value && typeof value === "object" && !("kind" in value)
        ? { ...value, kind: "decision" }
        : value,
    z.discriminatedUnion("kind", [
      z.strictObject({ ...base, kind: z.literal("decision"), preview: previewSchema }),
      z.strictObject({ ...base, kind: z.literal("draft"), preview: draftSchema }),
      z.strictObject({ ...base, kind: z.literal("update"), preview: updateSchema }),
    ]),
  )
  .refine((input) => !ARCHIVES.test(JSON.stringify(input)), { error: archivesMessage })
  .refine((input) => !MENTION_TOKEN.test(JSON.stringify(input)), MENTION_MESSAGE)
  .refine(
    (input) => !namesPlace(input) || "link" in input.preview !== "noLink" in input.preview,
    "A draft, or a slack, ship or ticket decision, names where it lands: preview.link, or preview.noLink with why there is none yet",
  )
  .refine((input) => {
    if (input.kind !== "decision" || input.preview.type !== "ask") return true
    const { approve, checked, deny, text } = input.preview
    return (
      checked !== undefined ||
      !TAKES_DOWN.test([input.title, text, approve, deny].join("\n").replace(PASSING_MENTION, ""))
    )
  }, TAKES_DOWN_MESSAGE)
  .superRefine((input, ctx) => {
    const text =
      input.kind === "draft"
        ? input.preview.text
        : input.kind === "decision" && input.preview.type === "slack"
          ? input.preview.text
          : null
    const word = text === null ? null : ownerVoiceWord(text)
    if (word) {
      ctx.addIssue({
        code: "custom",
        message: `${OWNER_VOICE_MESSAGE}. Found "${word}"; rewrite it in the first person singular and post again`,
      })
    }
  })

// Pure: whether an item's preview names a place it lands, so it carries a link or a noLink.
function namesPlace(input: { kind: string; preview: object }): boolean {
  if (input.kind === "draft") return true
  const type = input.kind === "decision" && "type" in input.preview ? input.preview.type : null
  return (PLACED_TYPES as readonly unknown[]).includes(type)
}

// The decisions whose preview names where they land.
export const PLACED_TYPES = ["ship", "slack", "ticket"] as const

export type InboxInput = z.input<typeof inboxInputSchema>
export type InboxKind = "decision" | "draft" | "update"
export type InboxPreview = z.infer<typeof previewSchema>
export type InboxDraft = z.infer<typeof draftSchema>
export type InboxUpdate = z.infer<typeof updateSchema>
export type InboxStatus =
  | "approved"
  | "cleared"
  | "denied"
  | "discarded"
  | "done"
  | "drafted"
  | "open"
  | "provided"
  | "sent"

export const ACTIONS = ["approve", "clear", "deny", "discard", "draft", "edit", "send"] as const
export type InboxAction = (typeof ACTIONS)[number]

// ackedAt: when its poster closed it through bun run ask, so the sweep stops chasing it; dismissedAt: when he dismissed the answered item or its poster closed it, which moves it to Done at once; noLink: why a go closed with no link.
export type InboxAnswer = {
  ackedAt?: string
  at: string
  choice: InboxAction
  dismissedAt?: string
  editedText?: string
  link?: string
  linkLabel?: string
  noLink?: string
  note?: string
}

// Pure: a go, an answer he gave to carry out (Approve, Edit, Send, Draft), which closes only with where it landed or why there is no link.
export const isGo = (choice: string): boolean => (GO_CHOICES as readonly string[]).includes(choice)

export const GO_CHOICES = ["approve", "draft", "edit", "send"] as const

// Pure: whether a draft can be saved as a draft in its app: Slack's own MCP server saves one (slack_send_message_draft), while Linear's API has no mutation that creates a Draft, so a Linear comment, named by its link's host as the card names it, is only sent or discarded.
export const savesDraft = (preview: InboxDraft): boolean => {
  try {
    return !preview.link || new URL(preview.link).hostname !== "linear.app"
  } catch {
    return true
  }
}

// The poster closed its own open item, having decided it another way (`bun run ask settle`): the owner gave no answer, so nothing is delivered.
export type InboxSettled = {
  at: string
  by: string
  choice: "settled"
  dismissedAt?: string
  link?: string
  linkLabel?: string
  note?: string
}

// An update takes no answer, so its answer holds only when he dismissed it.
export type InboxDismissed = { dismissedAt: string }

// A reply he sent in chat naming the item (`re #iN`): when, and his words after the tag, so the card says what is being done; its poster's close adds where that landed, and his Dismiss when he cleared it.
export type InboxReplied = {
  ackedAt?: string
  at: string
  choice: "replied"
  dismissedAt?: string
  link?: string
  linkLabel?: string
  said?: string
}

// how much of a reply the card keeps, a line or two
const SAID_CHARS = 280

// Pure: a reply's words without its `re #iN` tag and the colon after it, cut to SAID_CHARS; undefined when nothing is left.
export const saidOf = (text: string): string | undefined => {
  const said = text
    .replace(/\bre #i\d{1,9}\b:?/i, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!said) return undefined
  return said.length > SAID_CHARS ? `${said.slice(0, SAID_CHARS - 1)}…` : said
}

// The poster cleared its own alert update (`bun run ask resolve`), which had resolved itself: read, so nothing was left for him to dismiss.
export type InboxResolved = { at: string; by: string; choice: "resolved"; note?: string }

// A secret ask he answered with its value, which went to its sink and is kept nowhere: when, and each environment's exit status (null: stopped at its time limit), written once the sink has run; its poster's read closes it.
export type InboxProvided = {
  ackedAt?: string
  at: string
  choice: "provided"
  dismissedAt?: string
  link?: string
  linkLabel?: string
  results?: SinkResult[]
}

export type SinkResult = { environment: string; exitCode: number | null }

// An open decision or draft he pushed out of his list until a time (Schedule); it asks again once the time passes.
export type InboxScheduled = { snoozedUntil: string }

// How the answer reached its poster, or the dispatcher when the poster had ended: typed into a session (to: the session that took it, absent on a row from before it was recorded), or read through bun run ask.
export type InboxDelivery =
  | { status: "pending" }
  | { at: string; status: "delivered"; to?: string; via: "cli" | "session" }
  | { code: string; reason: string; status: "failed" }

type Common = {
  createdAt: string
  delivery: InboxDelivery | null
  from: string
  id: string
  readAt: string | null
  ref: number
  status: InboxStatus
  title: string
  updatedAt: string
  version: number
}

type Answered = {
  answer: InboxAnswer | InboxProvided | InboxReplied | InboxScheduled | InboxSettled | null
}

export type InboxItem =
  | (Common & Answered & { kind: "decision"; preview: InboxPreview })
  | (Common & Answered & { kind: "draft"; preview: InboxDraft })
  | (Common & {
      answer: InboxDismissed | InboxResolved | null
      kind: "update"
      preview: InboxUpdate
    })

// The list the dashboard shows, in the order it shows it, and the count on its Inbox tab; snoozed: the open items put away until a time still ahead, kept out of items, which every reader takes as awake, for the Inbox's Snoozed shelf alone.
export type InboxList = { items: InboxItem[]; count: number; snoozed: InboxItem[] }

// What the dashboard posts for an item: the action, the words that go with Edit or with a draft changed before Send or Draft, and seen, the updatedAt of the card he answered, so an answer never lands on words its poster edited after he read them.
export const answerInputSchema = z.strictObject({
  action: z.enum(ACTIONS),
  note: z.string().trim().max(LIMITS.text).optional(),
  seen: z.iso.datetime().optional(),
  text: z.string().trim().max(LIMITS.text).optional(),
})

export type AnswerInput = z.input<typeof answerInputSchema>

// The delivery adapter's contract, deliver() in deliver.ts, restated since this file cannot resolve the API's @/ paths; routers/inbox.ts passes deliver() as a Deliver, so the compiler fails if the two drift apart. It throws only when it cannot write its activity row, which may come after the Enter.
export type Delivery = { actor: ActivityActor; text: string; to: string }
export type DeliveryResult =
  | { at: string; ok: true; sessionId: string }
  | { code: string; ok: false; reason: string }
export type Deliver = (delivery: Delivery) => Promise<DeliveryResult>

export type InboxFailure = { code: "CONFLICT" | "NOT_FOUND" | "VALIDATION_ERROR"; message: string }
type Refused = { ok: false } & InboxFailure

export const zodMessage = (error: z.ZodError): string =>
  error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ")

// The short id an item goes by, in the list, in a reply and in bun run ask get.
export const itemTag = (ref: number): string => `#i${ref}`

const REF_RE = /^#?i(\d{1,9})$/

// A chat reply names the item it is about (`re #iN`), typed by a picked Chat about it or his own words; the web's TYPED holds the same pattern, and a test holds the two equal.
export const REPLY_RE = /\bre #i(\d{1,9})\b/i

// An item's fields, kept apart by kind, so a preview reads as its own kind's.
type Shape<K extends keyof Common | "kind" | "preview"> = {
  [Kind in InboxKind]: Pick<Extract<InboxItem, { kind: Kind }>, K>
}[InboxKind]

// Pure: what an action makes of an item, or why it does not fit: a decision is approved (Edit approves it with his words), denied, cleared (Archive, set aside as neither) or nothing else; a draft is sent or, for a Slack draft, saved as a draft in Slack, each as it was or as he changed it, or discarded; an update is only read.
export function checkAnswer(
  item: Shape<"kind" | "preview" | "status">,
  input: AnswerInput,
): { answer: Omit<InboxAnswer, "at">; status: InboxStatus } | { message: string } {
  const parsed = answerInputSchema.safeParse(input)
  if (!parsed.success) return { message: zodMessage(parsed.error) }
  const checked = answerOf(item, parsed.data)
  // his note, typed in the card's last box, goes with whatever he answers
  const { note } = parsed.data
  return note && "answer" in checked ? { ...checked, answer: { ...checked.answer, note } } : checked
}

function answerOf(
  item: Shape<"kind" | "preview" | "status">,
  { action, text }: AnswerInput,
): { answer: Omit<InboxAnswer, "at">; status: InboxStatus } | { message: string } {
  if (item.kind === "update") return { message: "An update is read, not answered" }
  if (item.status !== "open") return { message: "This item is already answered" }
  if (item.kind === "decision") {
    if (item.preview.type === "secret") {
      return { message: "A secret ask takes its value through its Submit alone" }
    }
    // Clear: neither a yes nor a no; he has set the talk aside and will pick it up later, while whatever is already moving keeps moving
    if (action === "clear") return { answer: { choice: action }, status: "cleared" }
    if (action === "approve") return { answer: { choice: action }, status: "approved" }
    if (action === "deny") return { answer: { choice: action }, status: "denied" }
    if (action === "edit") {
      return text
        ? { answer: { choice: action, editedText: text }, status: "approved" }
        : { message: "Edit takes the words to change it with" }
    }
    return { message: "A decision is approved, denied, edited or cleared" }
  }
  if (action === "discard") return { answer: { choice: action }, status: "discarded" }
  if (action === "draft" && !savesDraft(item.preview)) {
    return { message: "Linear has no draft API, so this draft is sent or discarded" }
  }
  if (action === "send" || action === "draft") {
    if (text === "") return { message: "A draft cannot be empty" }
    const changed = text !== undefined && text !== item.preview.text
    return {
      answer: changed ? { choice: action, editedText: text } : { choice: action },
      status: action === "send" ? "sent" : "drafted",
    }
  }
  return { message: "A draft is sent, saved as a draft or discarded" }
}

// Pure: what is typed into the posting session for its answer, opening with the item's tag and id so `bun run ask get` finds it.
export function deliveryText(
  item: Pick<InboxItem, "id" | "ref" | "title">,
  answer: Omit<InboxAnswer, "at">,
): string {
  const words = answerWords(item, answer)
  return answer.note ? `${words}\nThe owner's note: ${answer.note}` : words
}

function answerWords(
  item: Pick<InboxItem, "id" | "ref" | "title">,
  answer: Omit<InboxAnswer, "at">,
): string {
  const head = `Inbox ${itemTag(item.ref)} (${item.id}) "${item.title}":`
  const edited = answer.editedText
  switch (answer.choice) {
    case "approve":
      return `${head} Approved. Carry it out.`
    case "deny":
      return `${head} Denied. Do not carry it out.`
    case "edit":
      return `${head} Approved with changes. Carry it out with these: ${edited}`
    case "clear":
      return `${head} Cleared for now: the owner will talk more about it later. Whatever is already in motion stays in motion; hold only the new step this item asks for, and leave it to him to pick the talk up again.`
    case "discard":
      return `${head} Discarded. Do not send it.`
    case "send":
      return edited ? `${head} Send it with changes, as: ${edited}` : `${head} Send it as written.`
    case "draft": {
      const converter = slack("slack.linkConverter")
      const how = `with slack_send_message_draft, then bun run ask ack it with the channel_link that returns, ${converter ? `rewritten to the app form by piping it to ${converter}` : "in its app form"} (ack refuses the archives form), or with --no-link and why when Slack refuses (draft_already_exists: that conversation holds a draft already). Do not send it.`
      return edited
        ? `${head} Save it as a Slack draft ${how} Save it with changes, as: ${edited}`
        : `${head} Save it as a Slack draft as written, ${how}`
    }
  }
}

// Pure: what the dispatcher is typed when the poster has ended, so the item's kind and exact words travel with the answer. A go is carried out in the poster's place; a deny, a clear or a discard has nothing to carry out, only an item to close.
export function relayText(item: InboxItem, answer: Omit<InboxAnswer, "at">): string {
  return relayWith(item, isGo(answer.choice), deliveryText(item, answer))
}

function relayWith(item: InboxItem, go: boolean, text: string): string {
  const words = "text" in item.preview ? item.preview.text : JSON.stringify(item.preview)
  const lead = go
    ? `${item.from} has ended, so you carry this out in its place: a sent Slack message goes out through ${slack("slack.sendServer") || "your Slack tool"} (never the claude.ai connector), a Slack draft is saved with slack_send_message_draft as below, and you bun run ask ack the item with where it landed (bun run ask get shows its link).`
    : `${item.from} has ended, so nothing is carried out: close the item with bun run ask get ${itemTag(item.ref)} --ack.`
  return `${lead} ${text}\nKind: ${item.kind}\nPreview text:\n${words}`
}

// Pure: an exit status in words: its code, or stopped at its time limit.
const exitWords = (code: number | null): string =>
  code === null ? "stopped at its time limit" : `exit ${code}`

// Pure: what is typed into the poster of a secret ask he answered: when, and each environment's exit status; the value never, since only the sink was handed it.
export function providedText(
  item: Pick<InboxItem, "id" | "ref" | "title">,
  answer: Pick<InboxProvided, "at" | "results">,
): string {
  const results = (answer.results ?? [])
    .map((result) => `${result.environment}: ${exitWords(result.exitCode)}`)
    .join("; ")
  return `Inbox ${itemTag(item.ref)} (${item.id}) "${item.title}": Provided at ${answer.at}. ${results || "No sink ran"}. Close it with bun run ask get ${itemTag(item.ref)} --ack.`
}

// Pure: the words for the poster and, once it has ended, for the dispatcher, for any answer that is typed.
const textsOf = (
  item: InboxItem,
  answer: Omit<InboxAnswer, "at"> | InboxProvided,
): { relay: string; text: string } => {
  if (answer.choice === "provided") {
    const text = providedText(item, answer)
    return { relay: relayWith(item, false, text), text }
  }
  return { relay: relayText(item, answer), text: deliveryText(item, answer) }
}

// Pure: an answer that did not reach its poster, which asks him to retry it or dismiss it.
export const deliveryFailed = (item: InboxItem): boolean =>
  item.kind !== "update" &&
  item.delivery?.status === "failed" &&
  !(item.answer && "dismissedAt" in item.answer && item.answer.dismissedAt)

// The delivery failures that come before anything is typed (deliver.ts's DELIVERY_FAILURES says which), so Retry cannot type the answer twice; after any other (INTERRUPTED, or ERROR when the adapter threw) the answer may be in the session already, so it waits on a look at the session.
export const RETRY_CODES = ["CMUX_FAILED", "INPUT_NOT_EMPTY", "NOT_FOUND", "ON_PICKER"] as const

// Pure: a failed answer he has not dismissed whose failure Retry can safely follow.
export const retryable = (item: InboxItem): boolean =>
  deliveryFailed(item) &&
  item.delivery?.status === "failed" &&
  (RETRY_CODES as readonly string[]).includes(item.delivery.code)

// Pure: when an open item is scheduled to ask again, while that time is still ahead; null once it is awake, and on anything not scheduled.
export const snoozedUntil = (item: InboxItem, now: Date): string | null => {
  if (item.status !== "open" || !item.answer || !("snoozedUntil" in item.answer)) return null
  return new Date(item.answer.snoozedUntil) > now ? item.answer.snoozedUntil : null
}

// Pure: whether an item asks of him now rather than at a scheduled later time.
export const awake = (item: InboxItem, now: Date): boolean => snoozedUntil(item, now) === null

// Pure: the item's choice once its answer holds one; null before that, a Schedule put-away included, which is awake or asleep by its time alone.
const choiceOf = (item: InboxItem): string | null =>
  item.kind !== "update" && item.answer && "choice" in item.answer ? item.answer.choice : null

const NEEDS_YOU = (item: InboxItem, now: Date): boolean =>
  awake(item, now) &&
  ((item.status === "open" && item.kind !== "update" && choiceOf(item) !== "replied") ||
    deliveryFailed(item))
const UNREAD = (item: InboxItem): boolean => item.kind === "update" && item.readAt === null

// Pure: the count on the Inbox tab, the open decisions and drafts and the answers that did not reach their poster, plus the unread updates; a scheduled item counts once its time arrives.
export const inboxCount = (items: InboxItem[], now = new Date()): number =>
  items.filter((item) => NEEDS_YOU(item, now) || UNREAD(item)).length

// Pure: the list in priority order: what needs him, then unread updates, then everything else, each newest first by when it was posted (#i545); a scheduled item sleeps in with the rest until its time.
export function inboxOrder(items: InboxItem[], now = new Date()): InboxItem[] {
  const rank = (item: InboxItem) => (NEEDS_YOU(item, now) ? 0 : UNREAD(item) ? 1 : 2)
  return [...items].sort((a, b) => rank(a) - rank(b) || b.ref - a.ref || a.id.localeCompare(b.id))
}

type Row = typeof inboxItem.$inferSelect

const toItem = (row: Row): InboxItem =>
  ({
    answer:
      (row.answer as
        | InboxAnswer
        | InboxDismissed
        | InboxProvided
        | InboxReplied
        | InboxResolved
        | InboxScheduled
        | InboxSettled
        | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    delivery: (row.delivery as InboxDelivery | null) ?? null,
    from: row.from,
    id: row.id,
    kind: row.kind,
    preview: row.preview,
    readAt: row.readAt?.toISOString() ?? null,
    ref: row.ref,
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  }) as InboxItem

// Answered and read items stay in the list this long, so an answer is seen landing and then leaves.
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SHOWN = 200

// threadId files the item under a thread (bun run ask new --thread), refused when no thread has it.
export async function postItem(
  db: Database,
  input: unknown,
  threadId?: string,
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const parsed = inboxInputSchema.safeParse(input)
  if (!parsed.success) {
    return { code: "VALIDATION_ERROR", message: zodMessage(parsed.error), ok: false }
  }
  if (threadId !== undefined) {
    const [found] = await db.select({ id: thread.id }).from(thread).where(eq(thread.id, threadId))
    if (!found) return { code: "NOT_FOUND", message: `no thread ${threadId}`, ok: false }
  }
  const [row] = await db
    .insert(inboxItem)
    .values({
      ...parsed.data,
      status: parsed.data.kind === "update" ? "done" : "open",
      threadId,
    })
    .returning()
  return { item: toItem(row as Row), ok: true }
}

// The poster replaces its own open item's title and preview in place (`bun run ask edit`), checked as postItem checks a new one, so one card carries a progress to its end; an item put away with Snooze edits as an open one. Another session's item, a change of kind, an answered or closed item, one he replied to in chat and an update dismissed or resolved are refused.
export async function editItem(
  db: Database,
  key: string,
  input: unknown,
  now = new Date(),
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const parsed = inboxInputSchema.safeParse(input)
  if (!parsed.success) {
    return { code: "VALIDATION_ERROR", message: zodMessage(parsed.error), ok: false }
  }
  const item = await getItem(db, key)
  if (!item) return NOT_FOUND
  if (parsed.data.from !== item.from) {
    return { code: "CONFLICT", message: `This item was posted by ${item.from}`, ok: false }
  }
  if (parsed.data.kind !== item.kind) {
    return { code: "VALIDATION_ERROR", message: `This item is a ${item.kind}`, ok: false }
  }
  const editable =
    item.status === (item.kind === "update" ? "done" : "open") &&
    (item.answer === null ||
      ("snoozedUntil" in item.answer && Object.keys(item.answer).length === 1))
  if (!editable) {
    return {
      code: "CONFLICT",
      message: "This item is already answered, closed or replied to in chat",
      ok: false,
    }
  }
  const [row] = await db
    .update(inboxItem)
    .set({
      preview: parsed.data.preview,
      title: parsed.data.title,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(and(eq(inboxItem.id, item.id), eq(inboxItem.version, item.version)))
    .returning()
  if (!row) {
    return { code: "CONFLICT", message: "This item changed while editing it; try again", ok: false }
  }
  return { item: toItem(row), ok: true }
}

// By its id, or by its tag (#i41, i41), as a person or an agent would name it.
export async function getItem(db: Database, key: string): Promise<InboxItem | null> {
  const ref = REF_RE.exec(key)?.[1]
  const [row] = await db
    .select()
    .from(inboxItem)
    .where(ref ? eq(inboxItem.ref, Number(ref)) : eq(inboxItem.id, key))
  return row ? toItem(row) : null
}

// Everything still waiting, and whatever else moved in the last week.
export async function listItems(db: Database, now = new Date()): Promise<InboxList> {
  const since = new Date(now.getTime() - KEEP_MS)
  // a scheduled item is out of the list and the count until its time
  const awakeSql = sql`(${inboxItem.answer} ->> 'snoozedUntil' is null or (${inboxItem.answer} ->> 'snoozedUntil')::timestamptz <= ${now.toISOString()}::timestamptz)`
  const needsYou = or(
    and(
      eq(inboxItem.status, "open"),
      sql`${inboxItem.kind} <> 'update'`,
      // a chat reply took it off his hands: it waits on its poster closing it
      sql`coalesce(${inboxItem.answer} ->> 'choice', '') <> 'replied'`,
      awakeSql,
    ),
    // coalesced, since a null here would make the rest's not (...) null too and drop every row with no delivery
    sql`coalesce(${inboxItem.delivery} ->> 'status', '') = 'failed' and ${inboxItem.answer} ->> 'dismissedAt' is null`,
  )
  // what needs him is never capped, so a pile of unread updates cannot push a decision out of the list or the count; the snoozed and every set-aside (cleared) item not dismissed, however old, come too, for the Inbox's shelves
  const [open, rest, shelved] = await Promise.all([
    db.select().from(inboxItem).where(needsYou),
    db
      .select()
      .from(inboxItem)
      .where(
        and(
          sql`not (${needsYou})`,
          awakeSql,
          or(isNull(inboxItem.readAt), gt(inboxItem.updatedAt, since)),
        ),
      )
      .orderBy(desc(inboxItem.ref))
      .limit(MAX_SHOWN),
    db
      .select()
      .from(inboxItem)
      .where(
        or(
          and(eq(inboxItem.status, "open"), sql`not ${awakeSql}`),
          // a set-aside item he dismissed has gone to Done, which keeps a week as every settled item does
          and(eq(inboxItem.status, "cleared"), sql`${inboxItem.answer} ->> 'dismissedAt' is null`),
        ),
      )
      .orderBy(desc(inboxItem.ref))
      .limit(MAX_SHOWN),
  ])
  const seen = new Set([...open, ...rest].map((row) => row.id))
  const cleared = shelved.filter((row) => row.status === "cleared" && !seen.has(row.id))
  const items = inboxOrder([...open, ...rest, ...cleared].map(toItem), now)
  const snoozed = shelved.filter((row) => row.status === "open").map(toItem)
  return { items, count: inboxCount(items, now), snoozed }
}

const NOT_FOUND: Refused = { code: "NOT_FOUND", message: "No inbox item with that id", ok: false }

// Records the answer, delivery pending, in one write that holds only while the item is open at the version read, so a double click or a second tab cannot answer it twice; then types it into the posting session and records how that went. With no deliver given (a test) the delivery stays pending, which the poster's `bun run ask get --ack` clears.
export async function answerItem(
  db: Database,
  id: string,
  input: AnswerInput,
  {
    actor,
    deliver,
    dispatcher,
    now = new Date(),
  }: { actor: ActivityActor; deliver?: Deliver; dispatcher?: string; now?: Date },
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const current = await getItem(db, id)
  if (!current || current.id !== id) return NOT_FOUND
  if (input.seen !== undefined && input.seen !== current.updatedAt) {
    return {
      code: "CONFLICT",
      message: "This item changed since you read it; read it again",
      ok: false,
    }
  }
  const checked = checkAnswer(current, input)
  if ("message" in checked) {
    // an answered decision or draft conflicts with this answer; an update never takes one
    const code =
      current.kind !== "update" && current.status !== "open" ? "CONFLICT" : "VALIDATION_ERROR"
    return { code, message: checked.message, ok: false }
  }
  const answer: InboxAnswer = { ...checked.answer, at: now.toISOString() }
  const [row] = await db
    .update(inboxItem)
    .set({
      answer,
      delivery: { status: "pending" },
      readAt: sql`coalesce(${inboxItem.readAt}, ${now})`,
      status: checked.status,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.id, id),
        eq(inboxItem.status, "open"),
        eq(inboxItem.version, current.version),
      ),
    )
    .returning()
  if (!row) return { code: "CONFLICT", message: "This item is already answered", ok: false }
  const answered = toItem(row)
  if (!deliver) return { item: answered, ok: true }
  return {
    item: await send(db, answered, textsOf(answered, checked.answer), {
      actor,
      deliver,
      dispatcher,
      now,
    }),
    ok: true,
  }
}

// Types the answer into the posting session and records how that went; a poster that has ended hands it to the dispatcher instead.
async function send(
  db: Database,
  item: InboxItem,
  { relay, text }: { relay: string; text: string },
  {
    actor,
    deliver,
    dispatcher,
    now,
  }: { actor: ActivityActor; deliver: Deliver; dispatcher?: string; now: Date },
): Promise<InboxItem> {
  let delivery = await attempt(deliver, { actor, text, to: item.from })
  if (dispatcher && item.from !== dispatcher && posterGone(delivery)) {
    delivery = await attempt(deliver, { actor, text: relay, to: dispatcher })
  }
  return (await recordDelivery(db, item.id, delivery, now)) ?? item
}

// deliver.ts reports a poster that has ended as NOT_FOUND with one of these two reasons; its other NOT_FOUNDs ("now names another session", "has no terminal") come from a live session, which a relay would leave to carry the go out beside the dispatcher.
const GONE_REASONS = [
  /^No live session is named /,
  /'s Claude is not running in its pane any more\.$/,
]

const posterGone = (delivery: InboxDelivery): boolean =>
  delivery.status === "failed" &&
  delivery.code === "NOT_FOUND" &&
  GONE_REASONS.some((reason) => reason.test(delivery.reason))

async function attempt(deliver: Deliver, delivery: Delivery): Promise<InboxDelivery> {
  try {
    const result = await deliver(delivery)
    return result.ok
      ? { at: result.at, status: "delivered", to: delivery.to, via: "session" }
      : { code: result.code, reason: result.reason, status: "failed" }
  } catch (error) {
    // ERROR, not one of the adapter's codes, since the answer may have reached the session after all.
    return { code: "ERROR", reason: (error as Error).message, status: "failed" }
  }
}

// Retry on an answer whose delivery failed: marks it pending in one write that holds only while it still reads failed at the version read, so a double click types it once, then delivers it again and records the new result.
export async function retryDelivery(
  db: Database,
  id: string,
  {
    actor,
    deliver,
    dispatcher,
    now = new Date(),
  }: { actor: ActivityActor; deliver: Deliver; dispatcher?: string; now?: Date },
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const current = await getItem(db, id)
  if (!current || current.id !== id) return NOT_FOUND
  if (
    current.kind === "update" ||
    !retryable(current) ||
    !current.answer ||
    !("choice" in current.answer) ||
    current.answer.choice === "settled" ||
    current.answer.choice === "replied"
  ) {
    return {
      code: "CONFLICT",
      message: "Only an answer that failed before anything was typed is retried",
      ok: false,
    }
  }
  const [row] = await db
    .update(inboxItem)
    .set({
      delivery: { status: "pending" },
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.id, id),
        sql`${inboxItem.delivery} ->> 'status' = 'failed'`,
        sql`${inboxItem.answer} ->> 'dismissedAt' is null`,
        eq(inboxItem.version, current.version),
      ),
    )
    .returning()
  if (!row) return { code: "CONFLICT", message: "This item changed; try again", ok: false }
  const item = toItem(row)
  return {
    item: await send(db, item, textsOf(item, current.answer), { actor, deliver, dispatcher, now }),
    ok: true,
  }
}

// What the card posts for a secret ask: the value, and seen, the updatedAt of the card he answered. The value is held in memory for the sink's run alone.
export const SECRET_MAX_CHARS = 64 * 1024
export const secretInputSchema = z.strictObject({
  seen: z.iso.datetime().optional(),
  value: z.string().trim().min(1).max(SECRET_MAX_CHARS),
})

// Hands his value for a secret ask to its sink, once an environment on stdin, and records only when and each exit status: in one write that holds only while the item is open at the version read, so a double click or a second tab runs the sink once, then the results, then a delivery to its poster as an answer's. The value is in no row, delivery, refusal or return.
export async function provideSecret(
  db: Database,
  id: string,
  { seen, value }: z.output<typeof secretInputSchema>,
  {
    actor,
    deliver,
    dispatcher,
    now = new Date(),
    run,
  }: { actor: ActivityActor; deliver?: Deliver; dispatcher?: string; now?: Date; run: SinkRun },
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const current = await getItem(db, id)
  if (!current || current.id !== id) return NOT_FOUND
  if (current.kind !== "decision" || current.preview.type !== "secret") {
    return { code: "VALIDATION_ERROR", message: "Only a secret ask takes a value", ok: false }
  }
  const { key, sink } = current.preview
  if (seen !== undefined && seen !== current.updatedAt) {
    return {
      code: "CONFLICT",
      message: "This item changed since you read it; read it again",
      ok: false,
    }
  }
  const at = now.toISOString()
  const [claimed] = await db
    .update(inboxItem)
    .set({
      answer: { at, choice: "provided" } satisfies InboxProvided,
      delivery: { status: "pending" },
      readAt: sql`coalesce(${inboxItem.readAt}, ${now})`,
      status: "provided",
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.id, id),
        eq(inboxItem.status, "open"),
        eq(inboxItem.version, current.version),
      ),
    )
    .returning()
  if (!claimed) return { code: "CONFLICT", message: "This item is already answered", ok: false }
  const results: SinkResult[] = []
  for (const environment of sink.environments) {
    results.push({ environment, exitCode: await run(sinkArgv(key, sink, environment), value) })
  }
  const answer: InboxProvided = { at, choice: "provided", results }
  // merged key by key, so a poster's read that landed while the sink ran keeps its close
  const [row] = await db
    .update(inboxItem)
    .set({
      answer: sql`${inboxItem.answer} || jsonb_build_object('results', (${JSON.stringify(results)}::text)::jsonb)`,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(eq(inboxItem.id, id))
    .returning()
  const item = toItem(row ?? claimed)
  if (!deliver) return { item, ok: true }
  return {
    item: await send(db, item, textsOf(item, answer), { actor, deliver, dispatcher, now }),
    ok: true,
  }
}

// The first delivery recorded stands: a poster that read its answer through bun run ask while the adapter typed keeps that record.
async function recordDelivery(
  db: Database,
  id: string,
  delivery: InboxDelivery,
  now: Date,
): Promise<InboxItem | null> {
  const [row] = await db
    .update(inboxItem)
    .set({ delivery, updatedAt: now, version: sql`${inboxItem.version} + 1` })
    .where(
      and(eq(inboxItem.id, id), sql`coalesce(${inboxItem.delivery}->>'status', '') <> 'delivered'`),
    )
    .returning()
  return row ? toItem(row) : getItem(db, id)
}

// Pushes an open decision or draft out of his list until a time, recorded in its answer's snoozedUntil, which answering or a chat reply replaces at once; the poster waits as before. A chat reply its poster has not closed is replaced in turn, since he puts away an item he opened again from its card.
export async function scheduleItem(
  db: Database,
  id: string,
  at: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const current = await getItem(db, id)
  if (!current || current.id !== id) return NOT_FOUND
  if (current.kind === "update" || current.status !== "open") {
    return {
      code: "CONFLICT",
      message: "Only an open decision or draft can be scheduled",
      ok: false,
    }
  }
  const answer = current.answer
  const replied = answer !== null && "choice" in answer
  if (replied && (answer.choice !== "replied" || answer.ackedAt)) {
    return { code: "CONFLICT", message: "This item already has your answer", ok: false }
  }
  if (new Date(at).getTime() <= now.getTime()) {
    return { code: "VALIDATION_ERROR", message: "Pick a time in the future", ok: false }
  }
  const [row] = await db
    .update(inboxItem)
    .set({
      answer: replied
        ? { snoozedUntil: at }
        : sql`coalesce(${inboxItem.answer}, '{}'::jsonb) || jsonb_build_object('snoozedUntil', ${at}::text)`,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.id, id),
        eq(inboxItem.status, "open"),
        eq(inboxItem.version, current.version),
      ),
    )
    .returning()
  if (!row) return { code: "CONFLICT", message: "This item is already answered", ok: false }
  return { item: toItem(row), ok: true }
}

// A chat reply he sent naming the item (`re #iN`, recorded by routers/dashboard.ts once the message is out): the time and his words (saidOf). Nothing else changes: the item waits on its poster closing it, which the sweep keeps chasing.
export async function recordReply(
  db: Database,
  ref: number,
  now = new Date(),
  text = "",
): Promise<InboxItem | null> {
  const said = saidOf(text)
  const [row] = await db
    .update(inboxItem)
    .set({
      answer: { at: now.toISOString(), choice: "replied", ...(said && { said }) },
      readAt: sql`coalesce(${inboxItem.readAt}, ${now})`,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.ref, ref),
        eq(inboxItem.status, "open"),
        sql`${inboxItem.kind} <> 'update'`,
        sql`${inboxItem.answer} ->> 'choice' is null`,
      ),
    )
    .returning()
  return row ? toItem(row) : null
}

// The poster closes its answer (`bun run ask ack`): a go with where it landed (`link`) or why there is none (`noLink`), anything else as it is; its delivery is done by the CLI.
export async function ackItem(
  db: Database,
  key: string,
  {
    label,
    link,
    noLink,
    now = new Date(),
  }: { label?: string; link?: string; noLink?: string; now?: Date } = {},
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const refused = checkLink(link, label)
  if (refused) return refused
  if (link !== undefined && noLink !== undefined) {
    return { code: "VALIDATION_ERROR", message: "Give --link or --no-link, not both", ok: false }
  }
  const why = noLink === undefined ? null : oneLine(LIMITS.line).safeParse(noLink)
  if (why && !why.success) {
    return {
      code: "VALIDATION_ERROR",
      message: `--no-link takes why there is no link: one line, not empty, of at most ${LIMITS.line} characters`,
      ok: false,
    }
  }
  const item = await getItem(db, key)
  if (!item) return NOT_FOUND
  if (item.kind === "update" || !item.answer || !("choice" in item.answer)) {
    return { code: "CONFLICT", message: "This item has no answer yet", ok: false }
  }
  if (isGo(item.answer.choice) && link === undefined && !why) {
    return {
      code: "VALIDATION_ERROR",
      message:
        'A go closes with where it landed: --link <https url> (the Slack message, PR, issue or Linear ticket), or --no-link "<why>"',
      ok: false,
    }
  }
  if (why && !isGo(item.answer.choice)) {
    return { code: "VALIDATION_ERROR", message: "--no-link closes a go alone", ok: false }
  }
  // a go closes one way: a link and a reason there is none would contradict each other
  if (why && item.answer.link) {
    return { code: "CONFLICT", message: "This answer already links where it landed", ok: false }
  }
  if (link !== undefined && "noLink" in item.answer && item.answer.noLink) {
    return { code: "CONFLICT", message: "This answer already closed with no link", ok: false }
  }
  return {
    item: await recordAck(db, item, now, true, link, label, why?.success ? why.data : undefined),
    ok: true,
  }
}

// The poster read its answer (`bun run ask get --ack`): its delivery is done by the CLI, and an answer that is neither a go nor a reply, which it carries out by reading, is closed too. A reply waits on its poster like a go, closed only by `bun run ask ack`.
export async function readAnswer(
  db: Database,
  item: InboxItem,
  now = new Date(),
): Promise<InboxItem> {
  if (item.kind === "update" || !item.answer || !("choice" in item.answer)) return item
  const { choice } = item.answer
  return recordAck(db, item, now, !isGo(choice) && choice !== "replied")
}

// Records the CLI's read as the delivery, and when close, the ack's stamp and any link.
async function recordAck(
  db: Database,
  item: InboxItem,
  now: Date,
  close: boolean,
  link?: string,
  label?: string,
  noLink?: string,
): Promise<InboxItem> {
  if (close) await stamp(db, item.id, now, noLink)
  const acked = await recordDelivery(
    db,
    item.id,
    { at: now.toISOString(), status: "delivered", via: "cli" },
    now,
  )
  const linked = link === undefined ? null : await recordLink(db, item.id, link, label, now)
  return linked ?? acked ?? item
}

// The ack's stamp, the first close's time, and with it why a go has no link, in one write; a closed answer moves to Done at once, as his Dismiss moves it, keeping an earlier Dismiss's time, but for one he set aside, which stays on the Archived shelf until he dismisses it.
async function stamp(db: Database, id: string, now: Date, noLink?: string): Promise<void> {
  const at = sql`${now.toISOString()}::text`
  const dismissal = sql`case when ${inboxItem.answer} ->> 'choice' = 'clear' then '{}'::jsonb else jsonb_build_object('dismissedAt', coalesce(${inboxItem.answer} ->> 'dismissedAt', ${at})) end`
  await db
    .update(inboxItem)
    .set({
      answer: sql`${inboxItem.answer} || jsonb_build_object('ackedAt', coalesce(${inboxItem.answer} ->> 'ackedAt', ${at})) || ${dismissal} || ${noLink === undefined ? sql`'{}'::jsonb` : sql`jsonb_build_object('noLink', ${noLink}::text)`}`,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(eq(inboxItem.id, id))
}

// When the dashboard started stamping acks: an answer delivered before then, read through bun run ask or typed into its session, may have been acked with no stamp, so it is not chased; one never delivered still is.
export const ACKS_STAMPED_FROM = new Date("2026-10-12T08:05:50Z")

// Answers he gave since `since` that their poster has not closed through bun run ask within `minutes` (a go with its link or why there is none, anything else by reading it), delivery pending, failed or typed into its session alike, oldest first: what ops-sweep chases (`bun run ask stale`).
export async function staleItems(
  db: Database,
  { minutes, now = new Date(), since }: { minutes: number; now?: Date; since: Date },
): Promise<InboxItem[]> {
  const cutoff = new Date(now.getTime() - minutes * 60_000)
  const rows = await db
    .select()
    .from(inboxItem)
    .where(
      and(
        sql`${inboxItem.kind} <> 'update'`,
        sql`${inboxItem.answer} ->> 'choice' <> 'settled'`,
        sql`${inboxItem.answer} ->> 'ackedAt' is null`,
        // a failed answer he dismissed, which he chose not to send
        sql`not (coalesce(${inboxItem.delivery} ->> 'status', '') = 'failed' and ${inboxItem.answer} ->> 'dismissedAt' is not null)`,
        sql`(${inboxItem.answer} ->> 'at')::timestamptz between ${since.toISOString()}::timestamptz and ${cutoff.toISOString()}::timestamptz`,
        sql`(coalesce(${inboxItem.delivery} ->> 'status', '') <> 'delivered' or (${inboxItem.answer} ->> 'at')::timestamptz >= ${ACKS_STAMPED_FROM.toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(inboxItem.ref)
  return rows.map(toItem)
}

// Moves the answered decisions and drafts, those he replied to in chat included, and the updates named to Done at once, recording when inside their answer, so no column is added, and marks an update read, keeping when it was read; an open decision or draft asks something of him and is left.
export async function dismissItems(db: Database, ids: string[], now = new Date()): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await db
    .update(inboxItem)
    .set({
      answer: sql`coalesce(${inboxItem.answer}, '{}'::jsonb) || jsonb_build_object('dismissedAt', ${now.toISOString()}::text)`,
      readAt: sql`coalesce(${inboxItem.readAt}, ${now})`,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        or(
          eq(inboxItem.kind, "update"),
          and(sql`${inboxItem.status} <> 'open'`, isNotNull(inboxItem.answer)),
          sql`${inboxItem.answer} ->> 'choice' = 'replied'`,
        ),
        sql`${inboxItem.answer} ->> 'dismissedAt' is null`,
        inArray(inboxItem.id, ids),
      ),
    )
    .returning({ id: inboxItem.id })
  return rows.length
}

const settleNoteSchema = oneLine(LIMITS.line)

// Where the poster carried the answer out (a Slack message's permalink, a ticket, a pull request), which the card links to; https alone, since the dashboard opens it.
const linkSchema = z.url({ protocol: /^https$/ }).max(LIMITS.text)

// What the link is, as the card names it ("Filed ABC-123"); one line.
const linkLabelSchema = oneLine(LIMITS.line)

// Pure: the link and its label as given on the command line, or why they are refused: an https URL, and a label only beside a link.
const checkLink = (link?: string, label?: string): Refused | null => {
  if (label !== undefined && link === undefined) {
    return {
      code: "VALIDATION_ERROR",
      message: "--label names a --link, so it needs one",
      ok: false,
    }
  }
  if (link !== undefined && !linkSchema.safeParse(link).success) return BAD_LINK
  if ([link, label].some((text) => text !== undefined && ARCHIVES.test(text))) return notApp()
  if (label !== undefined && !linkLabelSchema.safeParse(label).success) {
    return {
      code: "VALIDATION_ERROR",
      message: `--label is one line of at most ${LIMITS.line} characters`,
      ok: false,
    }
  }
  return null
}

const notApp = (): Refused => ({ code: "VALIDATION_ERROR", message: archivesMessage(), ok: false })

const BAD_LINK: Refused = {
  code: "VALIDATION_ERROR",
  message: "--link takes an https URL",
  ok: false,
}

// Records the link inside the answer, beside what it already holds.
async function recordLink(
  db: Database,
  id: string,
  link: string,
  label: string | undefined,
  now: Date,
): Promise<InboxItem | null> {
  const [row] = await db
    .update(inboxItem)
    .set({
      // a new link replaces the old one's label too, so a re-ack with no label names the new link from itself
      answer: sql`(${inboxItem.answer} - 'linkLabel') || jsonb_build_object('link', ${link}::text) || ${label === undefined ? sql`'{}'::jsonb` : sql`jsonb_build_object('linkLabel', ${label.trim()}::text)`}`,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(and(eq(inboxItem.id, id), isNotNull(inboxItem.answer)))
    .returning()
  return row ? toItem(row) : null
}

// The poster closes its own open decision or draft (`bun run ask settle`), when it was decided another way: it reads Answered by the poster, with the note, and goes to Done at once, as a closed answer does. One the owner has answered is refused, as is a chat reply its poster has acked (a settle would replace its answer) and an update, which asks nothing.
export async function settleItem(
  db: Database,
  key: string,
  {
    label,
    link,
    note,
    now = new Date(),
  }: { label?: string; link?: string; note?: string; now?: Date } = {},
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const refused = checkLink(link, label)
  if (refused) return refused
  const checked = note === undefined ? null : settleNoteSchema.safeParse(note)
  if (checked && !checked.success) {
    return {
      code: "VALIDATION_ERROR",
      message: `--note is one line of at most ${LIMITS.line} characters`,
      ok: false,
    }
  }
  if (note !== undefined && ARCHIVES.test(note)) return notApp()
  const item = await getItem(db, key)
  if (!item) return NOT_FOUND
  if (item.kind === "update") {
    return {
      code: "VALIDATION_ERROR",
      message: "An update asks nothing, so it has nothing to settle",
      ok: false,
    }
  }
  if (item.status !== "open" || (item.answer && "ackedAt" in item.answer && item.answer.ackedAt)) {
    return { code: "CONFLICT", message: "This item is already answered", ok: false }
  }
  const answer: InboxSettled = {
    at: now.toISOString(),
    by: item.from,
    choice: "settled",
    dismissedAt: now.toISOString(),
    ...(link === undefined ? {} : { link }),
    ...(label === undefined ? {} : { linkLabel: label.trim() }),
    ...(checked?.success ? { note: checked.data } : {}),
  }
  const [row] = await db
    .update(inboxItem)
    .set({
      answer,
      readAt: sql`coalesce(${inboxItem.readAt}, ${now})`,
      status: "done",
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.id, item.id),
        eq(inboxItem.status, "open"),
        eq(inboxItem.version, item.version),
      ),
    )
    .returning()
  if (!row) {
    return {
      code: "CONFLICT",
      message: "This item changed while settling it; try again",
      ok: false,
    }
  }
  return { item: toItem(row), ok: true }
}

// The poster clears its own alert update (`bun run ask resolve`), once it has resolved itself: it marks the alert read, records the resolution inside its answer and leaves it closed, so the owner never dismisses a cleared alert by hand. Another session's alert, a non-alert item and an unknown id are refused.
export async function resolveItem(
  db: Database,
  key: string,
  { by, note, now = new Date() }: { by: string; note?: string; now?: Date },
): Promise<{ item: InboxItem; ok: true } | Refused> {
  const checked = note === undefined ? null : settleNoteSchema.safeParse(note)
  if (checked && !checked.success) {
    return {
      code: "VALIDATION_ERROR",
      message: `--note is one line of at most ${LIMITS.line} characters`,
      ok: false,
    }
  }
  if (note !== undefined && ARCHIVES.test(note)) return notApp()
  const item = await getItem(db, key)
  if (!item) return NOT_FOUND
  if (item.kind !== "update" || item.preview.outcome !== "alert") {
    return {
      code: "VALIDATION_ERROR",
      message:
        "Only an alert update resolves; a decision or draft settles, and another update is read or dismissed",
      ok: false,
    }
  }
  if (by !== item.from) {
    return {
      code: "CONFLICT",
      message: `Only ${item.from}, which posted it, resolves this alert`,
      ok: false,
    }
  }
  const answer: InboxResolved = {
    at: now.toISOString(),
    by,
    choice: "resolved",
    ...(checked?.success ? { note: checked.data } : {}),
  }
  const [row] = await db
    .update(inboxItem)
    .set({
      // merged key by key, as dismissItems writes, so a dismissed alert keeps its dismissedAt and stays in Done
      answer: sql`coalesce(${inboxItem.answer}, '{}'::jsonb) || jsonb_build_object('at', ${answer.at}::text, 'by', ${answer.by}::text, 'choice', 'resolved'${checked?.success ? sql`, 'note', ${answer.note}::text` : sql``})`,
      readAt: sql`coalesce(${inboxItem.readAt}, ${now})`,
      updatedAt: now,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(
      and(
        eq(inboxItem.id, item.id),
        eq(inboxItem.kind, "update"),
        sql`${inboxItem.answer} ->> 'choice' is distinct from 'resolved'`,
      ),
    )
    .returning()
  if (!row) {
    return { code: "CONFLICT", message: "This alert is already resolved", ok: false }
  }
  return { item: toItem(row), ok: true }
}

// Marks the items named read: one he clicked, or Mark all as read. An open decision or draft stays open and answerable, only seen, its updatedAt untouched so its card reads as posted, not updated; an update's moves, which keeps it in the list's history window.
export async function markRead(db: Database, ids: string[], now = new Date()): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await db
    .update(inboxItem)
    .set({
      readAt: now,
      updatedAt: sql`case when ${inboxItem.kind} = 'update' then ${now.toISOString()}::timestamptz else ${inboxItem.updatedAt} end`,
      version: sql`${inboxItem.version} + 1`,
    })
    .where(and(isNull(inboxItem.readAt), inArray(inboxItem.id, ids)))
    .returning({ id: inboxItem.id })
  return rows.length
}
