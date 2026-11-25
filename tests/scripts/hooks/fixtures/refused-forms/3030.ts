import type { Group, Row } from "./_shared"

// A function's positional parameters read its call's words as the shell expands them: a brace list into its parts, a quoted read whole and an unquoted one both split on blanks, as bash gives it, and whole, as zsh does, beside the literal text around it, so a write through "$1" into the git hook the shell gives it is judged as the same write at top level; a call word the hook cannot read, an unquoted read beside a quoted part among them, leaves every parameter from it unread, so a write through one refuses; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const CAT = `f() { cat payload > "$1"; }`
const CAT2 = `f() { cat payload > "$2"; }`

const calls = (target: string) =>
  [
    ["a brace list", `${CAT}; f {${target},x}`],
    ["an unquoted variable split on its blank", `X='${target} b'; ${CAT}; f $X`],
    ["a quoted variable", `X=${target}; ${CAT}; f "$X"`],
  ] as const

// a quoted variable's whole value with its blank is still a file in the hooks folder, as the same write at top level is, and zsh gives an unquoted one whole too
const held = (): Row[] => [
  ...calls(HOOK).map(([how, command]): Row => [
    `a cat's output written by a function into the git hook ${how} gives its first parameter`,
    command,
  ]),
  [
    "a cat's output written by a function into the hooks folder file a quoted variable gives whole",
    `X='${HOOK} b'; ${CAT}; f "$X"`,
  ],
  [
    "a cat's output written by a function into the git hook zsh gives whole from an unquoted variable",
    `X='a b/${HOOK}'; ${CAT}; f $X`,
  ],
  [
    "a cat's output written by a function into the git hook a quoted variable and the folder after it give",
    `X=.git/hooks; ${CAT}; f "$X"/pre-commit`,
  ],
  [
    "a cat's output written by a function into the git hook an unquoted variable and the folder after it give",
    `X=.git/hooks; ${CAT}; f $X/pre-commit`,
  ],
  [
    "a cat's output written by a function into the git hook a quoted variable and the letter after it give",
    `X=.git/hooks/pre-commi; ${CAT}; f "$X"t`,
  ],
  [
    "a cat's output written by a function into its first parameter a brace sequence gives",
    `${CAT}; f ${HOOK.slice(0, -1)}{t..u}`,
  ],
  [
    "a cat's output written by a function into its first parameter an unquoted variable gives on a line that names IFS",
    `IFS=,; X='${HOOK},x'; ${CAT}; f $X`,
  ],
  [
    "a cat's output written by a function into its first parameter a log an unquoted variable gives on a line that names IFS",
    `IFS=,; X='out.log,x'; ${CAT}; f $X`,
  ],
  [
    "a cat's output written by a function into its first parameter a substitution gives",
    `${CAT}; f "$(cat name)"`,
  ],
  [
    "a cat's output written by a function into its second parameter after a double-quoted blank beside an unquoted variable",
    `X='y ${HOOK}'; ${CAT2}; f "a b"$X`,
  ],
  [
    "a cat's output written by a function into its second parameter after a single-quoted blank beside an unquoted variable",
    `X='y ${HOOK}'; ${CAT2}; f 'a b'$X`,
  ],
  [
    "a cat's output written by a function into its third parameter after a quoted variable beside the same unquoted one",
    `X='b c'; f() { cat payload > "$3"; }; f "$X"$X ${HOOK}`,
  ],
  [
    "a cat's output written by a function into its second parameter after an empty variable before empty quotes",
    `X=; ${CAT2}; f $X"" ${HOOK}`,
  ],
  [
    "a cat's output written by a function into its second parameter after empty quotes before an empty variable",
    `X=; ${CAT2}; f ""$X ${HOOK}`,
  ],
]

// Pass controls: the same calls giving the first parameter an ordinary file, a quoted variable, whose whole value with its blank is the first parameter, a folder no hook is in, a quoted variable with a file after it, an unquoted variable after a letter, and a parameter before a word the hook cannot read; a brace list in a folder that holds the data folder reads as a glob there, so its control runs in the process worktree alone.
const logs = () =>
  calls("out.log").map(([how, command]): Row => [
    `a cat's output written by a function into the log ${how} gives its first parameter`,
    command,
  ])
const braced = ([what]: Row) => what.includes("a brace list")
const braceControls = (): Row[] => logs().filter(braced)
const controls = (): Row[] => [
  ...logs().filter((row) => !braced(row)),
  [
    "a cat's output written by a function into its first parameter a quoted variable gives whole",
    `X='b ${HOOK}'; ${CAT}; f "$X"`,
  ],
  [
    "a cat's output written by a function into the log a quoted variable and the file after it give",
    `X=logs; ${CAT}; f "$X"/out.log`,
  ],
  [
    "a cat's output written by a function into the log an unquoted variable after a letter gives its second parameter",
    `X='b out.log'; ${CAT2}; f a$X`,
  ],
  [
    "a cat's output written by a function into the log its first parameter gives before a quoted blank beside an unquoted variable",
    `X='y ${HOOK}'; ${CAT}; f out.log "a b"$X`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: braceControls },
]

export const allowed: string[] = [...controls(), ...braceControls()].map(([what]) => what)
