import fc from "fast-check"

// Each rewrite below puts an expansion in the program word, which no-hidden-program refuses by design, so it alone can keep that property green; OWN_REWRITES keep the program word literal, so the row's own guard alone judges theirs (#3044)
// Words the shell reads as syntax only when written plainly, so a variable or an empty word in front turns them into a program name and the call means something else; programWord's pattern already leaves out those of other characters (`!`, `[[`, an assignment)
const SYNTAX = new Set([
  "case",
  "coproc",
  "for",
  "foreach",
  "function",
  "if",
  "nocorrect",
  "noglob",
  "repeat",
  "select",
  "time",
  "until",
  "while",
])

// The call's first word when it is one plain program name, the one word a variable or an empty word can stand in for and keep the call's meaning
export const programWord = (call: string) => {
  const word = /^[\w./-]+(?=[ \t\n]|$)/.exec(call)?.[0]
  return word && !SYNTAX.has(word) ? word : undefined
}

// Each rewrite of a call's program word that keeps what the call runs
const REWRITES = {
  "a quoted variable": (w: string) => `PF_P=${w}; "$PF_P"`,
  "a variable": (w: string) => `PF_P=${w}; $PF_P`,
  "an empty braced variable before it": (w: string) => `\${PF_NONE} ${w}`,
  "an empty variable before it": (w: string) => `$PF_NONE ${w}`,
} as const

export type Spelling = keyof typeof REWRITES

export const REWRITE_NAMES = Object.keys(REWRITES) as Spelling[]

export const SPELLING: fc.Arbitrary<Spelling> = fc.constantFrom(...REWRITE_NAMES)

// The call as the spelling writes it, for a call programWord reads a program word from
export const spell = (call: string, spelling: Spelling) => {
  const program = programWord(call)!
  return REWRITES[spelling](program) + call.slice(program.length)
}

// The plain words after the program word, each a run of characters the shell reads as itself, up to the first word or character that is more (a quote, an expansion, an operator, a redirect, a glob), so a rewrite of them keeps what the call runs
const PLAIN = /^[ \t]+([\w./:@%+,=~-]+)(?=[ \t]|$)/
export const plainArgs = (call: string) => {
  const program = programWord(call)
  if (!program) return undefined
  const words: { at: number; gap: string; word: string }[] = []
  let at = program.length
  for (let m = PLAIN.exec(call.slice(at)); m; m = PLAIN.exec(call.slice(at))) {
    words.push({ at, gap: m[0].slice(0, m[0].length - m[1]!.length), word: m[1]! })
    at += m[0].length
  }
  return { program, rest: call.slice(at), words }
}

// a ~, and zsh's leading = path lookup, expand only unquoted and unescaped, so a word holding one keeps its spelling under the quoting rewrites
const tilde = (w: string) => w.includes("~") || w.startsWith("=")

// Each rewrite of a call's plain arguments that keeps its program word literal and what the call runs, so the row's own guard alone judges it; flag order stays out, since an option's value and an operand change with it
const OWN_REWRITES = {
  "a ./ hop in each absolute path": (w: string) => w.replace(/^(~?\/)(?!\/)/, "$1./"),
  "a backslash before each argument": (w: string) => (tilde(w) ? w : `\\${w}`),
  "double-quoted arguments": (w: string) => (tilde(w) ? w : `"${w}"`),
  "single-quoted arguments": (w: string) => (tilde(w) ? w : `'${w}'`),
} as const
const GAPS = { "a tab between words": "\t", "two spaces between words": "  " } as const

export type OwnSpelling = keyof typeof OWN_REWRITES | keyof typeof GAPS

export const OWN_NAMES = [
  ...Object.keys(OWN_REWRITES),
  ...Object.keys(GAPS),
].sort() as OwnSpelling[]

export const OWN_SPELLING: fc.Arbitrary<OwnSpelling> = fc.constantFrom(...OWN_NAMES)

// The call with every plain argument rewritten, or undefined when the rewrite changes nothing
export const spellOwn = (call: string, spelling: OwnSpelling) => {
  const parts = plainArgs(call)
  if (!parts) return undefined
  const word =
    spelling in OWN_REWRITES
      ? OWN_REWRITES[spelling as keyof typeof OWN_REWRITES]
      : (w: string) => w
  const gap = spelling in GAPS ? GAPS[spelling as keyof typeof GAPS] : undefined
  const text =
    parts.program + parts.words.map((w) => (gap ?? w.gap) + word(w.word)).join("") + parts.rest
  return text === call ? undefined : text
}
