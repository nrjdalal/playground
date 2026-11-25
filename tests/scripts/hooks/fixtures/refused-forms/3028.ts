import type { Group, Row } from "./_shared"

// A group's, a subshell's or a compound's stdout redirect reaches every command inside it, a duplicate of a descriptor an exec opened, a group after a reserved word and a block after `time`, `coproc` or `nocorrect` included, so another program's own text that names the root, written there through a variable the hook cannot read, fails closed as the same program's at top level does; rows are data, as refused-forms.ts says.
const LOG = "git log -1 --format='touch ~/.playground/extensions/x'"
const PLAIN = "git log -1 --format=%h"
const ECHO = "echo 'touch ~/.playground/extensions/x'"

const blocks = (call: string) =>
  [
    ["a brace group", `{ ${call}; } > "$UNSET_X"`],
    ["a subshell", `( ${call} ) > "$UNSET_X"`],
    ["a while loop", `while true; do ${call}; break; done > "$UNSET_X"`],
    ["a brace group writing a descriptor an exec opened", `exec 3>"$UNSET_X"; { ${call}; } >&3`],
    ["a subshell writing a descriptor an exec opened", `exec 3>"$UNSET_X"; ( ${call} ) >&3`],
    [
      "a while loop writing a descriptor an exec opened",
      `exec 3>"$UNSET_X"; while true; do ${call}; break; done >&3`,
    ],
    ["a brace group writing the stderr an exec opened", `exec 2>"$UNSET_X"; { ${call}; } 1>&2`],
    ["a negated brace group", `! { ${call}; } > "$UNSET_X"`],
    ["a brace group after then", `if true; then { ${call}; } > "$UNSET_X"; fi`],
    ["a brace group after do", `while true; do { ${call}; } > "$UNSET_X"; break; done`],
    ["a brace group after coproc", `coproc { ${call}; } > "$UNSET_X"`],
    ["a brace group after coproc and its name", `coproc NAME { ${call}; } > "$UNSET_X"`],
    ["a subshell after coproc", `coproc ( ${call} ) > "$UNSET_X"`],
    ["a brace group after time", `time { ${call}; } > "$UNSET_X"`],
    ["a subshell after time", `time ( ${call} ) > "$UNSET_X"`],
    ["a brace group after select's do", `select x in a; do { ${call}; } > "$UNSET_X"; break; done`],
    ["a brace group after else", `if false; then :; else { ${call}; } > "$UNSET_X"; fi`],
    ["a brace group after elif", `if false; then :; elif { ${call}; } > "$UNSET_X"; then :; fi`],
    ["a brace group after if", `if { ${call}; } > "$UNSET_X"; then :; fi`],
    ["a brace group after until", `until { ${call}; } > "$UNSET_X"; do break; done`],
    ["a brace group after &&", `true && { ${call}; } > "$UNSET_X"`],
    ["a brace group after ||", `false || { ${call}; } > "$UNSET_X"`],
    ["a brace group after a pipe", `echo a | { ${call}; } > "$UNSET_X"`],
    ["a negated while loop", `! while true; do ${call}; break; done > "$UNSET_X"`],
    [
      "a while loop after then",
      `if true; then while true; do ${call}; break; done > "$UNSET_X"; fi`,
    ],
    ["a while loop after time", `time while true; do ${call}; break; done > "$UNSET_X"`],
    [
      "a while loop after time and its option",
      `time -p while true; do ${call}; break; done > "$UNSET_X"`,
    ],
    ["an until loop after time", `time until false; do ${call}; break; done > "$UNSET_X"`],
    ["a for loop after time", `time for i in a; do ${call}; done > "$UNSET_X"`],
    ["an if after time", `time if true; then ${call}; fi > "$UNSET_X"`],
    ["a case after time", `time case a in a) ${call};; esac > "$UNSET_X"`],
    ["a while loop after coproc", `coproc while true; do ${call}; break; done > "$UNSET_X"`],
    [
      "a while loop after coproc and its name",
      `coproc w while true; do ${call}; break; done > "$UNSET_X"`,
    ],
    ["an if after coproc", `coproc if true; then ${call}; fi > "$UNSET_X"`],
    ["a while loop after nocorrect", `nocorrect while true; do ${call}; break; done > "$UNSET_X"`],
  ] as const

const held = (): Row[] => [
  ...blocks(LOG).map(([block, command]): Row => [
    `a git log naming the data folder in ${block} through a variable the line never sets`,
    command,
  ]),
  [
    "an echo naming the data folder in a brace group after coproc through a variable the line never sets",
    `coproc { ${ECHO}; } > "$UNSET_X"`,
  ],
  [
    "an echo naming the data folder in a while loop after time through a variable the line never sets",
    `time while true; do ${ECHO}; break; done > "$UNSET_X"`,
  ],
]

// Pass controls: the same blocks writing a git log whose text names no root, and the root's text into an ordinary file; a brace group after time or a coproc's name lexes as a `{` word, a glob in a folder that holds the data folder, so its control runs in the process worktree alone.
const hashes = () =>
  blocks(PLAIN).map(([block, command]): Row => [
    `a git log of its hash in ${block} through a variable the line never sets`,
    command,
  ])
const globbed = ([what]: Row) => / a brace group after (time|coproc and its name) /.test(what)
const globControls = (): Row[] => hashes().filter(globbed)
const controls = (): Row[] => [
  ...hashes().filter((row) => !globbed(row)),
  ["a git log naming the data folder in a brace group into a log", `{ ${LOG}; } > out.log`],
  [
    "a git log naming the data folder in a while loop after coproc into a log",
    `coproc while true; do ${LOG}; break; done > out.log`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: globControls },
]

export const allowed: string[] = [...controls(), ...globControls()].map(([what]) => what)
