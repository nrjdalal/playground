import type { Group, Row } from "./_shared"

// A function body's write is judged as a top-level one, its positional parameters unread, and another program's own text that names the root, written through a variable the hook cannot read, fails closed as a printer's does; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const ECHO = "echo 'touch ~/.playground/extensions/x'"
const LOG = "git log -1 --format='touch ~/.playground/extensions/x'"

const held = (): Row[] => [
  [
    "an echo of the data folder in a function body through its first parameter",
    `f() { ${ECHO} > "$1"; }; f ${HOOK}`,
  ],
  [
    "an echo of the data folder in a function body through a variable the line never sets",
    `f() { ${ECHO} > "$UNSET_X"; }; f`,
  ],
  [
    "an echo of the data folder in a one-command function body through a variable the line never sets",
    `f() ${ECHO} > "$UNSET_X"; f`,
  ],
  [
    "an echo of the data folder in a two-command function body through a variable the line never sets",
    `f() { ${ECHO} > "$UNSET_X"; true; }; f`,
  ],
  [
    "a git log naming the data folder through a variable the line never sets",
    `${LOG} > "$UNSET_X"`,
  ],
  [
    "a git log naming the data folder through a variable set under an or",
    `P=x || P=${HOOK}; ${LOG} > "$P"`,
  ],
]

// Pass controls: a function writing plain text through its first parameter, and a git log whose text names no root through a variable the hook cannot read.
const controls = (): Row[] => [
  [
    "a plain echo in a function body through its first parameter",
    `f() { echo hi > "$1"; }; f ${HOOK}`,
  ],
  [
    "a git log of its subject through a variable the line never sets",
    `git log -1 --format=%s > "$UNSET_X"`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
