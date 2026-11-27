import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Glob } from "bun"

const root = join(import.meta.dir, "..", "..", "..")

// A string replacement reads `$'`, `$&` and a backtick pattern in its value, so a value a command holds (`$'\x70kill'` in an xargs item) is filled in changed; each such value goes in a function, `() => value`, which inserts it as written (issue 3134). The held names below hold no command text, each for its reason.
const HELD = new Map([
  ["GUARD", "no-prompt-stop's own marker constant"],
  ["UNKNOWN", "shell.ts's NUL sentinel constant"],
  ["findutils", "a GNU_NAMED capture, one of a fixed set of program names"],
  ["hide", "a replacer function shell.ts passes by name"],
  ["maskQuoted", "a replacer function shell.ts passes by name"],
  ["sequenceSpelling", "a replacer function shell.ts passes by name"],
  ["unquote", "a replacer function shell.ts passes by name"],
])

// Each .replace( or .replaceAll( call's second argument, the text between its first top-level comma and its closing parenthesis, skipping strings and regex literals.
function replacements(text: string): { arg: string; line: number }[] {
  const found: { arg: string; line: number }[] = []
  for (const m of text.matchAll(/\.replace(?:All)?\(/g)) {
    let depth = 1
    let quote = ""
    let comma = -1
    let i = m.index! + m[0].length
    for (; i < text.length && depth > 0; i++) {
      const c = text[i]!
      if (quote) {
        if (c === "\\") i++
        else if (c === quote) quote = ""
      } else if (c === '"' || c === "'" || c === "`") quote = c
      else if (c === "/" && comma < 0 && /[(,=\s]/.test(text[i - 1] ?? "")) {
        const end = text.indexOf("/", i + 1)
        if (end > 0) i = end
      } else if ("([{".includes(c)) depth++
      else if (")]}".includes(c)) depth--
      else if (c === "," && depth === 1 && comma < 0) comma = i
    }
    if (comma < 0) continue
    const arg = text
      .slice(comma + 1, i - 1)
      .trim()
      .replace(/,$/, "")
      .trim()
    found.push({ arg, line: text.slice(0, m.index).split("\n").length })
  }
  return found
}

const literal = (arg: string) => /^"[^"$]*"$|^'[^'$]*'$|^`[^`$]*`$|^"[^"]*"$|^'[^']*'$/.test(arg)
const fn = (arg: string) => /=>/.test(arg) || /^(?:async\s+)?function\b/.test(arg)

describe("a hook fills a value into text only through a function replacement", () => {
  test("every .replace and .replaceAll under scripts/hooks takes a literal, a function or a held name", async () => {
    const values: string[] = []
    for await (const rel of new Glob("scripts/hooks/*.ts").scan(root)) {
      const text = await Bun.file(join(root, rel)).text()
      for (const { arg, line } of replacements(text))
        if (!literal(arg) && !fn(arg) && !HELD.has(arg)) values.push(`${rel}:${line} ${arg}`)
    }
    expect(values).toEqual([])
  })

  test("the scan finds a value replacement, and passes a literal, a function and a held name", () => {
    const text = [
      'a.replaceAll("{}", item.value)',
      "a.replace(/x/g, word)",
      'a.replaceAll("{}", () => item.value)',
      'a.replace(/(a)/, "$1")',
      "a.replace(QUOTED, maskQuoted)",
    ].join("\n")
    const values = replacements(text).filter(
      ({ arg }) => !literal(arg) && !fn(arg) && !HELD.has(arg),
    )
    expect(values.map((v) => v.arg)).toEqual(["item.value", "word"])
  })
})
