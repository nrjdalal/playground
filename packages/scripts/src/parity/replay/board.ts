// The board scan's report read into its rows, for the board replay's signature: the scan's skill lives in an extension, so its layout is frozen here.
export type BoardStatus = "Check" | "Free" | "Mine" | "Skip"

export type BoardRow = {
  assignee: string | null
  id: string
  next: string | null
  priority: string | null
  status: BoardStatus
  tier: string | null
}

const STATUSES: readonly BoardStatus[] = ["Check", "Free", "Mine", "Skip"]
// The board's renderer draws an empty cell as an em-dash (U+2014); the hand-written fallback may use a hyphen.
const EMPTY_CELLS = new Set(["", "-", "\u2014"])

const ID = "[A-Z][A-Z0-9]*-\\d+"

// The report opens on the board's marker, then any title, then its time; read by that shape, so a report under an older title still parses.
const HEADING_RE = /^##\s+📋\s+.+?\s+·\s+(.+)$/u
const COUNT_RE = /(\d+)\s+(?:mine|free|to check|skipped)\b/g
const TICKET_RE = new RegExp(`^(?:\\[(${ID})\\]\\(([^)\\s]+)\\)|(${ID}))\\s*(?:·\\s*(.*))?$`)

const cellValue = (cell: string): string | null => (EMPTY_CELLS.has(cell) ? null : cell)

// The emoji the renderer puts beside a word ("🟠 High", "⏭ Skip") is dropped, keeping the word.
const word = (cell: string): string | null => cellValue(cell.replace(/^[^\p{L}\p{N}]+/u, "").trim())

const CI_WORDS: [RegExp, string][] = [
  [/CI ✅\uFE0F?/gu, "CI green"],
  [/CI ❌\uFE0F?/gu, "CI red"],
  [/CI ⏳\uFE0F?/gu, "CI running"],
]

// A Next cell in words alone: the CI marks the scan writes become words (CI ✅ is CI green), and any other emoji is dropped with the space after it. Only what draws as an emoji goes: a symbol that draws as text unless asked otherwise (™, ©, ↔) stays.
export function plainText(text: string): string {
  let plain = text
  for (const [mark, words] of CI_WORDS) plain = plain.replace(mark, words)
  return plain.replace(/(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)\s?/gu, "").trim()
}

// A Markdown table row's cells, undoing the renderer's escapes: `\\` is a backslash and `\|` a pipe inside a cell, and any other pipe ends one.
export function tableCells(line: string): string[] {
  const row = line.trim()
  const cells: string[] = []
  let cell = ""
  let endsOnPipe = false
  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    const next = row[i + 1]
    endsOnPipe = false
    if (char === "\\" && (next === "\\" || next === "|")) {
      cell += next
      i++
    } else if (char === "|") {
      cells.push(cell.trim())
      cell = ""
      endsOnPipe = true
    } else cell += char
  }
  if (!endsOnPipe) cells.push(cell.trim())
  if (row.startsWith("|")) cells.shift()
  return cells
}

type Columns = { ask: number | null; width: number }

// Where a report's table keeps who to ask: in Next, as `Ask <who>: <what>, then <step>`, or, in a report written before the two merged, in an Ask column of its own just before Next step. Next is the last column either way. Null for a header that is neither.
export function tableColumns(header: string[]): Columns | null {
  const names = header.map((cell) => cell.replaceAll("&nbsp;", "").trim())
  if (!names[1]?.startsWith("Ticket")) return null
  if (names.length === 7) return { ask: null, width: 7 }
  if (names.length === 8 && names[6] === "Ask") return { ask: 6, width: 8 }
  return null
}

// An older report's Ask and Next step, folded into the one Next cell a report writes today: "Ask <who>, then <next>". A Next step that already opens with the person reads on from their name rather than naming them twice.
export function foldAsk(ask: string | null, next: string | null): string | null {
  if (!ask) return next
  const asking = /^ask\b/i.test(ask) ? ask : `Ask ${ask}`
  if (!next) return asking
  const opensWithName =
    next.toLowerCase().startsWith(ask.toLowerCase()) && /^[\s:]/.test(next.slice(ask.length))
  if (opensWithName) return `Ask ${next}`
  return `${asking}, then ${next}`
}

const rowOf = (cells: string[], columns: Columns): BoardRow | null => {
  if (cells.length !== columns.width) return null
  const [statusCell, ticketCell, priority, , assignee, tier] = cells
  const status = STATUSES.find((s) => s === word(statusCell ?? ""))
  const match = TICKET_RE.exec(ticketCell ?? "")
  if (!status || !match) return null
  const next = cellValue(plainText(cells[columns.width - 1] ?? ""))
  return {
    assignee: cellValue(assignee ?? ""),
    id: match[1] ?? match[3] ?? "",
    next:
      columns.ask === null ? next : foldAsk(cellValue(plainText(cells[columns.ask] ?? "")), next),
    priority: word(priority ?? ""),
    status,
    tier: word(tier ?? ""),
  }
}

// Pure: one finished report (the scan's last message) in, its rows out. Null for anything that is not a whole report in today's shape or the one before it (separate Ask and Next step columns, folded by `foldAsk`), which includes a row count that disagrees with the count line, so an older layout or a cut-off reply never reads as a short board.
export function parseReport(text: string): BoardRow[] | null {
  const lines = text.split("\n").map((line) => line.trimEnd())
  const headingAt = lines.findIndex((line) => HEADING_RE.test(line))
  if (headingAt === -1) return null
  const countLine = lines.slice(headingAt + 1).find((line) => line.trim() !== "") ?? ""
  const counts = [...countLine.matchAll(COUNT_RE)].map((m) => Number(m[1]))
  if (counts.length === 0) return null

  const rows: BoardRow[] = []
  let columns: Columns | null = null
  for (const line of lines.slice(headingAt + 1)) {
    if (!line.startsWith("|")) {
      columns = null
      continue
    }
    const cells = tableCells(line)
    if (!columns) {
      columns = tableColumns(cells)
      continue
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
    const row = rowOf(cells, columns)
    if (!row) return null
    rows.push(row)
  }
  return rows.length === counts.reduce((sum, n) => sum + n, 0) ? rows : null
}
