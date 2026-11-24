import fc from "fast-check"

// The rewrites reach a call's program word alone, so two open bypasses stay outside the property until a rewrite lands with each one's fix: #3028, another program's output in a group whose redirect the hook cannot read, and #3030, a function's call word a brace list or a word split spells
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
