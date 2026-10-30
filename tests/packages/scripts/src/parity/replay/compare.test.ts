import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  boardSignature,
  daySignature,
  finalText,
  majority,
  triageMajority,
  triageSignature,
  verdict,
} from "../../../../../../packages/scripts/src/parity/replay/compare"

// A made-up board report in the layout the board scan writes, frozen in the tree since the scan's skill lives in an extension.
const sample = () =>
  Bun.file(
    join(import.meta.dir, "../../../../../api/hono/src/lib/apps/fixtures/board-report.md"),
  ).text()

const event = (value: object) => JSON.stringify(value)
const use = (id: string, name: string, input: object = {}) =>
  event({ message: { content: [{ id, input, name, type: "tool_use" }] }, type: "assistant" })
const result = (text: string, denials: object[] = []) =>
  event({ permission_denials: denials, result: text, type: "result" })

describe("boardSignature", () => {
  test("reads a made-up report, row by row with its count line", async () => {
    const signature = JSON.parse(boardSignature(await sample()))
    expect(signature.count).toBe("💻 1 mine · ✅ 1 free · 🔍 2 to check · ⏭️ 2 skipped")
    expect(signature.rows).toHaveLength(6)
    expect(signature.rows.find((row: string[]) => row[0] === "ACME-9102")).toEqual([
      "ACME-9102",
      "Check",
      "T2",
      "Urgent",
      null,
      "Merritt",
    ])
  })

  test("free text and the header's time do not count; a tier, a status or a row does", async () => {
    const text = await sample()
    const base = boardSignature(text)
    expect(boardSignature(text.replace("Mon 5 Oct, 1:12 pm", "Tue 6 Oct, 9:00 am"))).toBe(base)
    expect(boardSignature(text.replace("Reschedule sends", "Rescheduling sends"))).toBe(base)
    expect(boardSignature(text.replace("then /triage ACME-9103", "then look"))).toBe(base)
    expect(boardSignature(text.replace("| 🟡 T2 |", "| 🟠 T3 |"))).not.toBe(base)
    expect(boardSignature(text.replace("| Assigned |", "| Owner: Anne |"))).toBe(base)
    expect(boardSignature(text.replace("Ask Alex, Kim", "Ask Kim"))).not.toBe(base)
  })

  test("a report the dashboard cannot read is its own signature, so it never matches a board", () => {
    expect(boardSignature("no board here")).toBe("unreadable")
  })
})

describe("daySignature", () => {
  const day = [
    "## 🌙 End of day · Thu 8 Oct",
    "",
    "• #31, #32: enquiry notes in the drawer (ACME-144, live on prod)",
    "• #33: names the home it asked about (on dev) [no ticket]",
    "• released to prod: ACME-119, ACME-122",
    "• Port of the listing feed: triaged and split with Merritt",
    "",
    "1 line has no ticket: #33.",
  ].join("\n")

  test("each line's ids, as sets, and its no-ticket flag", () => {
    expect(JSON.parse(daySignature(day))).toEqual([
      { flagged: false, ids: ["#31", "#32", "ACME-144"] },
      { flagged: false, ids: ["ACME-119", "ACME-122"] },
      { flagged: false, ids: [] },
      { flagged: true, ids: ["#33"] },
    ])
  })

  test("order and wording do not count; an id or a flag does", () => {
    const base = daySignature(day)
    const lines = day.split("\n")
    const swapped = [...lines.slice(0, 2), lines[3], lines[2], ...lines.slice(4)].join("\n")
    expect(daySignature(swapped)).toBe(base)
    expect(daySignature(day.replace("enquiry notes in the drawer", "notes"))).toBe(base)
    expect(daySignature(day.replace("#32", "#34"))).not.toBe(base)
    expect(daySignature(day.replace(" [no ticket]", ""))).not.toBe(base)
  })
})

describe("triageSignature", () => {
  const run = [
    use("r", "Read", { file_path: "/skills/triage/SKILL.md" }),
    use("t", "ToolSearch", { query: "slack" }),
    use("a", "mcp__linear-shared__get_issue", { id: "ACME-7" }),
    use("b", "mcp__linear-shared__list_comments", { issueId: "ACME-7" }),
    use("c", "mcp__linear-shared__get_issue", { id: "ACME-8" }),
    use("d", "Bash", { command: "gh search prs --owner acme ACME-7" }),
    use("e", "mcp__linear-shared__save_issue", { assignee: "me", id: "ACME-7" }),
    use("f", "mcp__slack-shared__slack_send_message", { channel_id: "U0SAM", text: "Hi" }),
    result("done", [
      {
        tool_input: { assignee: "me", id: "ACME-7" },
        tool_name: "mcp__linear-shared__save_issue",
        tool_use_id: "e",
      },
      {
        tool_input: { channel_id: "U0SAM", text: "Hi" },
        tool_name: "mcp__slack-shared__slack_send_message",
        tool_use_id: "f",
      },
      { tool_input: { command: "ls /skills" }, tool_name: "Bash", tool_use_id: "g" },
    ]),
  ]

  test("the system reads A to Z, and every refused write with its target, the harness's own tools aside", () => {
    expect(JSON.parse(triageSignature(run))).toEqual({
      denials: [
        "mcp__linear-shared__save_issue ACME-7 me",
        "mcp__slack-shared__slack_send_message U0SAM",
      ],
      reads: [
        "Bash(gh search)",
        "mcp__linear-shared__get_issue",
        "mcp__linear-shared__list_comments",
      ],
    })
  })

  test("a read's order, repeat or arguments do not count; a write's target does", () => {
    const base = triageSignature(run)
    expect(
      triageSignature([use("z", "mcp__linear-shared__get_issue", { id: "ACME-9" }), ...run]),
    ).toBe(base)
    expect(triageSignature([run[0]!, run[1]!, run[5]!, ...run.slice(2, 5), ...run.slice(6)])).toBe(
      base,
    )
    expect(triageSignature(run.map((line) => line.replaceAll("U0SAM", "U0KIM")))).not.toBe(base)
  })
})

describe("finalText", () => {
  test("is the result event's text, and empty with none", () => {
    expect(finalText([use("a", "Read"), result("the report")])).toBe("the report")
    expect(finalText(["not json", use("a", "Read")])).toBe("")
  })
})

describe("majority and verdict", () => {
  test("a majority is more than half the runs", () => {
    expect(majority(["a", "b", "a"])).toBe("a")
    expect(majority(["a", "b", "c"])).toBeNull()
    expect(majority(["a", "b"])).toBeNull()
  })

  test("same when both sides' majorities match; noisy when either side has none", () => {
    expect(verdict(["a", "a", "b"], ["a", "c", "a"])).toEqual({
      after: "a",
      before: "a",
      outcome: "same",
    })
    expect(verdict(["a", "a", "a"], ["b", "b", "a"])).toEqual({
      after: "b",
      before: "a",
      outcome: "changed",
    })
    expect(verdict(["a", "b", "c"], ["a", "a", "a"]).outcome).toBe("noisy")
    expect(verdict(["a", "a", "b"], ["a", "b", "c", "b"]).outcome).toBe("noisy")
  })
})

describe("triageMajority", () => {
  const sig = (...reads: string[]) => JSON.stringify({ denials: [], reads: reads.sort() })
  const CORE = ["Bash(gh search)", "get_issue", "list_comments", "search_messages"]
  // The 10-run measured: one optional read in about half the after runs, so no exact set holds a majority there.
  const before = [
    ...Array(6).fill(sig(...CORE)),
    sig("get_issue", "list_comments"),
    sig("get_issue", "list_comments"),
    sig(...CORE, "list_users"),
    sig(...CORE, "conversations_replies", "list_commits"),
  ]
  const after = [
    ...Array(4).fill(sig(...CORE)),
    sig(...CORE, "list_users"),
    sig(...CORE, "list_users"),
    sig(...CORE, "conversations_replies"),
    sig(...CORE, "conversations_history"),
    sig("Bash(gh search)", "get_issue", "list_comments"),
    sig("get_issue", "list_comments"),
  ]

  test("a side's reads and refused writes are each one more than half its runs make", () => {
    expect(majority(after)).toBeNull()
    expect(triageMajority(after)).toBe(sig(...CORE))
    expect(
      triageMajority([
        JSON.stringify({ denials: ["save_issue ACME-7"], reads: ["get_issue"] }),
        JSON.stringify({ denials: ["save_issue ACME-7"], reads: [] }),
        JSON.stringify({ denials: [], reads: ["get_issue"] }),
      ]),
    ).toBe(JSON.stringify({ denials: ["save_issue ACME-7"], reads: ["get_issue"] }))
  })

  test("an optional read in about half the runs reads same; a read most runs drop reads changed", () => {
    expect(verdict(before, after, triageMajority).outcome).toBe("same")
    const dropped = after.map((s) => s.replace(',"search_messages"', ""))
    expect(verdict(before, dropped, triageMajority).outcome).toBe("changed")
  })
})
