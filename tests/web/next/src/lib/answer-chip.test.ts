import { describe, expect, test } from "bun:test"

import { answerChipOf } from "@/lib/answer-chip"

import { answerLine } from "../../../../../api/hono/src/lib/dashboard/inbox"
import type { AnswerPayload } from "../../../../../packages/config/src/inbox"

const payload = (fields: Partial<AnswerPayload>): AnswerPayload => ({
  at: "2026-11-05T12:00:00.000Z",
  go: true,
  id: "i343",
  kind: "decision",
  next: "carry-out",
  ref: "#i343",
  title: "Lines for the brief",
  v: 1,
  verb: "pick",
  ...fields,
})

describe("answerChipOf", () => {
  test("a pick shows its option's label", () => {
    const line = answerLine(
      payload({ option: { index: 0, label: "Add all 4 lines", letter: "A" } }),
    )
    expect(answerChipOf(line)).toEqual({
      id: "i343",
      label: "Add all 4 lines",
      note: null,
      ref: "#i343",
    })
  })

  test("a multi-question answer shows each question's pick (#1250)", () => {
    const line = answerLine(
      payload({
        picks: [
          { index: 0, label: "Staging first", letter: "A", question: "Where first?" },
          { index: 1, label: "After the next ship", letter: "B", question: "When?" },
        ],
      }),
    )
    expect(answerChipOf(line)).toMatchObject({
      label: "A. Staging first · B. After the next ship",
    })
  })

  test("a verb with no option shows the verb", () => {
    const line = answerLine(payload({ kind: "draft", next: "close", verb: "send" }))
    expect(answerChipOf(line)).toMatchObject({ label: "send", note: null, ref: "#i343" })
  })

  test("the note follows the chip, trimmed, and a blank one is none", () => {
    const noted = answerLine(payload({ comment: "  ship it after lunch \n", verb: "done" }))
    expect(answerChipOf(noted)).toMatchObject({ label: "done", note: "ship it after lunch" })
    expect(answerChipOf(answerLine(payload({ comment: "  " })))?.note).toBeNull()
  })

  test("a line that does not parse, or any other text, keeps its plain text", () => {
    expect(answerChipOf('[inbox-answer] {"id":"i343"')).toBeNull()
    expect(answerChipOf('[inbox-answer] {"id":"i343","verb":"pick"}')).toBeNull()
    expect(answerChipOf("hello there")).toBeNull()
    expect(answerChipOf(`see this: ${answerLine(payload({}))}`)).toBeNull()
  })

  test("a line led by spaces still reads as an answer", () => {
    expect(answerChipOf(`  ${answerLine(payload({}))}\n`)?.ref).toBe("#i343")
  })
})
