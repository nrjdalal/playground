import { z } from "zod"

// The widest line, in characters, a drawing in an Inbox ask fits at the card's code size on the narrowest real card, so bun run ask can warn its author before the card shrinks it: the aside at its 30% minimum on a 1512px screen leaves the block 267px, and JetBrains Mono at 12px is 7.2px a character, so floor(267 / 7.2) (measured; the phone's 390px Inbox leaves 296px).
export const ASK_CODE_COLUMNS = 37

// What an Inbox answer tells its poster: one JSON line after this lead, typed through deliver(), so the poster parses it rather than reading prose.
export const ANSWER_LEAD = "[inbox-answer]"

// The verbs that reach a poster: a pick of an option, a draft sent, saved as a draft or discarded, an item set aside, a card dismissed, an update done, a secret submitted; a verb that changes only the owner's view (Seen, Snooze, Archive) sends nothing.
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

// The line's JSON: what the owner chose, what to do next and the exact command that closes the item, which an update's done or dismiss and a card its poster already closed leave out, since nothing is left to close; a relay to the dispatcher sets relay, and a step the dashboard ran on Approve (an accept, an apps change, a grant's pane) rides as accepted, listed or opened, and a secret's results carry each sink's status, never its value.
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

// When the Inbox stopped moving cards by the clock, set at this change's last code commit before the live dashboard took it: the old clock had already moved every card answered or read before then to Done, so those keep the list's week, while each one since stays in the Inbox until a verb moves it (inboxView in the web, listItems in the API).
export const CLOCKS_STOPPED_AT = "2026-11-05T03:44:00.000Z"
