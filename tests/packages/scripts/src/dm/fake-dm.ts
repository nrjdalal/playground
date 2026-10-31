import type { Message, Slack } from "../../../../../packages/scripts/src/dm/slack"

export const OWNER = "U0OWNER"
export const DM = "D0FIXTURE"

// A DM held in memory, answering the Slack methods dm send and the DM watch call; beforePost runs before each post lands, so a test can drop an owner message in mid-send.
export function fakeDm(start: Message[] = [], beforePost?: (text: string) => void) {
  const messages: Message[] = [...start]
  const calls: { method: string; params: Record<string, string> }[] = []
  let clock = Math.floor(Math.max(1000, ...start.map((m) => Number(m.ts))))
  const add = (text: string, user = OWNER) => {
    clock += 1
    const m = { text, ts: `${clock}.000100`, user }
    messages.push(m)
    return m
  }
  const slack: Slack = async (method, params) => {
    calls.push({ method, params })
    if (method === "conversations.history") {
      const inclusive = params.inclusive !== "false"
      const after = (m: Message) =>
        !params.oldest ||
        (inclusive ? Number(m.ts) >= Number(params.oldest) : Number(m.ts) > Number(params.oldest))
      const before = (m: Message) =>
        !params.latest ||
        (inclusive ? Number(m.ts) <= Number(params.latest) : Number(m.ts) < Number(params.latest))
      const found = messages.filter((m) => after(m) && before(m)).reverse()
      return { messages: found.slice(0, Number(params.limit ?? 100)), ok: true }
    }
    if (method === "chat.postMessage") {
      beforePost?.(params.text!)
      return { ok: true, ts: add(params.text!).ts }
    }
    if (method === "chat.update") {
      const m = messages.find((x) => x.ts === params.ts)
      if (!m) return { error: "message_not_found", ok: false }
      m.text = params.text
      return { ok: true, ts: m.ts }
    }
    if (method === "conversations.mark") return { ok: true }
    return { error: `unknown method ${method}`, ok: false }
  }
  return { add, calls, messages, slack, texts: () => messages.map((m) => m.text) }
}
