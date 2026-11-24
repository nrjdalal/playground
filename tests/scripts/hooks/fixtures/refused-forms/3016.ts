import type { Group, Row } from "./_shared"

// An exec that runs no program opens its descriptors for the rest of the line whatever stands before it or after it: its own options, command's options, a zsh precommand modifier, an assignment, or a group or compound around it, so a write into a git hook through one stays refused; rows are data, as refused-forms.ts says.
const OPENERS = [
  ["exec's -- before the redirect", "exec -- 3> .git/hooks/pre-commit"],
  ["exec's -a and its name", "exec -a x 3> .git/hooks/pre-commit"],
  ["exec's -a with its name attached", "exec -ax 3> .git/hooks/pre-commit"],
  ["exec's -c", "exec -c 3> .git/hooks/pre-commit"],
  ["exec's -l", "exec -l 3> .git/hooks/pre-commit"],
  ["exec's -c and -l joined", "exec -cl 3> .git/hooks/pre-commit"],
  ["command's -p", "command -p exec 3> .git/hooks/pre-commit"],
  ["command's --", "command -- exec 3> .git/hooks/pre-commit"],
  ["zsh's noglob", "noglob exec 3> .git/hooks/pre-commit"],
  ["zsh's nocorrect", "nocorrect exec 3> .git/hooks/pre-commit"],
  ["zsh's - modifier", "- exec 3> .git/hooks/pre-commit"],
  ["an assignment", "x=1 exec 3> .git/hooks/pre-commit"],
  ["two assignments", "x=1 y=2 exec 3> .git/hooks/pre-commit"],
  ["a negation", "! exec 3> .git/hooks/pre-commit"],
  ["a brace group", "{ exec 3> .git/hooks/pre-commit; }"],
  ["a brace group in a brace group", "{ { exec 3> .git/hooks/pre-commit; }; }"],
  ["an if's body", "if true; then exec 3> .git/hooks/pre-commit; fi"],
  ["a loop's body", "while true; do exec 3> .git/hooks/pre-commit; break; done"],
  [
    "an if's body, an assignment, command's -p and exec's --",
    "if true; then x=1 command -p exec -- 3> .git/hooks/pre-commit; fi",
  ],
] as const

const WRITE = "echo 'touch ~/.playground/extensions/x' >&3"

const held = (): Row[] =>
  OPENERS.map(([how, opener]): Row => [
    `an echo whose stdout is duplicated to a descriptor an exec behind ${how} opened on a git hook`,
    `${opener}; ${WRITE}`,
  ])

// Pass controls: each opener's descriptor on a log, an exec or an assignment before a program, an exec word that is an argument, and the common forms the wider reading may catch.
const controls = (): Row[] => [
  ...OPENERS.map(([how, opener]): Row => [
    `an echo of the data folder through a descriptor an exec behind ${how} opened on a log`,
    `${opener.replace(".git/hooks/pre-commit", "out.log")}; ${WRITE}`,
  ]),
  [
    "an exec of a program with -a and a descriptor on a git hook, then an echo to that descriptor",
    `exec -a name ls 3> .git/hooks/pre-commit; ${WRITE}`,
  ],
  [
    "an assignment before a program with a descriptor on a git hook, then an echo to that descriptor",
    `x=1 ls 3> .git/hooks/pre-commit; ${WRITE}`,
  ],
  [
    "an echo of the word exec in a brace group with a descriptor on a git hook, then an echo to that descriptor",
    `{ echo exec 3> .git/hooks/pre-commit; }; ${WRITE}`,
  ],
  [
    "an exec appending to a log in the scratch folder, then an echo to that descriptor",
    "exec 3>> ~/.playground/scratch/x/log; echo hi >&3",
  ],
  [
    "an echo of the data folder through env running exec on a log",
    `env X=1 exec 3> out.log; ${WRITE}`,
  ],
  ["a lookup of exec through command -v", "command -v exec"],
  ["noglob before a program", "noglob git status"],
  ["command's -p before a program", "command -p ls"],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
