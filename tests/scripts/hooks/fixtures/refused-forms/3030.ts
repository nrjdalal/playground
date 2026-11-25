import type { Group, Row } from "./_shared"

// A function's positional parameters read its call's words as the shell expands them: a brace list into its parts, a quoted variable whole and an unquoted one split on blanks, so a write through "$1" into the git hook the shell gives it is judged as the same write at top level; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const CAT = `f() { cat payload > "$1"; }`

const calls = (target: string) =>
  [
    ["a brace list", `${CAT}; f {${target},x}`],
    ["an unquoted variable split on its blank", `X='${target} b'; ${CAT}; f $X`],
    ["a quoted variable", `X=${target}; ${CAT}; f "$X"`],
  ] as const

// a quoted variable's whole value with its blank is still a file in the hooks folder, as the same write at top level is
const held = (): Row[] => [
  ...calls(HOOK).map(([how, command]): Row => [
    `a cat's output written by a function into the git hook ${how} gives its first parameter`,
    command,
  ]),
  [
    "a cat's output written by a function into the hooks folder file a quoted variable gives whole",
    `X='${HOOK} b'; ${CAT}; f "$X"`,
  ],
]

// Pass controls: the same calls giving the first parameter an ordinary file, and a quoted variable, whose whole value with its blank is the first parameter, a folder no hook is in; a brace list in a folder that holds the data folder reads as a glob there, so its control runs in the process worktree alone.
const logs = () =>
  calls("out.log").map(([how, command]): Row => [
    `a cat's output written by a function into the log ${how} gives its first parameter`,
    command,
  ])
const braceControls = (): Row[] => logs().slice(0, 1)
const controls = (): Row[] => [
  ...logs().slice(1),
  [
    "a cat's output written by a function into its first parameter a quoted variable gives whole",
    `X='b ${HOOK}'; ${CAT}; f "$X"`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: braceControls },
]

export const allowed: string[] = [...controls(), ...braceControls()].map(([what]) => what)
