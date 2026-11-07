import { ANSWER_LEAD, payloadOf } from "@packages/config/inbox"

// What the chat shows for an Inbox answer line: the card's #iN, the option you picked, each question's pick for a multi-question answer, or else the verb, and your note.
export type AnswerChip = {
  id: string
  label: string
  note: string | null
  ref: string
}

// Pure: the chip for a message that is one [inbox-answer] line, or null for any other text and for a line that does not parse, which then shows as written.
export const answerChipOf = (text: string): AnswerChip | null => {
  if (!text.trimStart().startsWith(ANSWER_LEAD)) return null
  const payload = payloadOf(text.trim())
  if (!payload) return null
  return {
    id: payload.id,
    label: payload.picks?.length
      ? payload.picks.map((pick) => `${pick.letter}. ${pick.label}`).join(" · ")
      : (payload.option?.label ?? payload.verb),
    note: payload.comment?.trim() || null,
    ref: payload.ref,
  }
}
