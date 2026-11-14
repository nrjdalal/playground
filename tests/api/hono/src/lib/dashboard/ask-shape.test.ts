import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  ASK_EXAMPLES,
  isAskExampleKind,
  PROSE_LIMIT,
  shapeHints,
} from "../../../../../../api/hono/src/lib/dashboard/ask-shape"
import {
  deleteRefusal,
  targetWords,
} from "../../../../../../api/hono/src/lib/dashboard/delete-targets"
import {
  attachmentSourceSchema,
  inboxInputSchema,
} from "../../../../../../api/hono/src/lib/dashboard/inbox"
import { ASK_CODE_COLUMNS } from "../../../../../../packages/config/src/inbox"

const PROSE =
  "The export job ends at a hundred rows because the limit is fixed in the query, and the fix reads the real row count instead; it has run on dev since the twenty-fourth with no errors, and a single commit reverts it if anything goes wrong once it reaches staging or main, so I would like to port it to both today."

const ask = (text: string, extra: object = {}) => ({
  from: "builder",
  preview: { approve: "Port it", text, type: "ask", ...extra },
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

  test("hints at an ask that labels no options, and stays quiet on one labelled in options or approve (#873)", () => {
    const short = "Port the export fix to staging and main."
    expect(shapeHints({ ...ask(short), preview: { text: short, type: "ask" } })).toEqual([
      { kind: "unlabelled" },
    ])
    expect(
      shapeHints({
        ...ask(short),
        preview: { options: [{ label: "Port it" }], text: short, type: "ask" },
      }),
    ).toEqual([])
    expect(shapeHints(ask(short))).toEqual([])
    // a questions ask labels each question's own options, so it needs no top-level label
    expect(
      shapeHints({
        ...ask(short),
        preview: {
          questions: [{ options: [{ label: "A" }, { label: "B" }], question: "Which?" }],
          text: short,
          type: "ask",
        },
      }),
    ).toEqual([])
  })

  test("stays quiet on short prose and on every kind but an ask", () => {
    expect(shapeHints(ask("Port the export fix to staging and main."))).toEqual([])
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

  test("takes a drawing up to 72 columns, so a 60-column line posts quiet and a 73-column one still hints (#2050)", () => {
    const drawing = (columns: number) =>
      ask(`\`\`\`\n${"─".repeat(columns)}\n\`\`\`\n\n- One line.`)
    expect(shapeHints(drawing(60))).toEqual([])
    expect(shapeHints(drawing(72))).toEqual([])
    expect(shapeHints(drawing(73))).toEqual([{ kind: "wide", longest: 73 }])
  })

  test("skips a diff block's lines, which wrap on the card, and still hints at the same line in any other code block", () => {
    const wide = `+ ${"x".repeat(ASK_CODE_COLUMNS)}`
    for (const fence of ["```diff", "```Diff"])
      expect(shapeHints(ask(`${fence}\n${wide}\n\`\`\`\n\n- One line.`))).toEqual([])
    for (const fence of ["```", "```ts", "```text", "```diffstat"])
      expect(shapeHints(ask(`${fence}\n${wide}\n\`\`\`\n\n- One line.`))).toEqual([
        { kind: "wide", longest: ASK_CODE_COLUMNS + 2 },
      ])
    expect(shapeHints(ask(`\`\`\`diff\n${wide}\n\`\`\`\n\n\`\`\`\n${wide}\n\`\`\``))).toEqual([
      { kind: "wide", longest: ASK_CODE_COLUMNS + 2 },
    ])
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

describe("shapeHints: unlinked refs (#1020)", () => {
  const update = (text: string) => ({ kind: "update", preview: { outcome: "finding", text } })
  const unlinked = (text: string) =>
    shapeHints(update(text)).find((hint) => hint.kind === "unlinked")

  test("hints at a bare PR ref, tracker ID or commit sha, each named once", () => {
    expect(unlinked("Merged #1000 and PR 1001.")).toEqual({
      kind: "unlinked",
      refs: ["#1000", "PR 1001"],
    })
    expect(unlinked("MADECEDAR-2779 and MADEBRAVO-1322 are done; MADEBRAVO-1322 again.")).toEqual({
      kind: "unlinked",
      refs: ["MADECEDAR-2779", "MADEBRAVO-1322"],
    })
    expect(unlinked("Landed at d05240d6.")).toEqual({ kind: "unlinked", refs: ["d05240d6"] })
    expect(
      shapeHints(ask("Port it.\n\n- See #1000.", { options: [{ label: "Port it" }] })),
    ).toEqual([{ kind: "unlinked", refs: ["#1000"] }])
  })

  test("stays quiet on a ref linked in its line, inside a code block, or an Inbox ref", () => {
    expect(unlinked("Merged [#1000](https://github.com/acme/app/pull/1000).")).toBeUndefined()
    expect(
      unlinked("MADECEDAR-2779 is at https://linear.app/acme/issue/MADECEDAR-2779"),
    ).toBeUndefined()
    expect(
      unlinked("[`d05240d6`](https://github.com/acme/app/commit/d05240d6) landed."),
    ).toBeUndefined()
    expect(unlinked("```\nmerged #1000 at d05240d6 for MADEBRAVO-1322\n```")).toBeUndefined()
    expect(unlinked("Answered on #i369 and #i41.")).toBeUndefined()
  })

  test("leaves plain words, numbers, times, encodings and ids alone", () => {
    expect(
      unlinked("The export added 1234567 rows in UTF-8 at 15:46Z on 2026-11-05."),
    ).toBeUndefined()
    expect(unlinked("A defaced facade, step #1, and ISO-8601 dates.")).toBeUndefined()
    expect(unlinked("Item 019ff17e-8ecb-0000-0dba-f7ab1c805ec1 and page#1234.")).toBeUndefined()
  })

  test("hints on a draft, a slack decision and other kinds never", () => {
    expect(shapeHints({ kind: "draft", preview: { text: "See #1000.", to: "@Merritt" } })).toEqual(
      [],
    )
    expect(
      shapeHints({
        ...ask("See #1000."),
        preview: { text: "See #1000.", to: "@Merritt", type: "slack" },
      }),
    ).toEqual([])
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
      expect(example.preview.options[0]?.label).toBeTruthy()
      expect(example.preview.deny).toBeTruthy()
    }
    expect(isAskExampleKind("toString")).toBe(false)
  })

  // PG-1607: an owner message opens on its smallest picture with a short note beside it (the plain-words skill's owner style), so a template's picture leads and its one-sentence note follows; the UI template's picture is its attachments, so its text opens on the note
  test("each ask template leads with its picture, then a one-sentence note", () => {
    const note = /^[A-Z][^`]*\.$/
    for (const kind of ["code", "decision"] as const) {
      const lines = ASK_EXAMPLES[kind].preview.text.split("\n")
      expect(lines[0]).toMatch(/^```/)
      const close = lines.indexOf("```", 1)
      expect(close).toBeGreaterThan(0)
      expect(lines.slice(close + 1, close + 4)).toEqual(["", expect.stringMatching(note), ""])
    }
    const [first, gap] = ASK_EXAMPLES.ui.preview.text.split("\n")
    expect(first).toMatch(note)
    expect(gap).toBe("")
  })

  test("the UI template carries its before and after pictures as attachments by absolute path", () => {
    expect(
      ASK_EXAMPLES.ui.preview.attachments.map(({ label, src }) => [label, src.startsWith("/")]),
    ).toEqual([
      ["before", true],
      ["after", true],
    ])
  })

  // PG-1066: a delete names its worktree by the full path, so the template leads with one
  test("the delete template is a valid delete decision naming its worktree by the full path ask new reads", () => {
    const example = ASK_EXAMPLES.delete
    expect(inboxInputSchema.safeParse(example).error?.issues ?? []).toEqual([])
    expect(example.preview.type).toBe("delete")
    const [path] = targetWords(example.preview.what)
    expect(path).toMatch(/^\/.+\/\.claude\/worktrees\/[^/]+$/)
    const worktrees = path!.slice(0, path!.lastIndexOf("/"))
    const machine = { cwd: "/", exists: () => true, home: "/Users/you", worktrees }
    expect(deleteRefusal(example, machine)).toBeNull()
    // the card shows "Why: " before the first line, so a sentence leads and its bullets follow a blank line
    expect(example.preview.why.split("\n").slice(0, 2)).toEqual([
      expect.stringMatching(/^[^-]/),
      "",
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
    if ("questions" in preview) {
      for (const q of preview.questions) {
        expect(doc).toContain(q.question)
        for (const option of q.options) expect(doc).toContain(option.label)
      }
    } else {
      expect(doc).toContain(
        `Options: \`${preview.options?.[0]?.label}\`; Deny: \`${preview.deny}\`.`,
      )
    }
  }
})
