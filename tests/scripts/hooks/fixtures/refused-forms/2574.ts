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

const rows = (): Row[] =>
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

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]
