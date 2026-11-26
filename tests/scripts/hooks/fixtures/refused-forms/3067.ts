import type { Group, Row } from "./_shared"

// #3067 part 1: a write target read as the shell expands it: a brace sequence or list, a call word that is an array or zsh's split read, which fails closed, a parameter operator, "$@", "$*", a set's words and an indirection, a case-changed hooks folder, and sort's output file and uniq's second operand, each refused into the git hook while its twin into a log runs; rows are data, as refused-forms.ts says.
const HOOK = ".git/hooks/pre-commit"
const ROOT = "$HOME/.playground/extensions/home/x"
const CAT = `f() { cat payload > "$1"; }`

const targets = (to: string): Row[] => [
  [
    "a cat's output into a brace sequence of one",
    `cat payload > ${to.slice(0, -1)}{${to.at(-1)}..${to.at(-1)}}`,
  ],
  [
    "a cat's output into a brace sequence of two",
    `cat payload > ${to.slice(0, -1)}{${to.at(-1)}..z}`,
  ],
  [
    "a tee into a brace sequence",
    `cat payload | tee ${to.slice(0, -1)}{${to.at(-1)}..${to.at(-1)}}`,
  ],
  [
    "a cp of a here-string into a brace sequence",
    `cp /dev/stdin ${to.slice(0, -1)}{${to.at(-1)}..${to.at(-1)}} <<< 'rm -f x'`,
  ],
  [
    "a cp of a here-string into a brace list",
    `cp /dev/stdin ${to.slice(0, -1)}{${to.at(-1)},z} <<< 'rm -f x'`,
  ],
  ["a cat's output into a brace list", `cat payload > ${to.slice(0, -1)}{${to.at(-1)},z}`],
  ["a function called through zsh's split read", `X='f ${to}'; ${CAT}; \${=X}`],
  ["a function called through a quoted array", `A=(f ${to}); ${CAT}; "\${A[@]}"`],
  ["a function called through zsh's unquoted array", `A=(f ${to}); ${CAT}; $A`],
  [
    "a write through a function's parameter cut by %",
    `f() { cat payload > "\${1%.bak}"; }; f ${to}.bak`,
  ],
  [
    "a write through a function's parameter with a replacement",
    `f() { cat payload > "\${1/q/}"; }; f ${to}q`,
  ],
  ["a write through a function's parameter's default", `f() { cat payload > "\${1:-${to}}"; }; f`],
  ["a write through a variable cut by %", `X=${to}.bak; cat payload > "\${X%.bak}"`],
  ["a write through a variable with a replacement", `X=${to}q; cat payload > "\${X/q/}"`],
  ["a write through an unset variable's default", `cat payload > "\${X:-${to}}"`],
  ["a write through a function's quoted $@", `f() { cat payload > "$@"; }; f ${to}`],
  ["a write through a function's braced quoted $@", `f() { cat payload > "\${@}"; }; f ${to}`],
  ["a write through a function's quoted $*", `f() { cat payload > "$*"; }; f ${to}`],
  ["a write through a function's unquoted $@", `f() { cat payload > $@; }; f ${to}`],
  ["a write through $@ after set --", `set -- ${to}; cat payload > "$@"`],
  ["a write through $* after set --", `set -- ${to}; cat payload > "$*"`],
  [
    "a write through a function's indirect parameter",
    `X=${to}; f() { cat payload > "\${!1}"; }; f X`,
  ],
  ["a sort's output option", `sort -o ${to} payload`],
  ["a sort's output option with its file attached", `sort -o${to} payload`],
  ["a sort's long output option", `sort --output=${to} payload`],
  ["a uniq's second operand", `uniq payload ${to}`],
]

const held = (): Row[] => [
  ...targets(HOOK).map(([what, call]): Row => [`${what}, the git hook`, call]),
  ["a cat's output into a case-changed .git folder's hook", "cat payload > .GIT/hooks/pre-commit"],
  ["a cat's output into a case-changed hooks folder's hook", "cat payload > .git/HOOKS/pre-commit"],
  ["a function's write into a case-changed .git folder's hook", `${CAT}; f .GIT/hooks/pre-commit`],
]

// a remover written through a parameter a line moves past its set, or through a replacement whose pattern the reader does not model, from #3143's round 1
const ECHO = "echo 'rm -f x' >"
const moved = (): Row[] => [
  [
    "a remover into a bracket glob worked out by a cut",
    `X='.gi[t]/hooks/pre-commit.bak'; ${ECHO} \${X%.bak}`,
  ],
  [
    "a remover into a bracket glob worked out by a replacement",
    `X='.gi[t]/hooks/pre-commit.bak'; ${ECHO} \${X/.bak/}`,
  ],
  [
    "a remover into a bracket glob through $1 after set --",
    `set -- '.gi[t]/hooks/pre-commit'; ${ECHO} $1`,
  ],
  [
    "a remover into $1 after zsh's argv[1] moves it",
    `set -- out.log; argv[1]=${HOOK}; ${ECHO} "$1"`,
  ],
  ["a remover into $1 after zsh's 1= moves it", `set -- out.log; 1=${HOOK}; ${ECHO} "$1"`],
  [
    "a remover into $1 after zsh's argv array moves it",
    `set -- out.log; argv=(${HOOK}); ${ECHO} "$1"`,
  ],
  [
    "a remover into $1 after a read into argv",
    `set -- out.log; read -A argv <<< ${HOOK}; ${ECHO} "$1"`,
  ],
  ["a remover into $1 after an eval's set", `set -- out.log; eval 'set -- ${HOOK}'; ${ECHO} "$1"`],
  ["a remover into $1 after a dot script", `set -- out.log; . ./x.sh; ${ECHO} "$1"`],
  ["a remover into $1 after a sourced script", `set -- out.log; source ./x.sh; ${ECHO} "$1"`],
  [
    "a remover into $1 after a set through a variable",
    `C=set; set -- out.log; $C -- ${HOOK}; ${ECHO} "$1"`,
  ],
  [
    "a remover into $1 after a set through zsh's split read",
    `X='set -- ${HOOK}'; set -- out.log; \${=X}; ${ECHO} "$1"`,
  ],
  [
    "a remover through a replacement with zsh's group",
    `X=.git/hooksz/pre-commit; ${ECHO} "\${X/(z|q)/}"`,
  ],
  [
    "a remover through a replacement with a POSIX class",
    `X=.git/hooksA/pre-commit; ${ECHO} "\${X/[[:upper:]]/}"`,
  ],
  [
    "a remover through a parameter's replacement with zsh's group",
    `f() { ${ECHO} "\${1/(z|q)/}"; }; f .git/hooksz/pre-commit`,
  ],
]

const root = (): Row[] => [
  [
    "a write through a variable cut by %, a file in the root",
    `X=${ROOT}.bak; cat payload > "\${X%.bak}"`,
  ],
]

// a call word the hook cannot read (an array, zsh's split read) or an indirection may give any parameter, so a write through one is refused into a log too
const unread = (what: string) => /indirect|array|split read/.test(what)
const closed = (): Row[] =>
  targets("out.log")
    .filter(([what]) => unread(what))
    .map(([what, call]): Row => [`${what}, a log, which the hook cannot read`, call])
const controls = (): Row[] =>
  targets("out.log")
    .filter(([what]) => !unread(what))
    .map(([what, call]): Row => [`${what}, a log`, call])

// a remover's text into a log canary refused, since it held the target unread, and the head works out to the log, the loosening this part makes
const loosened = (): Row[] => [
  ["a remover's text into a log through a variable's cut", `X=out.log.bak; ${ECHO} "\${X%.bak}"`],
  [
    "a remover's text into a log through a variable's replacement",
    `X=out.bak; ${ECHO} "\${X/bak/log}"`,
  ],
  ["a remover's text into a log through a variable's alternate", `X=1; ${ECHO} "\${X:+out.log}"`],
  ["a remover's text into a log through $1 after set --", `set -- out.log; ${ECHO} "$1"`],
]
const dotGit: Row = ["a cat's output into a .GIT-named log", "cat payload > .GIT.log"]

export const allowed: string[] = [...controls(), ...loosened(), dotGit].map(([what]) => what)
export const groups: Group[] = [
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: held },
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: closed },
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: moved },
  {
    folders: ["data folder", "home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: root,
  },
  {
    folders: ["process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [...controls(), ...loosened(), dotGit],
  },
]
