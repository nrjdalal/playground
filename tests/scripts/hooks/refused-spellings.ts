import fc from "fast-check"

// Words the shell reads as syntax only when written plainly, so a variable or an empty word in front turns them into a program name and the call means something else
const SYNTAX = new Set([
  "!",
  "[[",
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
  return word && !word.includes("=") && !SYNTAX.has(word) ? word : undefined
}

// Each rewrite of a call's program word that keeps what the call runs
const REWRITES = {
  "a quoted variable": (w: string) => `PF_P=${w}; "$PF_P"`,
  "a variable": (w: string) => `PF_P=${w}; $PF_P`,
  "an empty braced variable before it": (w: string) => `\${PF_NONE} ${w}`,
  "an empty variable before it": (w: string) => `$PF_NONE ${w}`,
} as const

export type Spelling = keyof typeof REWRITES

export const SPELLING: fc.Arbitrary<Spelling> = fc.constantFrom(
  ...(Object.keys(REWRITES) as Spelling[]),
)

// The call as the spelling writes it, for a call programWord reads a program word from
export const spell = (call: string, spelling: Spelling) => {
  const program = programWord(call)!
  return REWRITES[spelling](program) + call.slice(program.length)
}
