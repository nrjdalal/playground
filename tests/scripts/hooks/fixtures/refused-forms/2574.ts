import type { Group, Row } from "./_shared"

// An exec whose name is quoted or escaped, or behind zsh's builtin or bash's command, still opens its descriptors for the rest of the line, as a plain exec does, so a write into a git hook through one stays refused; rows are data, as refused-forms.ts says.
const SPELLINGS = [
  ["a backslash", "\\exec"],
  ["single quotes", "'exec'"],
  ["double quotes", '"exec"'],
  ["an empty quote inside", "e''xec"],
  ["builtin in front", "builtin exec"],
  ["command in front", "command exec"],
  ["a quoted builtin in front", "'builtin' exec"],
] as const

const held = (): Row[] =>
  SPELLINGS.flatMap(([how, exec]): Row[] => [
    [
      `an echo whose stdout is duplicated to a descriptor an earlier exec spelt with ${how} opened on a git hook`,
      `${exec} 3> .git/hooks/pre-commit; echo 'touch ~/.playground/extensions/x' >&3`,
    ],
    [
      `an echo after an exec spelt with ${how} sent stdout into a git hook`,
      `${exec} > .git/hooks/pre-commit; echo 'touch ~/.playground/extensions/x'`,
    ],
  ])

// Pass controls: each spelling's descriptor on a log, and an exec word that is an argument, not the command, still run.
const controls = (): Row[] => [
  ...SPELLINGS.map(([how, exec]): Row => [
    `an echo of the data folder through a descriptor an earlier exec spelt with ${how} opened on a log`,
    `${exec} 3> out.log; echo 'touch ~/.playground/extensions/x' >&3`,
  ]),
  [
    "an echo of the word exec with a descriptor on a git hook, then an echo to that descriptor",
    `echo exec 3> .git/hooks/pre-commit; echo 'touch ~/.playground/extensions/x' >&3`,
  ],
  ["a lookup of exec through command -v", "command -v exec"],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
