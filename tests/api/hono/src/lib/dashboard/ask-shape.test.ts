import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  ASK_EXAMPLES,
  isAskExampleKind,
  PROSE_LIMIT,
  shapeHints,
} from "../../../../../../api/hono/src/lib/dashboard/ask-shape"
import {
  attachmentSourceSchema,
  inboxInputSchema,
} from "../../../../../../api/hono/src/lib/dashboard/inbox"
import { ASK_CODE_COLUMNS } from "../../../../../../packages/config/src/inbox"

const PROSE =
  "The export job ends at a hundred rows because the limit is fixed in the query, and the fix reads the real row count instead; it has run on dev since the twenty-fourth with no errors, and a single commit reverts it if anything goes wrong once it reaches staging or main, so I would like to port it to both today."

const ask = (text: string, extra: object = {}) => ({
  from: "builder",
  preview: { text, type: "ask", ...extra },
  title: "Port the export fix?",
})

describe("shapeHints", () => {
  test("hints at the shape on an ask that is one block of prose past the limit", () => {
    expect(PROSE.length).toBeGreaterThan(PROSE_LIMIT)
    expect(shapeHints(ask(PROSE))).toEqual([{ kind: "prose" }])
  })

  test("stays quiet on a structured ask: a list, a code block or attachments", () => {
    expect(shapeHints(ask(`${PROSE}\n\n- One commit reverts it.`))).toEqual([])
    expect(shapeHints(ask(`${PROSE}\n\n1. Port to staging.`))).toEqual([])
    expect(shapeHints(ask(`\`\`\`diff\n- a\n+ b\n\`\`\`\n\n${PROSE}`))).toEqual([])
    expect(shapeHints(ask(PROSE, { attachments: [{ src: "/tmp/after.png" }] }))).toEqual([])
  })

  test("stays quiet on short prose and on every kind but an ask", () => {
    expect(shapeHints(ask("Port DUNE-1401's fix to staging and main."))).toEqual([])
    expect(
      shapeHints({ ...ask(PROSE), preview: { text: PROSE, to: "@Merritt", type: "slack" } }),
    ).toEqual([])
    expect(shapeHints({ kind: "draft", preview: { text: PROSE, to: "@Merritt" } })).toEqual([])
    expect(shapeHints(null)).toEqual([])
  })

  test("hints at a code or ASCII line wider than the card, and not at a wide line outside code", () => {
    const wide = "─".repeat(ASK_CODE_COLUMNS + 1)
    expect(shapeHints(ask(`\`\`\`\n${wide}\n\`\`\`\n\n- One line.`))).toEqual([
      { kind: "wide", longest: ASK_CODE_COLUMNS + 1 },
    ])
    expect(shapeHints(ask(`\`\`\`\n${"─".repeat(ASK_CODE_COLUMNS)}\n\`\`\``))).toEqual([])
    expect(shapeHints(ask(`- ${"word ".repeat(ASK_CODE_COLUMNS)}`))).toEqual([])
  })

  test("hints at a wide code line on a read-only update too, and never at its prose (PG-2489)", () => {
    const update = (text: string) => ({ kind: "update", preview: { outcome: "finding", text } })
    expect(shapeHints(update(`\`\`\`\n${"─".repeat(ASK_CODE_COLUMNS + 1)}\n\`\`\``))).toEqual([
      { kind: "wide", longest: ASK_CODE_COLUMNS + 1 },
    ])
    expect(shapeHints(update(PROSE))).toEqual([])
    expect(shapeHints({ kind: "update", preview: { outcome: "merged" } })).toEqual([])
  })
})

describe("ASK_EXAMPLES", () => {
  test("each template is a valid ask with the shape, so no hint fires on it", () => {
    for (const kind of ["code", "decision", "ui"] as const) {
      expect(isAskExampleKind(kind)).toBe(true)
      const example = ASK_EXAMPLES[kind]
      // attachments name files by path, which bun run ask new copies in before the item is checked
      const { attachments, ...preview } = example.preview as typeof example.preview & {
        attachments?: unknown[]
      }
      expect(inboxInputSchema.safeParse({ ...example, preview }).error?.issues ?? []).toEqual([])
      for (const source of attachments ?? [])
        expect(attachmentSourceSchema.safeParse(source).success).toBe(true)
      expect(shapeHints(example)).toEqual([])
      expect(example.preview.approve).toBeTruthy()
      expect(example.preview.deny).toBeTruthy()
    }
    expect(isAskExampleKind("toString")).toBe(false)
  })

  test("the UI template carries its before and after pictures as attachments by absolute path", () => {
    expect(
      ASK_EXAMPLES.ui.preview.attachments.map(({ label, src }) => [label, src.startsWith("/")]),
    ).toEqual([
      ["before", true],
      ["after", true],
    ])
  })

  test("the slack template is a valid slack decision led by its thread so far (#2287)", () => {
    expect(inboxInputSchema.safeParse(ASK_EXAMPLES.slack).error?.issues ?? []).toEqual([])
    expect(ASK_EXAMPLES.slack.preview.thread.length).toBeGreaterThan(0)
  })
})

test("asks.md shows each template's text as it is", async () => {
  const doc = (
    await Bun.file(join(import.meta.dir, "../../../../../../.agents/dashboard/asks.md")).text()
  )
    .split("\n")
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
  for (const { preview } of Object.values(ASK_EXAMPLES)) {
    if (preview.type !== "ask") continue
    expect(doc).toContain(preview.text)
    expect(doc).toContain(`Approve: \`${preview.approve}\`; Deny: \`${preview.deny}\`.`)
  }
})
