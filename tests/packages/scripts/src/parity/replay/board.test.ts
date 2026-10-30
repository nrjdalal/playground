import { describe, expect, test } from "bun:test"

import {
  foldAsk,
  parseReport,
  plainText,
  tableCells,
  tableColumns,
} from "../../../../../../packages/scripts/src/parity/replay/board"

const DASH = "\u2014"
const issue = (id: string) => `https://linear.example.test/acme/issue/${id}`

// A report in the board renderer's shape, with made-up tickets.
const REPORT = [
  "## 📋 Board · Tue 6 Oct, 9:05 am IST",
  "",
  "💻 1 mine · ✅ 1 free · 🔍 1 to check · ⏭️ 1 skipped",
  "",
  "|  | Ticket&nbsp;&nbsp;&nbsp; | Priority | Age | Assignee | Tier | Next |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  `| 💻 Mine | [CEDAR-9100](${issue("CEDAR-9100")}) · Inbox rows say when contact began | 🟠 High | 6d | Ada | ${DASH} | Ask Grace: approve #7 (5/5 · CI ✅), then merge |`,
  `| ✅ Free | [DUNE-9101](${issue("DUNE-9101")}) · Reschedule sends the reminder twice | 🔴 Urgent | 2d | ${DASH} | 🟢 T1 | /acme DUNE-9101 |`,
  `| 🔍 Check | EMBER-9102 · Regression run skips a \\| piped step | 🟡 Medium | 3d | ${DASH} | 🟡 T2 | Ask Linus: is he on it, then /acme EMBER-9102 |`,
  `| ⏭️ Skip | [DUNE-9104](${issue("DUNE-9104")}) · Reset token is written to logs | ${DASH} | ${DASH} | Barbara | ${DASH} | Assigned |`,
  "",
  "### 📝 Notes",
  "",
  `- **[CEDAR-9100](${issue("CEDAR-9100")})** has two findings left.`,
].join("\n")

describe("tableCells", () => {
  test("splits a row on its pipes and keeps an escaped pipe inside its cell", () => {
    expect(tableCells("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"])
  })

  test("undoes the renderer's escaped backslash, so a backslash before a pipe stays one", () => {
    expect(tableCells("| C:\\\\tmp | a \\\\\\| b | end\\\\ |")).toEqual([
      "C:\\tmp",
      "a \\| b",
      "end\\",
    ])
  })

  test("a backslash before anything else is kept as written, and an empty first cell stays", () => {
    expect(tableCells("| C:\\tmp |")).toEqual(["C:\\tmp"])
    expect(tableCells("|  | Ticket | Priority |")).toEqual(["", "Ticket", "Priority"])
  })
})

describe("tableColumns", () => {
  test("today's header keeps who to ask in Next, an older one in an Ask column before Next step", () => {
    expect(
      tableColumns(["", "Ticket&nbsp;&nbsp;", "Priority", "Age", "Assignee", "Tier", "Next"]),
    ).toEqual({ ask: null, width: 7 })
    expect(
      tableColumns(["", "Ticket", "Priority", "Age", "Assignee", "Tier", "Ask", "Next step"]),
    ).toEqual({ ask: 6, width: 8 })
  })

  test("any other header is no board table", () => {
    expect(tableColumns(["", "Name", "Priority"])).toBeNull()
    expect(
      tableColumns(["", "Ticket", "Priority", "Age", "Assignee", "Tier", "Owner", "Next"]),
    ).toBeNull()
  })
})

describe("foldAsk", () => {
  test("puts who to ask before the next step, and none leaves it as it was", () => {
    expect(foldAsk("Soren", "Confirm he is not on it")).toBe(
      "Ask Soren, then Confirm he is not on it",
    )
    expect(foldAsk(null, "/acme DUNE-9101")).toBe("/acme DUNE-9101")
    expect(foldAsk(null, null)).toBeNull()
  })

  test("a next step that opens with the person names them once, and Ask is never said twice", () => {
    expect(foldAsk("Soren", "Soren to confirm the fix")).toBe("Ask Soren to confirm the fix")
    expect(foldAsk("Al", "Alan owns it")).toBe("Ask Al, then Alan owns it")
    expect(foldAsk("Ask Soren", "merge")).toBe("Ask Soren, then merge")
    expect(foldAsk("Soren", null)).toBe("Ask Soren")
  })
})

describe("parseReport", () => {
  test("reads every row's status, ticket, priority, assignee, tier and Next", () => {
    expect(parseReport(REPORT)).toEqual([
      {
        assignee: "Ada",
        id: "CEDAR-9100",
        next: "Ask Grace: approve #7 (5/5 · CI green), then merge",
        priority: "High",
        status: "Mine",
        tier: null,
      },
      {
        assignee: null,
        id: "DUNE-9101",
        next: "/acme DUNE-9101",
        priority: "Urgent",
        status: "Free",
        tier: "T1",
      },
      {
        assignee: null,
        id: "EMBER-9102",
        next: "Ask Linus: is he on it, then /acme EMBER-9102",
        priority: "Medium",
        status: "Check",
        tier: "T2",
      },
      {
        assignee: "Barbara",
        id: "DUNE-9104",
        next: "Assigned",
        priority: null,
        status: "Skip",
        tier: null,
      },
    ])
  })

  test("an older report, with Ask and Next step apart, reads as one Next cell", () => {
    const older = [
      "## 📋 Board · Mon 5 Oct, 1:12 pm IST",
      "",
      "💻 1 mine · ✅ 1 free",
      "",
      "|  | Ticket | Priority | Age | Assignee | Tier | Ask | Next step |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      `| 💻 Mine | CEDAR-9100 · Inbox rows | 🟠 High | 6d | Ada | ${DASH} | Grace | #7 · 4/5 · CI ❌ |`,
      `| ✅ Free | DUNE-9101 · Reminder twice | 🔴 Urgent | 2d | ${DASH} | 🟢 T1 | ${DASH} | /acme DUNE-9101 |`,
    ].join("\n")
    expect(parseReport(older)?.map((row) => row.next)).toEqual([
      "Ask Grace, then #7 · 4/5 · CI red",
      "/acme DUNE-9101",
    ])
  })

  test("a report with no rows is a valid, empty board", () => {
    expect(
      parseReport("## 📋 Board · Tue 6 Oct, 9:05 am IST\n\n✅ 0 free · 🔍 0 to check"),
    ).toEqual([])
  })

  test("anything but a whole report in a known layout is no board", () => {
    expect(parseReport(REPORT.replace("| Tier | Next |", "| Tier | Owner | Next |"))).toBeNull()
    expect(parseReport(REPORT.replace("✅ 1 free", "✅ 2 free"))).toBeNull()
    expect(parseReport("Here is the board you asked for.")).toBeNull()
    const boxed = [
      "## 📋 Board · Mon 5 Oct, 5:14 pm IST",
      "",
      "✅ 0 free · 🔍 1 to check",
      "",
      "```text",
      "│ Check │ EMBER-1   │",
      "```",
    ].join("\n")
    expect(parseReport(boxed)).toBeNull()
  })
})

describe("plainText", () => {
  test("the scan's CI marks become words, and any other pictograph goes with the space after it", () => {
    expect(plainText("Ask Soren: approve #7 (5/5 · CI ✅), then merge")).toBe(
      "Ask Soren: approve #7 (5/5 · CI green), then merge",
    )
    expect(plainText("#7 · 4/5 · CI ❌")).toBe("#7 · 4/5 · CI red")
    expect(plainText("#7 · reviewing · CI ⏳")).toBe("#7 · reviewing · CI running")
    expect(plainText("#7 · 5/5 · CI \u2705\ufe0f")).toBe("#7 · 5/5 · CI green")
    expect(plainText("⏭️ Skip")).toBe("Skip")
  })

  test("a symbol that draws as text stays", () => {
    expect(plainText("Rename the ACME™ module")).toBe("Rename the ACME™ module")
    expect(plainText("Fix the A ↔ B mapping © 2026")).toBe("Fix the A ↔ B mapping © 2026")
  })
})
