import type { Group, Row } from "./_shared"

// A function's positional parameters read the words of the line's one literal call, so a function body's write into a git hook is judged as the same write at top level; a call before the definition, inside the body or beside another call leaves them unread, which fails closed for text that names the root; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const ECHO = "echo 'touch ~/.playground/extensions/x'"

const held = (): Row[] => [
  [
    "text the hook cannot read written by a function into its first parameter's git hook",
    `f() { echo "$(cat payload)" > "$1"; }; f ${HOOK}`,
  ],
  [
    "a cat's output written by a function into its first parameter's git hook",
    `f() { cat payload > "$1"; }; f ${HOOK}`,
  ],
  [
    "a cat's output written by a function into its second parameter's git hook",
    `function f { cat payload > "$2"; }; f notes.md ${HOOK}`,
  ],
  [
    "a cat's output written by a subshell function into its first parameter's git hook",
    `f() ( cat payload > "$1" ); f ${HOOK}`,
  ],
  [
    "an echo of the data folder by a function whose one call comes before its definition",
    `f ${HOOK}; f() { ${ECHO} > "$1"; }`,
  ],
  [
    "an echo of the data folder by a function that calls itself with an ordinary file",
    `f() { ${ECHO} > "$1"; f out.log; }; f ${HOOK}`,
  ],
  [
    "an echo of the data folder by a function called with an ordinary file and a git hook",
    `f() { ${ECHO} > "$1"; }; f out.log; f ${HOOK}`,
  ],
]

// Pass controls: plain text through a function's first parameter into a git hook, as at top level, a cat's output through it into an ordinary file, and an echo of the data folder through it into an ordinary file, which top level runs too.
const controls = (): Row[] => [
  [
    "an echo of the data folder written by a function into its first parameter's log",
    `f() { ${ECHO} > "$1"; }; f out.log`,
  ],
  [
    "a plain echo written by a function into its first parameter's git hook",
    `f() { echo hi > "$1"; }; f ${HOOK}`,
  ],
  [
    "a cat's output written by a function into its first parameter's log",
    `f() { cat payload > "$1"; }; f out.log`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
