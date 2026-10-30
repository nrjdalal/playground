import { agentLabel, messageRecipient, withoutRef } from "@/lib/agent-label"
import type { DashboardMessage, DashboardToolPart } from "@/lib/chat"

// What a working session's spinner line says, as the API's activity frame carries it (api/hono/src/lib/dashboard/activity.ts): the verb alone and numbers, never the screen's text.
export type Activity = {
  elapsed: number | null
  thought: number | null
  tokens: number | null
  verb: string
}

// The frame the dashboard socket sends for the one chat it watches: its activity, or null once it stops.
export type ActivityFrame = { activity: Activity | null; sessionId: string; type: "activity" }

// The newest frame's reading, kept with its session so a chat never shows another's.
export type SessionActivity = Omit<ActivityFrame, "type">

const TARGET_MAX = 40

const clip = (text: string, max = TARGET_MAX): string => {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text
}

// A file by its folder and name (dashboard/sidebar.tsx), short enough for one line.
const shortPath = (path: string): string => path.split("/").filter(Boolean).slice(-2).join("/")

// A command by its first few words, from its first line.
const firstWords = (command: string, count = 4): string =>
  (command.trim().split("\n")[0] ?? "").split(/\s+/).filter(Boolean).slice(0, count).join(" ")

const inputOf = (part: Pick<DashboardToolPart, "input">): Record<string, unknown> => {
  try {
    const json: unknown = JSON.parse(part.input.json)
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "")

const FILE_VERBS: Record<string, string> = {
  Edit: "Editing",
  MultiEdit: "Editing",
  NotebookEdit: "Editing",
  Read: "Reading",
  Write: "Writing",
}

// Pure: a tool call as the step a session is on, a verb and a short target: Reading dashboard/sidebar.tsx, Running bun run test, Messaging Builder. Its target comes from the call's input, or its one-line summary when the input was clipped past parsing; a tool it does not know reads as its label and summary.
export function stepSummary(part: Pick<DashboardToolPart, "input" | "title" | "toolName">): string {
  const input = inputOf(part)
  const { summary } = part.input
  const fileVerb = FILE_VERBS[part.toolName]
  if (fileVerb) return `${fileVerb} ${clip(shortPath(str(input.file_path) || summary))}`
  if (part.toolName === "Bash") return `Running ${clip(firstWords(str(input.command) || summary))}`
  if (part.toolName === "SendMessage") {
    const to = str(input.to) || messageRecipient(summary)?.to || ""
    return to ? `Messaging ${clip(agentLabel(withoutRef(to)))}` : "Messaging"
  }
  if (part.toolName === "Grep" || part.toolName === "Glob")
    return `Searching ${clip(str(input.pattern) || summary)}`
  const label = part.title ?? part.toolName
  return summary ? `${label} ${clip(summary)}` : label
}

const unfinished = (part: DashboardMessage["parts"][number]): part is DashboardToolPart =>
  part.type === "dynamic-tool" &&
  (part.state === "input-available" || part.state === "input-streaming")

// Pure: the step a session is on, its newest call in the current turn with no result yet; null when the newest message is not its turn, or every call there has its result.
export function stepOf(messages: DashboardMessage[]): string | null {
  const last = messages.at(-1)
  if (last?.role !== "assistant") return null
  const part = last.parts.findLast(unfinished)
  return part ? stepSummary(part) : null
}

// Pure: seconds as Claude Code writes them: 4s, 1m 11s, 1h 2m.
export function elapsedLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// Pure: a token count as Claude Code writes it: 950 tokens, 2.1k tokens, 1.5m tokens. Millions start at 999,950, which in thousands would round up to 1000k.
export function tokensLabel(tokens: number): string {
  const unit = tokens === 1 ? "token" : "tokens"
  if (tokens >= 999_950) return `${Number((tokens / 1_000_000).toFixed(1))}m ${unit}`
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}k ${unit}`
  return `${tokens} ${unit}`
}

// The watch a dashboard socket keeps: the chat open now, sent when it changes and again on every connect, since a new socket watches nothing.
export function createWatch() {
  let current: string | null = null
  let send: ((data: string) => void) | null = null
  const message = (sessionId: string | null) => JSON.stringify({ sessionId, type: "watch" })
  return {
    connected(next: (data: string) => void) {
      send = next
      if (current !== null) send(message(current))
    },
    // Only the socket that connected last lets go, so an older socket closing late never silences the new one.
    disconnected(from: (data: string) => void) {
      if (send === from) send = null
    },
    set(sessionId: string | null) {
      if (sessionId === current) return
      current = sessionId
      send?.(message(sessionId))
    },
  }
}
