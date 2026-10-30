import { ASK_CODE_COLUMNS } from "@packages/config/inbox"

// An Inbox ask reads the way chat talks to the owner: a picture of the point first, then short bullets, then what Approve does, in its `approve` and `deny` labels.

// Past this many characters, an ask's text with no picture and no bullets reads as a wall of prose.
export const PROSE_LIMIT = 300

const FENCE = /^\s*```/m
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/m

// What bun run ask says of an ask's shape: the words live in bin/dashboard-ask.ts, outside the app copy tests/web/next/src/ui-copy.test.ts reads.
export type ShapeHint = { kind: "prose" } | { kind: "wide"; longest: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Pure: the characters in the longest line inside a text's code blocks, counted by code point, so a box-drawing character counts as one.
const longestCodeLine = (text: string): number => {
  let inside = false
  let longest = 0
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inside = !inside
    else if (inside) longest = Math.max(longest, [...line].length)
  }
  return longest
}

// Pure: the hints for an `ask` decision: one when its text runs past PROSE_LIMIT with no list, no code block and no attachments, one when a code block holds a line past ASK_CODE_COLUMNS; the wide one alone for a read-only update's text, which renders on the same card; none for any other item, which posts either way.
export function shapeHints(input: unknown): ShapeHint[] {
  const preview = isRecord(input) ? input.preview : undefined
  if (!isRecord(preview) || typeof preview.text !== "string") return []
  const ask = preview.type === "ask"
  if (!ask && !(isRecord(input) && input.kind === "update")) return []
  const text = preview.text
  const hints: ShapeHint[] = []
  const attached = Array.isArray(preview.attachments) && preview.attachments.length > 0
  if (ask && !attached && text.length > PROSE_LIMIT && !FENCE.test(text) && !LIST.test(text)) {
    hints.push({ kind: "prose" })
  }
  const longest = longestCodeLine(text)
  if (longest > ASK_CODE_COLUMNS) hints.push({ kind: "wide", longest })
  return hints
}

// A template for each shape the docs work through: a code change led by a diff, a plain decision led by an ASCII flow, a UI change, whose before and after pictures join it as attachments once the card takes attachments, and a Slack message led by its thread so far.
export const ASK_EXAMPLES = {
  code: {
    from: "builder",
    preview: {
      approve: "Port the fix to staging, then main",
      deny: "Keep it on dev",
      text: [
        "```diff",
        "- const limit = 100",
        "+ const limit = rows.length",
        "```",
        "",
        "- 🐛 The export ends at 100 rows.",
        "- ✅ The fix runs on dev since 24 Oct, with no errors.",
        "- ↩️ One commit reverts it.",
      ].join("\n"),
      type: "ask",
    },
    title: "Port the export fix to staging and main?",
  },
  decision: {
    from: "builder",
    preview: {
      approve: "Take the request and run the dry run",
      deny: "Turn the request down",
      text: [
        "```",
        "web-api",
        "   │ asks for a dry run",
        "   ▼",
        "builder ──runs──▶ export job (dev)",
        "   │",
        "   ▼",
        "report to you",
        "```",
        "",
        "- 📨 The web-api session asks for a dry run of the export job.",
        "- 🧪 The run is on dev only and writes no rows.",
        "- ⏱️ It takes about 10 minutes.",
      ].join("\n"),
      type: "ask",
    },
    title: "Take the web-api session's request for an export dry run?",
  },
  slack: {
    from: "builder",
    preview: {
      link: "https://app.slack.com/client/TXXXXXXXXXX/DXXXXXXXXXX",
      text: "hey, the fix is on staging now. can you try the export again?",
      thread: [
        {
          said: "The export ends at 100 rows, and the client needs all of them.",
          who: "Colleague",
        },
        { said: "Ping me when I can test it.", who: "Colleague" },
      ],
      to: "@colleague",
      type: "slack",
    },
    title: "Tell the colleague the export fix is on staging?",
  },
  ui: {
    from: "builder",
    preview: {
      approve: "Build the row as the after picture shows",
      attachments: [
        { group: "Inbox card", label: "before", src: "/Users/you/shots/card-before.png" },
        { group: "Inbox card", label: "after", src: "/Users/you/shots/card-after.png" },
      ],
      deny: "Keep the card as it is",
      text: [
        "- 🖼️ The Inbox card shows its pictures as a row of thumbnails.",
        "- 👆 A click opens the picture in the viewer.",
        "- 📱 The row scrolls sideways on a phone.",
      ].join("\n"),
      type: "ask",
    },
    title: "Show an ask's pictures as a thumbnail row?",
  },
} as const

export type AskExampleKind = keyof typeof ASK_EXAMPLES

export const isAskExampleKind = (kind: string): kind is AskExampleKind =>
  Object.hasOwn(ASK_EXAMPLES, kind)
