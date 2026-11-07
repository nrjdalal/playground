// A .replace or .replaceAll call whose literal replacement holds a `$` pattern JS reads in place of the text: `$$`, `` $` `` and `$'` in any call, and `$&`, `$1` or `$<name>` after a string search, which has no groups, so its `$&` is only ever a slip. A regex or a named search keeps its back-references.

export const FIX =
  "a replacement that may hold $ goes through a replacer function, s.replace(a, () => b), or split(a).join(b)"

const ALWAYS = /\$[$`']/
const AFTER_STRING = /\$(?:&|\d|<)/

// The index just past a quoted string or a template starting at i, its `${…}` parts skipped whole.
const pastQuoted = (s: string, i: number): number => {
  const quote = s[i]
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++
    else if (s[j] === quote) return j + 1
    else if (quote === "`" && s[j] === "$" && s[j + 1] === "{") j = pastNested(s, j + 1) - 1
  }
  return s.length
}

// The index just past a bracket that opens at i, strings inside it skipped.
const pastNested = (s: string, i: number): number => {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const c = s[j]!
    if (c === '"' || c === "'" || c === "`") j = pastQuoted(s, j) - 1
    else if ("([{".includes(c)) depth++
    else if (")]}".includes(c) && --depth === 0) return j + 1
  }
  return s.length
}

// The index just past a regex literal starting at i, a slash inside a class or escaped left in.
const pastRegex = (s: string, i: number): number => {
  let inClass = false
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]
    if (c === "\\") j++
    else if (c === "[") inClass = true
    else if (c === "]") inClass = false
    else if (c === "/" && !inClass) return j + 1 + (/^[a-z]*/.exec(s.slice(j + 1))?.[0].length ?? 0)
    else if (c === "\n") return j
  }
  return s.length
}

// One call argument from i: its text, and the index of the comma or bracket that ends it.
const argument = (s: string, i: number): { end: number; text: string } => {
  let j = i
  while (/\s/.test(s[j] ?? "")) j++
  if (s[j] === "/") j = pastRegex(s, j)
  for (; j < s.length; j++) {
    const c = s[j]!
    if (c === "," || c === ")") break
    if (c === '"' || c === "'" || c === "`") j = pastQuoted(s, j) - 1
    else if ("([{".includes(c)) j = pastNested(s, j) - 1
  }
  return { end: j, text: s.slice(i, j).trim() }
}

// The literal's own text when the argument is one string or template alone, its `${…}` parts dropped; null otherwise.
const literal = (text: string): string | null => {
  const quote = text[0]
  if (quote !== '"' && quote !== "'" && quote !== "`") return null
  if (pastQuoted(text, 0) !== text.length) return null
  let body = ""
  for (let j = 1; j < text.length - 1; j++) {
    if (quote === "`" && text[j] === "$" && text[j + 1] === "{") j = pastNested(text, j + 1) - 1
    else body += text[j]
  }
  return body
}

// Each flagged call's 1-based line in one file's text.
export const dollarReplacements = (text: string): number[] => {
  const lines: number[] = []
  for (const call of text.matchAll(/\.replace(?:All)?\(/g)) {
    const search = argument(text, call.index + call[0].length)
    if (text[search.end] !== ",") continue
    const body = literal(argument(text, search.end + 1).text)
    if (body === null) continue
    const stringSearch = literal(search.text) !== null
    if (ALWAYS.test(body) || (stringSearch && AFTER_STRING.test(body)))
      lines.push(text.slice(0, call.index).split("\n").length)
  }
  return lines
}
