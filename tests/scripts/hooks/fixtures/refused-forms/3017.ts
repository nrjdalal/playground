import type { Group, Row } from "./_shared"

// A write into a git hook whose redirect target is a variable is judged by the value the line's steady variables give it, a for loop's literal words each in turn, on every redirect path; one whose value the hook cannot read counts as a hook when the text names the root, so it fails closed; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const ECHO = "echo 'touch ~/.playground/extensions/x'"

const held = (): Row[] => [
  ["an echo redirected into a git hook through a quoted variable", `P=${HOOK}; ${ECHO} > "$P"`],
  ["an echo redirected into a git hook through an unquoted variable", `P=${HOOK}; ${ECHO} > $P`],
  ["an echo appended to a git hook through a variable", `P=${HOOK}; ${ECHO} >> "$P"`],
  [
    "an echo redirected into a git hook through a variable folder and a literal name",
    `D=.git/hooks; ${ECHO} > "$D/pre-commit"`,
  ],
  [
    "an echo through a descriptor an earlier exec opened on a git hook through a variable",
    `P=${HOOK}; exec 3> "$P"; ${ECHO} >&3`,
  ],
  [
    "an echo duplicated to a descriptor its own redirect opened on a git hook through a variable",
    `P=${HOOK}; ${ECHO} 3> "$P" >&3`,
  ],
  [
    "an echo in a brace group whose descriptor opens a git hook through a variable",
    `P=${HOOK}; { ${ECHO} >&3; } 3> "$P"`,
  ],
  [
    "an echo after an exec sent stdout into a git hook through a variable",
    `P=${HOOK}; exec > "$P"; ${ECHO}`,
  ],
  [
    "a cat of a here-string redirected into a git hook through a variable",
    `P=${HOOK}; cat <<< 'touch ~/.playground/extensions/x' > "$P"`,
  ],
  [
    "an echo redirected into a git hook through a for loop's variable",
    `for P in ${HOOK}; do ${ECHO} > "$P"; done`,
  ],
  [
    "an echo of the data folder through a variable set under an or",
    `P=x || P=${HOOK}; ${ECHO} > "$P"`,
  ],
  ["an echo of the data folder through a variable read sets", `read P; ${ECHO} > "$P"`],
  ["an echo of the data folder through a variable the line never sets", `${ECHO} > "$UNSET_X"`],
]

// Pass controls: a variable naming an ordinary file, a plain text into a hook through a variable, and a plain write through a variable the hook cannot read.
const controls = (): Row[] => [
  ["an echo of the data folder into a log through a variable", `P=out.log; ${ECHO} > "$P"`],
  [
    "an echo of the data folder into a scratch file through a variable",
    `P=~/.playground/scratch/x/out; ${ECHO} > "$P"`,
  ],
  [
    "an echo of the data folder through a descriptor an exec opened on a note through a variable",
    `P=notes.md; exec 3> "$P"; ${ECHO} >&3`,
  ],
  [
    "an echo of the data folder into each file of a for loop's variable",
    `for P in out.log notes.md; do ${ECHO} > "$P"; done`,
  ],
  [
    "an echo of a plain command into a git hook through a variable",
    `P=${HOOK}; echo 'bun test' > "$P"`,
  ],
  ["a plain echo through a variable the line never sets", `echo hi > "$UNSET_X"`],
  ["a plain echo through a variable set under an or", `P=x || P=${HOOK}; echo hi > "$P"`],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
