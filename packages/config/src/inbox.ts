import { z } from "zod"

// The widest line, in characters, a drawing in an Inbox ask fits at the card's code size on the narrowest real card, so bun run ask can warn its author before the card shrinks it: the aside at its 30% minimum on a 1512px screen leaves the block 267px, and JetBrains Mono at 12px is 7.2px a character, so floor(267 / 7.2) (measured; the phone's 390px Inbox leaves 296px).
export const ASK_CODE_COLUMNS = 37

// What an Inbox answer tells its poster: one JSON line after this lead, typed through deliver(), so the poster parses it rather than reading prose.
export const ANSWER_LEAD = "[inbox-answer]"

// The verbs that reach a poster: a pick of an option, a draft sent, saved as a draft or discarded, an item set aside, a card dismissed, an update done, a secret submitted; a verb that changes only the owner's view (Seen, Later, Archive) sends nothing.
export const ANSWER_VERBS = [
  "discard",
  "dismiss",
  "done",
  "draft",
  "pick",
  "send",
  "set-aside",
  "submit",
] as const

// What a step the dashboard ran on Approve gave: its exit code and its first line.
const ranSchema = z.strictObject({ exitCode: z.number().int(), line: z.string() })

// The line's JSON: what the owner chose, what to do next and the exact command that closes the item, which an update's done or dismiss and a card its poster already closed leave out, since nothing is left to close; a relay to the dispatcher sets relay, and a step the dashboard ran on Approve (an accept, an apps change, a grant's pane, a guard setting) rides as accepted, listed, opened or set, and a secret's results carry each sink's status, never its value.
export const answerPayloadSchema = z.strictObject({
  accepted: ranSchema.optional(),
  at: z.iso.datetime(),
  close: z.string().min(1).optional(),
  comment: z.string().optional(),
  go: z.boolean(),
  id: z.string().min(1),
  kind: z.enum(["decision", "draft", "update"]),
  linkConverter: z.string().optional(),
  listed: ranSchema.optional(),
  next: z.enum(["carry-out", "close", "nothing"]),
  opened: ranSchema.optional(),
  option: z
    .strictObject({
      index: z.number().int().min(0).max(5),
      label: z.string().min(1),
      letter: z.string().length(1),
    })
    .optional(),
  ref: z.string().regex(/^#i\d+$/),
  relay: z.strictObject({ for: z.string().min(1), why: z.literal("poster-ended") }).optional(),
  results: z
    .array(
      z.strictObject({
        environment: z.string(),
        exitCode: z.number().int().nullable(),
        line: z.string().optional(),
      }),
    )
    .optional(),
  set: ranSchema.optional(),
  text: z.string().optional(),
  title: z.string(),
  type: z.string().optional(),
  v: z.literal(1),
  verb: z.enum(ANSWER_VERBS),
})

export type AnswerPayload = z.infer<typeof answerPayloadSchema>

// Pure: the payload a line carries after ANSWER_LEAD, or null when the line is no answer or does not parse.
export const payloadOf = (line: string): AnswerPayload | null => {
  const at = line.indexOf(ANSWER_LEAD)
  if (at === -1) return null
  try {
    const parsed = answerPayloadSchema.safeParse(JSON.parse(line.slice(at + ANSWER_LEAD.length)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// A decision's options as its card shows them and its answer names them: a go row carries the decision out, the no-go row (always last) declines it.
export type ChoiceRow = {
  description?: string
  go: boolean
  index: number
  label: string
  letter: string
}

// yes-no: one go row and its no, Approve and Deny with their own labels; letters: two or more go rows, A to E, then None of these.
export type Choices = { rows: ChoiceRow[]; shape: "letters" | "yes-no" }

// The most go rows a decision offers, A to E.
export const MAX_OPTIONS = 5

// What choicesOf reads of a decision's preview: an ask's own options or labels, and the fields a typed decision's default labels name.
export type ChoicePreview =
  | {
      approve?: string
      deny?: string
      options?: { description?: string; label: string }[]
      type: "ask"
    }
  | { key: string; kind: string; type: "accept" }
  | { app: string; change: "add" | "remove"; type: "apps" }
  | { amount: string; type: "budget" }
  | { type: "delete" }
  | { permission: string; type: "grant" }
  | { key: string; type: "guard"; value?: unknown }
  | { type: "reveal" }
  | { type: "schema" }
  | { type: "secret" }
  | { sha: string; type: "ship" }
  | { to: string; type: "slack" }
  | { team: string; type: "ticket" }

// Pure: a typed decision's default go and no-go labels, one map for every type a poster labels no options on.
const defaultLabels = (
  preview: Exclude<ChoicePreview, { type: "ask" } | { type: "secret" }>,
): [string, string] => {
  switch (preview.type) {
    case "accept":
      return [`Accept the ${preview.kind} ${preview.key}`, "Leave it unaccepted"]
    case "apps":
      return [
        `${preview.change === "add" ? "Add" : "Remove"} ${preview.app}`,
        "Keep the list as it is",
      ]
    case "budget":
      return [`Spend ${preview.amount}`, "Do not spend it"]
    case "delete":
      return ["Delete it", "Keep it"]
    case "grant":
      return [`Open the ${preview.permission} settings`, "Not now"]
    case "guard":
      return preview.value === undefined
        ? [`Take ${preview.key} back to its default`, "Keep it as it is"]
        : [`Set ${preview.key}`, "Keep it as it is"]
    case "reveal":
      return ["Done, I have it", "I do not need it"]
    case "schema":
      return ["Apply this schema", "Do not apply it"]
    case "ship":
      return [`Ship ${preview.sha.slice(0, 7)} to main`, "Hold the ship"]
    case "slack":
      return [`Send it to ${preview.to}`, "Do not send it"]
    case "ticket":
      return [`File it in ${preview.team}`, "Do not file it"]
  }
}

// Pure: an option's letter, A for the first row.
export const optionLetter = (index: number): string => String.fromCharCode(65 + index)

// Pure: a decision's rows, its go rows then its no-go row, each lettered by place; null for a secret, which takes a value instead.
export function choicesOf(preview: ChoicePreview): Choices | null {
  if (preview.type === "secret") return null
  if (preview.type !== "ask") {
    const [go, no] = defaultLabels(preview)
    return {
      rows: lettered([
        { go: true, label: go },
        { go: false, label: no },
      ]),
      shape: "yes-no",
    }
  }
  const go = preview.options ?? [{ label: preview.approve ?? "Approve" }]
  const shape = go.length > 1 ? "letters" : "yes-no"
  const no = preview.deny ?? (shape === "letters" ? "None of these" : "Deny")
  return {
    rows: lettered([...go.map((row) => ({ ...row, go: true })), { go: false, label: no }]),
    shape,
  }
}

const lettered = (rows: Omit<ChoiceRow, "index" | "letter">[]): ChoiceRow[] =>
  rows.map((row, index) => ({ ...row, index, letter: optionLetter(index) }))

// Pure: the row an answer picked, for the poster's payload and the owner's result line alike: a deny's no-go row, else the go row its option names, the first when it names none; null for a secret or an option past the rows.
export function rowOfAnswer(
  preview: ChoicePreview,
  answer: { choice: string; option?: number },
): ChoiceRow | null {
  const rows = choicesOf(preview)?.rows ?? []
  const row =
    answer.choice === "deny"
      ? rows.find((r) => !r.go)
      : rows.filter((r) => r.go)[answer.option ?? 0]
  return row ?? null
}

// When the Inbox stopped moving cards by the clock, set at this change's last code commit before the live dashboard took it: the old clock had already moved every card answered or read before then to Done, so those keep the list's week, while each one since stays in the Inbox until a verb moves it (inboxView in the web, listItems in the API).
export const CLOCKS_STOPPED_AT = "2026-11-05T03:44:00.000Z"
