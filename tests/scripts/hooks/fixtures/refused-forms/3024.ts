import type { Group, Row } from "./_shared"

// A function's positional parameters read the words of the line's one literal call, so a function body's write into a git hook is judged as the same write at top level; a call before the definition, inside the body or beside another call leaves them unread, which fails closed for text that names the root; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const ECHO = "echo 'touch ~/.playground/extensions/x'"
const CALLED = `f() { ${ECHO} > "$1"; }; f out.log`

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
  ...(
    [
      ["an echo of the data folder", `${ECHO} > "$1"`],
      ["a line led by a question", `echo "Done? yes" > "$1"`],
      ["a remover word", `echo 'rm -rf dist' > "$1"`],
      ["a cat's output", `cat payload > "$1"`],
    ] as const
  ).map(([what, write]): Row => [
    `${what} by a function defined first in another's body and called there with a git hook`,
    `f() { g() { ${write}; }; g ${HOOK}; }; f out.log`,
  ]),
  [
    "an echo of the data folder by a function defined first in another's brace body and called there with a git hook",
    `function f { g() { ${ECHO} > "$1"; }; g ${HOOK}; }; f out.log`,
  ],
  [
    "an echo of the data folder by a subshell function defined first in another's body and called there with a git hook",
    `f() { g() ( ${ECHO} > "$1" ); g ${HOOK}; }; f out.log`,
  ],
  [
    "an echo of the data folder by a function defined first in another's body and called after it with a git hook",
    `f() { g() { ${ECHO} > "$1"; }; }; f out.log; g ${HOOK}`,
  ],
  [
    "a cat's output by a function defined after a then in another's body and called there with a git hook",
    `f() { if :; then g() { cat payload > "$1"; }; g ${HOOK}; fi; }; f out.log`,
  ],
  // a second call the line spells another way, or a body or call that moves the parameters, leaves them unread, so text naming the root stays refused
  ...(
    [
      ["an ANSI-C quoted name", `${CALLED}; $'\\x66' ${HOOK}`],
      ["a variable as the program", `${CALLED}; F=f; $F ${HOOK}`],
      ["an alias", `alias g=f; ${CALLED}; g ${HOOK}`],
      ["a trap's text", `trap 'f ${HOOK}' EXIT; ${CALLED}`],
      ["a bash -c text", `${CALLED}; bash -c "f ${HOOK}"`],
      ["an escaped name", `${CALLED}; \\f ${HOOK}`],
      ["a quoted name", `${CALLED}; "f" ${HOOK}`],
      ["a brace group", `${CALLED}; { f ${HOOK}; }`],
      ["xargs", `${CALLED}; echo ${HOOK} | xargs f`],
      ["a sourced here-string", `${CALLED}; . /dev/stdin <<< "f ${HOOK}"`],
      ["a brace list", `${CALLED}; f{,} ${HOOK}`],
      ["an eval", `${CALLED}; eval "f ${HOOK}"`],
    ] as const
  ).map(([how, command]): Row => [
    `an echo of the data folder by a function called with a log and again through ${how}`,
    command,
  ]),
  ...(
    [
      ["a set --", `f() { set -- ${HOOK}; ${ECHO} > "$1"; }; f out.log`],
      ["a shift", `f() { shift; ${ECHO} > "$1"; }; f out.log ${HOOK}`],
      ["zsh's argv", `f() { argv[1]=${HOOK}; ${ECHO} > "$1"; }; f out.log`],
      ["zsh's 1=", `f() { 1=${HOOK}; ${ECHO} > "$1"; }; f out.log`],
      ["a call word the hook cannot read", `f() { ${ECHO} > "$1"; }; f "$X"`],
      ["an unquoted variable before the log", `f() { ${ECHO} > "$2"; }; f $X out.log`],
      [
        "a nested function passed its own first parameter",
        `f() { g() { ${ECHO} > "$1"; }; g "$1"; }; f ${HOOK}`,
      ],
    ] as const
  ).map(([how, command]): Row => [
    `an echo of the data folder by a function whose parameters move by ${how}`,
    command,
  ]),
]

// Pass controls: plain text through a function's first parameter into a git hook, as at top level, and through it into an ordinary file a cat's output and the three texts top level runs into one: one naming the root, one the hook-file rule refuses and a remover.
const controls = (): Row[] => [
  [
    "an echo of the data folder written by a function into its first parameter's log",
    `f() { ${ECHO} > "$1"; }; f out.log`,
  ],
  [
    "a line led by a question written by a function into its first parameter's log",
    `f() { echo "Done? yes" > "$1"; }; f out.log`,
  ],
  [
    "a remover word written by a function into its first parameter's log",
    `f() { echo 'rm -rf dist' > "$1"; }; f out.log`,
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
