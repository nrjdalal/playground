import type { Group, Row } from "./_shared"

// A group's, a subshell's or a compound's stdout redirect reaches every command inside it, so another program's own text that names the root, written there through a variable the hook cannot read, fails closed as the same program's at top level does; rows are data, as refused-forms.ts says.
const LOG = "git log -1 --format='touch ~/.playground/extensions/x'"
const PLAIN = "git log -1 --format=%h"

const blocks = (call: string) =>
  [
    ["a brace group", `{ ${call}; } > "$UNSET_X"`],
    ["a subshell", `( ${call} ) > "$UNSET_X"`],
    ["a while loop", `while true; do ${call}; break; done > "$UNSET_X"`],
  ] as const

const held = (): Row[] =>
  blocks(LOG).map(([block, command]): Row => [
    `a git log naming the data folder in ${block} through a variable the line never sets`,
    command,
  ])

// Pass controls: the same blocks writing a git log whose text names no root, and the root's text into an ordinary file.
const controls = (): Row[] => [
  ...blocks(PLAIN).map(([block, command]): Row => [
    `a git log of its hash in ${block} through a variable the line never sets`,
    command,
  ]),
  ["a git log naming the data folder in a brace group into a log", `{ ${LOG}; } > out.log`],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
