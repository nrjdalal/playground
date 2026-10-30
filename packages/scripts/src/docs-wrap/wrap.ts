// One sentence per line: two PRs that edit different sentences of one long line conflict, while a line a sentence keeps their edits apart. `wrap` breaks a prose line after each sentence and a sentence over LIMIT at a clause, changing no character but the spaces it turns into line breaks, so the rendered text stays the same (proof.ts checks that on every rewrap and every --proof).

// The longest line a wrapped file may hold outside a table, a code block or a heading; the transform breaks a sentence past it at a clause.
export const LIMIT = 400

// Words whose dot ends no sentence, lowercased without their last dot.
const ABBREVIATIONS = new Set([
  "a.m",
  "al",
  "approx",
  "ca",
  "cf",
  "dr",
  "e.g",
  "etc",
  "fig",
  "i.e",
  "incl",
  "jr",
  "mr",
  "mrs",
  "ms",
  "no",
  "p.m",
  "sr",
  "st",
  "u.s",
  "vs",
])

// A line starting so would open a block (a list item, a heading, a quote, a table, HTML or JSX, a fence, a thematic break or setext underline) rather than carry on the paragraph, so no break puts one there.
const OPENS_BLOCK =
  /^(?:[-+*](?:\s|$)|#{1,6}(?:\s|$)|>|\||<|\{|```|~~~|\d{1,9}[.)](?:\s|$)|=+\s*$|-{3,}\s*$|\[\^)/

// What a line carries before its words: indentation, quote markers, then a list marker with its spaces, whose width a continuation line indents by.
const PREFIX = /^([ \t]*(?:>[ ]?)*[ \t]*)((?:[-+*]|\d{1,9}[.)])[ ]{1,4}(?=\S))?/

const FENCE = /^[ \t]*(?:>[ ]?)*[ \t]*(?:[-+*][ ]+|\d{1,9}[.)][ ]+)?(`{3,}|~{3,})/
const DELIMITER_ROW =
  /^[ \t]*(?:>[ ]?)*[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

export type Kind = "code" | "frontmatter" | "html" | "prose" | "table"

// Each line's kind: only a prose line is ever broken or held to LIMIT.
export function kinds(lines: string[]): Kind[] {
  const out: Kind[] = []
  let fence: string | undefined
  let frontmatter = lines[0] === "---"
  let comment = false
  let table = false
  lines.forEach((line, i) => {
    if (frontmatter) {
      out.push("frontmatter")
      if (i > 0 && line === "---") frontmatter = false
      return
    }
    if (fence) {
      out.push("code")
      const close = FENCE.exec(line)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length && line.trim() === close)
        fence = undefined
      return
    }
    const open = FENCE.exec(line)?.[1]
    if (open) {
      out.push("code")
      fence = open
      return
    }
    if (comment) {
      out.push("html")
      if (line.includes("-->")) comment = false
      return
    }
    const words = line.replace(PREFIX, "")
    if (words.startsWith("<!--")) {
      out.push("html")
      comment = !line.includes("-->")
      return
    }
    if (line.trim() === "") table = false
    else if (DELIMITER_ROW.test(lines[i + 1] ?? "") && line.includes("|")) table = true
    if (table) {
      out.push("table")
      return
    }
    out.push(
      /^\s*</.test(words) || /^\s*#{1,6}(?:\s|$)/.test(words) || /^\s*\[[^\]]+\]:\s/.test(words)
        ? "html"
        : "prose",
    )
  })
  return out
}

// The spans of a line no break may fall inside: inline code, a link's text and target, an HTML tag or autolink.
function guarded(text: string): boolean[] {
  const inside = Array.from({ length: text.length }, () => false)
  const mark = (from: number, to: number) => {
    for (let i = from; i < to; i++) inside[i] = true
  }
  for (let i = 0; i < text.length;) {
    if (text[i] === "\\") {
      i += 2
      continue
    }
    if (text[i] === "`") {
      let run = 1
      while (text[i + run] === "`") run++
      const ticks = "`".repeat(run)
      let close = text.indexOf(ticks, i + run)
      while (close >= 0 && text[close + run] === "`") close = text.indexOf(ticks, close + run + 1)
      if (close < 0) {
        i += run
        continue
      }
      mark(i, close + run)
      i = close + run
      continue
    }
    if (text[i] === "<" && /[A-Za-z/!]/.test(text[i + 1] ?? "")) {
      const close = text.indexOf(">", i)
      if (close >= 0) {
        mark(i, close + 1)
        i = close + 1
        continue
      }
    }
    if (text[i] === "[") {
      let depth = 0
      let j = i
      for (; j < text.length; j++) {
        if (text[j] === "\\") j++
        else if (text[j] === "[") depth++
        else if (text[j] === "]" && --depth === 0) break
      }
      if (j < text.length && (text[j + 1] === "(" || text[j + 1] === "[")) {
        const end = text.indexOf(text[j + 1] === "(" ? ")" : "]", j + 2)
        if (end >= 0) {
          mark(i, end + 1)
          i = end + 1
          continue
        }
      }
    }
    i++
  }
  return inside
}

// Where a sentence ends: after `.`, `?` or `!` and any closing marks, before one or more spaces and a word, in either case since a sentence here can open on a lowercase name (playground, `bun run`); never inside a guarded span, after an abbreviation, or before a line that would open a block.
function sentenceBreaks(text: string, inside: boolean[]): number[] {
  const at: number[] = []
  for (const m of text.matchAll(/[.?!]["'”’)*_]*( +)(?=["'“‘(*_[`]*[A-Za-z0-9`[$@])/g)) {
    const end = (m.index ?? 0) + m[0].length - m[1].length
    if (inside[m.index ?? 0] || inside[end]) continue
    if (text[m.index ?? 0] === ".") {
      const word = /([A-Za-z.]+)$/.exec(text.slice(0, m.index))?.[1]?.toLowerCase()
      if (word && (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word))) continue
    }
    at.push(end)
  }
  return at
}

// Each clause break, weighted: a semicolon or colon over a comma, and outside parentheses over inside.
function clauseBreaks(text: string, inside: boolean[]): { at: number; weight: number }[] {
  const depth: number[] = []
  let open = 0
  for (let i = 0; i < text.length; i++) {
    if (!inside[i] && text[i] === "(") open++
    if (!inside[i] && text[i] === ")") open = Math.max(0, open - 1)
    depth.push(open)
  }
  return [...text.matchAll(/([;:,])( +)/g)]
    .filter((m) => !inside[m.index ?? 0])
    .map((m) => ({
      at: (m.index ?? 0) + 1,
      weight: (m[1] === "," ? 1 : 2) + (depth[m.index ?? 0] === 0 ? 2 : 0),
    }))
}

// Splits `words` at the chosen offsets, dropping the spaces each break stands for and every piece that would open a block.
function cut(words: string, offsets: number[]): string[] {
  const pieces: string[] = []
  let from = 0
  for (const at of offsets) {
    const rest = words.slice(at).replace(/^ +/, "")
    if (OPENS_BLOCK.test(rest) || rest === "") continue
    pieces.push(words.slice(from, at))
    from = words.length - rest.length
  }
  pieces.push(words.slice(from))
  return pieces
}

// A sentence too long for one line, broken at its clauses: each line takes as much as fits, ending at the weightiest break in the back half of the room, else the last that fits.
function byClause(sentence: string, room: number): string[] {
  if (sentence.length <= room) return [sentence]
  const inside = guarded(sentence)
  const breaks = clauseBreaks(sentence, inside).filter(
    (b) => !OPENS_BLOCK.test(sentence.slice(b.at).replace(/^ +/, "")),
  )
  const offsets: number[] = []
  let start = 0
  while (sentence.length - start > room) {
    const fits = breaks.filter((b) => b.at > start && b.at - start <= room)
    if (fits.length === 0) break
    const back = fits.filter((b) => b.at - start > room / 2)
    const best = Math.max(...back.map((b) => b.weight))
    const pick = (back.length ? back.filter((b) => b.weight === best) : fits).at(-1)!.at
    offsets.push(pick)
    start = pick + (/^ +/.exec(sentence.slice(pick))?.[0].length ?? 0)
  }
  return cut(sentence, offsets)
}

// One prose line as the lines it wraps to.
export function wrapLine(line: string, limit = LIMIT): string[] {
  const match = PREFIX.exec(line)
  const lead = match?.[1] ?? ""
  const marker = match?.[2] ?? ""
  const words = line.slice(lead.length + marker.length)
  if (words.trim() === "" || /( {2}|\\)$/.test(words)) return [line]
  const indent = lead + " ".repeat(marker.length)
  const sentences = cut(words, sentenceBreaks(words, guarded(words)))
  const pieces = sentences.flatMap((sentence, i) =>
    byClause(sentence, limit - (i === 0 ? lead.length + marker.length : indent.length)),
  )
  return pieces.map((piece, i) => (i === 0 ? lead + marker : indent) + piece)
}

// A whole Markdown or MDX file, wrapped. Running it twice changes nothing.
export function wrap(text: string, limit = LIMIT): string {
  const lines = text.split("\n")
  const kind = kinds(lines)
  return lines
    .flatMap((line, i) => (kind[i] === "prose" ? wrapLine(line, limit) : [line]))
    .join("\n")
}

// Every prose line past `limit`, as its 1-based line number and length.
export function overLimit(text: string, limit = LIMIT): { length: number; line: number }[] {
  const lines = text.split("\n")
  const kind = kinds(lines)
  return lines.flatMap((line, i) =>
    kind[i] === "prose" && line.length > limit ? [{ length: line.length, line: i + 1 }] : [],
  )
}
