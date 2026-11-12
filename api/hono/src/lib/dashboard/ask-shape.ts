import { ASK_CODE_COLUMNS } from "@packages/config/inbox"

// An Inbox ask reads the way chat talks to the owner: a picture of the point first, with a one-sentence note under it (the plain-words skill), then short bullets, then its options, in its `options` and `deny` labels.

// Past this many characters, an ask's text with no picture and no bullets reads as a wall of prose.
export const PROSE_LIMIT = 300

const FENCE = /^\s*```/m
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/m

// What bun run ask says of an ask's shape: the words live in bin/dashboard-ask.ts, outside the app copy tests/web/next/src/ui-copy.test.ts reads.
export type ShapeHint =
  | { kind: "prose" }
  | { kind: "unlabelled" }
  | { kind: "unlinked"; refs: string[] }
  | { kind: "wide"; longest: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Pure: the characters in the longest line inside a text's code blocks, counted by code point, so a box-drawing character counts as one; a diff block is skipped, since the card wraps it.
const longestCodeLine = (text: string): number => {
  let inside = false
  let diff = false
  let longest = 0
  for (const line of text.split("\n")) {
    const fence = line.match(/^\s*```\s*(\S*)/)
    if (fence) {
      diff = !inside && fence[1]!.toLowerCase() === "diff"
      inside = !inside
    } else if (inside && !diff) longest = Math.max(longest, [...line].length)
  }
  return longest
}

// What the owner would open from a card: a PR (a number of 2 digits or more after a #, so step #1 is none, or any after PR), a tracker ID (ABC-123) or a commit sha (7 to 40 hex characters, holding a digit and a letter); an Inbox ref (#iN) is none.
const REF =
  /(?<![\w#/&])#\d{2,}\b|\bPR\s*#?\d+\b|(?<![\w/-])[A-Z]{2,10}-\d+(?![\w-])|(?<![\w-])[0-9a-f]{7,40}(?![\w-])/g
// Encodings and standards that read as a team key and a number.
const NOT_TRACKERS = new Set(["ISO", "SHA", "UTF"])
const LINKED = /\]\([^)]+\)|https?:\/\//

// Pure: the refs a text names on a line outside its code blocks with no link on that line, each once, in order.
const unlinkedRefs = (text: string): string[] => {
  const refs = new Set<string>()
  let inside = false
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inside = !inside
    else if (!inside && !LINKED.test(line))
      for (const [ref] of line.matchAll(REF)) {
        const sha = /^[0-9a-f]+$/.test(ref)
        if (sha && !(/\d/.test(ref) && /[a-f]/.test(ref))) continue
        if (NOT_TRACKERS.has(ref.split("-")[0]!)) continue
        refs.add(ref)
      }
  }
  return [...refs]
}

// Pure: the hints for an `ask` decision: one when its text runs past PROSE_LIMIT with no list, no code block and no attachments, one when it labels no options, one when a code block other than a diff holds a line past ASK_CODE_COLUMNS, one when a line names a PR, a tracker ID or a commit with no link on it; the wide and unlinked ones alone for a read-only update's text, which renders on the same card; none for any other item, which posts either way.
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
  // an ask with neither options nor an approve label shows the bare Approve and Deny, but a questions ask, which labels each question's own options
  if (
    ask &&
    preview.options === undefined &&
    preview.approve === undefined &&
    preview.questions === undefined
  ) {
    hints.push({ kind: "unlabelled" })
  }
  const refs = unlinkedRefs(text)
  if (refs.length > 0) hints.push({ kind: "unlinked", refs })
  const longest = longestCodeLine(text)
  if (longest > ASK_CODE_COLUMNS) hints.push({ kind: "wide", longest })
  return hints
}

// A template for each shape the docs work through, each picture with its one-sentence note under it: a code change led by a diff, a plain decision led by an ASCII flow, a UI change, whose before and after pictures join it as attachments once the card takes attachments, and a Slack message led by its thread so far.
export const ASK_EXAMPLES = {
  code: {
    from: "builder",
    preview: {
      deny: "Keep it on dev",
      options: [{ label: "Port the fix to staging, then main" }],
      text: [
        "```diff",
        "- const limit = 100",
        "+ const limit = rows.length",
        "```",
        "",
        "The export fix is ready to port to staging and main.",
        "",
        "- 🐛 The export ends at 100 rows.",
        "- ✅ The fix runs on dev since 24 Oct, with no errors.",
        "- ↩️ One commit reverts it.",
        "- 🎯 It touches the export alone.",
      ].join("\n"),
      type: "ask",
    },
    title: "Port the export fix to staging and main?",
  },
  decision: {
    from: "builder",
    preview: {
      deny: "Turn the request down",
      options: [{ label: "Take the request and run the dry run" }],
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
        "A dry run of the export job waits on your yes.",
        "",
        "- 📨 The web-api session asks for a dry run of the export job.",
        "- 🧪 The run is on dev only and writes no rows.",
        "- ⏱️ It takes about 10 minutes.",
      ].join("\n"),
      type: "ask",
    },
    title: "Take the web-api session's request for an export dry run?",
  },
  delete: {
    from: "builder",
    kind: "decision",
    preview: {
      type: "delete",
      what: "/Users/you/playground/.claude/worktrees/PG-12-old-export",
      why: [
        "Its PR is open, and its branch holds 2 commits no merge landed.",
        "",
        "- 🗑️ Approve moves it to the trash, kept 7 days; playground rm --restore brings it back.",
        "- ✋ Deny leaves it in place.",
      ].join("\n"),
    },
    title: "Delete the old export worktree?",
  },
  questions: {
    from: "builder",
    preview: {
      questions: [
        {
          options: [
            { description: "a day of soak before main", label: "Staging first" },
            { label: "Straight to main" },
          ],
          question: "Where should the export fix land first?",
          recommended: 0,
        },
        {
          options: [{ label: "Now" }, { label: "After the next ship" }],
          question: "When should it go out?",
        },
      ],
      text: "Two calls on the export fix, one for each.",
      type: "ask",
    },
    title: "How should the export fix roll out?",
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
      attachments: [
        { group: "Inbox card", label: "before", src: "/Users/you/shots/card-before.png" },
        { group: "Inbox card", label: "after", src: "/Users/you/shots/card-after.png" },
      ],
      deny: "Keep the card as it is",
      options: [{ label: "Build the row as the after picture shows" }],
      text: [
        "The Inbox card can show its pictures as one thumbnail row.",
        "",
        "- 🖼️ The Inbox card shows its pictures as a row of thumbnails.",
        "- 👆 A click opens the picture in the viewer.",
        "- 📱 The row scrolls sideways on a phone.",
        "- ↩️ One revert puts the old card back.",
        "- 🎯 It touches the Inbox card alone.",
      ].join("\n"),
      type: "ask",
    },
    title: "Show an ask's pictures as a thumbnail row?",
  },
} as const

export type AskExampleKind = keyof typeof ASK_EXAMPLES

export const isAskExampleKind = (kind: string): kind is AskExampleKind =>
  Object.hasOwn(ASK_EXAMPLES, kind)
