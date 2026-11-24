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
  ["an option exec does not take", "exec -z 3> .git/hooks/pre-commit"],
  ["exec's -a and its name before --", "exec -a x -- 3> .git/hooks/pre-commit"],
  ["exec's -l and -a joined before its name", "exec -la x 3> .git/hooks/pre-commit"],
  ["command's -p and --", "command -p -- exec 3> .git/hooks/pre-commit"],
  ["builtin's --", "builtin -- exec 3> .git/hooks/pre-commit"],
  ["time", "time exec 3> .git/hooks/pre-commit"],
  ["zsh's repeat", "repeat 1 exec 3> .git/hooks/pre-commit"],
  ["an assignment and a redirect before exec", "x=1 3> .git/hooks/pre-commit exec"],
  ["an elif's body", "if false; then :; elif true; then exec 3> .git/hooks/pre-commit; fi"],
  ["an else body", "if false; then :; else exec 3> .git/hooks/pre-commit; fi"],
  ["an until loop's body", "until false; do exec 3> .git/hooks/pre-commit; break; done"],
  ["a for loop's body", "for i in 1; do exec 3> .git/hooks/pre-commit; done"],
  ["a select loop's body", "select i in 1; do exec 3> .git/hooks/pre-commit; break; done"],
  ["a brace group with a redirect of its own", "{ exec 3> .git/hooks/pre-commit; } 2>/dev/null"],
  ["a negated brace group", "! { exec 3> .git/hooks/pre-commit; }"],
  ["a function body, then its call", "f() { exec 3> .git/hooks/pre-commit; }; f"],
  ["a function keyword's body, then its call", "function f { exec 3> .git/hooks/pre-commit; }; f"],
] as const

const WRITE = "echo 'touch ~/.playground/extensions/x' >&3"

// Whole lines that are no opener then one echo: the write inside an if whose condition opens the descriptor, and a second descriptor duplicated from the first by a wrapped exec.
const LINES = [
  ["an if's condition", `if exec 3> .git/hooks/pre-commit; then ${WRITE}; fi`],
  [
    "a descriptor duplicated by command -p exec from one a plain exec opened",
    "exec 3> .git/hooks/pre-commit; command -p exec 4>&3; echo 'touch ~/.playground/extensions/x' >&4",
  ],
] as const

const held = (): Row[] => [
  ...OPENERS.map(([how, opener]): Row => [
    `an echo whose stdout is duplicated to a descriptor an exec opened on a git hook, with ${how}`,
    `${opener}; ${WRITE}`,
  ]),
  ...LINES.map(([how, line]): Row => [
    `an echo of the data folder into a git hook through ${how}`,
    line,
  ]),
]

// Pass controls: each opener's and line's descriptor on a log, an exec or an assignment before a program, an exec word that is an argument, and the common forms the wider reading may catch.
const controls = (): Row[] => [
  ...OPENERS.map(([how, opener]): Row => [
    `an echo of the data folder through a descriptor an exec opened on a log, with ${how}`,
    `${opener.replace(".git/hooks/pre-commit", "out.log")}; ${WRITE}`,
  ]),
  ...LINES.map(([how, line]): Row => [
    `an echo of the data folder into a log through ${how}`,
    line.replace(".git/hooks/pre-commit", "out.log"),
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
