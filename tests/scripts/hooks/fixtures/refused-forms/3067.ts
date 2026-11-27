import type { Group, Paths, Row } from "./_shared"

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
  [
    "a cat's output through $1 after a shift moves a set's words",
    `set -- a ${to}; shift; cat payload > "$1"`,
  ],
  [
    "a cat's output through $1 after a set the hook cannot read",
    `set -- $(printf %s ${to}); cat payload > "$1"`,
  ],
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

// a remover written through a parameter a line moves past its set, or through a value the shell may glob or a pattern the reader does not model, from #3143's review: a worked-out reading only adds a refusal
const ECHO = "echo 'rm -f x' >"
const moved = (): Row[] => [
  [
    "a remover into $1 after zsh's ::= assigns it",
    `set -- out.log; : \${1::=.git/hooks/pre-commit}; ${ECHO} "$1"`,
  ],
  [
    "a remover into $1 after zsh's ::= assigns argv[1]",
    `set -- out.log; : \${argv[1]::=.git/hooks/pre-commit}; ${ECHO} "$1"`,
  ],
  [
    "a remover into $1 after zparseopts -D drops an option",
    `set -- -x .git/hooks/pre-commit; zparseopts -D x=flag; ${ECHO} "$1"`,
  ],
  [
    "a remover into $1 after a read into 1",
    `set -- out.log; read 1 <<< .git/hooks/pre-commit; ${ECHO} "$1"`,
  ],
  [
    "a remover into $1 after printf -v 1",
    `set -- out.log; printf -v 1 .git/hooks/pre-commit; ${ECHO} "$1"`,
  ],
  ["a remover into a ? glob through $1 after set --", `set -- '.gi?/hooks/pre-commit'; ${ECHO} $1`],
  ["a remover into a * glob through $1 after set --", `set -- '.gi*/hooks/pre-commit'; ${ECHO} $1`],
  [
    "a remover into a ? glob worked out by a cut",
    `X='.gi?/hooks/pre-commit.bak'; ${ECHO} \${X%.bak}`,
  ],
  [
    "a remover into a * glob worked out by a replacement",
    `X='.gi*/hooks/pre-commit.bak'; ${ECHO} \${X/.bak/}`,
  ],
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
const unread = (what: string) => /indirect|array|split read|shift|set the hook/.test(what)
const closed = (): Row[] =>
  targets("out.log")
    .filter(([what]) => unread(what))
    .map(([what, call]): Row => [`${what}, a log, which the hook cannot read`, call])
const controls = (): Row[] =>
  targets("out.log")
    .filter(([what]) => !unread(what))
    .map(([what, call]): Row => [`${what}, a log`, call])

const dotGit: Row = ["a cat's output into a .GIT-named log", "cat payload > .GIT.log"]

// #3067 part 2: a script the line writes and then runs (a shell, source, . or its own path) is walked as it was written, so its writes into the root or a hook are judged, globs and escapes as piped text is; a glob into a hooks folder counts by the files it matches; a dangling link counts by where its chain lands; rows are data, as refused-forms.ts says
const SCRIPT = "~/.playground/extensions/login/x"
const runsRoot = (): Row[] => [
  [
    "a script written then run by bash, touching the root",
    `echo 'touch ${SCRIPT}' > run.sh; bash run.sh`,
  ],
  ["a script written then run by sh after &&", `echo 'touch ${SCRIPT}' > run.sh && sh run.sh`],
  ["a script written then sourced", `echo 'touch ${SCRIPT}' > run.sh; source run.sh`],
  ["a script written then run by .", `echo 'touch ${SCRIPT}' > run.sh; . ./run.sh`],
  [
    "a script written then run by its own path",
    `echo 'touch ${SCRIPT}' > run.sh; chmod +x run.sh; ./run.sh`,
  ],
  ["a script written by tee then run", `echo 'touch ${SCRIPT}' | tee run.sh; sh run.sh`],
  [
    "a script printf builds from parts, then run",
    "printf '%s/%s\\n' 'touch ~/.playground' 'extensions/login/x' > run.sh; sh run.sh",
  ],
  [
    "a script printf spells with a \\x escape, then run",
    "printf 'touch ~/.playground/ext\\x65nsions/login/x\\n' > run.sh; sh run.sh",
  ],
  [
    "a script echo -e spells with a \\x escape, then run",
    "echo -e 'touch ~/.playground/ext\\x65nsions/login/x' > run.sh; sh run.sh",
  ],
  [
    "a script builtin printf builds from parts, then run",
    "builtin printf '%s%s\\n' 'touch ~/.playground/exten' 'sions/login/x' > run.sh; sh run.sh",
  ],
  [
    "a script command printf spells with a \\x escape, then run",
    "command printf 'touch ~/.playground/ext\\x65nsions/login/x\\n' > run.sh; sh run.sh",
  ],
]
// a script the line writes by a form other than a redirect or tee (another case, >&, dd, sort -o, a copy, move or link to its run name or into a folder, a folder copied or moved), then runs, is walked as written, or refused as unread
const writesRun = (): Row[] => [
  ["a script written in another case, then run", `echo 'touch ${SCRIPT}' > Run.sh; sh run.sh`],
  [
    "a script run by its own path in another case",
    `echo 'touch ${SCRIPT}' > run.sh; chmod +x run.sh; ./RUN.sh`,
  ],
  ["a script written by >& to a name, then run", `echo 'touch ${SCRIPT}' >& run.sh; sh run.sh`],
  ["a script dd writes, then run", `echo 'touch ${SCRIPT}' | dd of=run.sh; sh run.sh`],
  ["a script sort -o writes, then run", `echo 'touch ${SCRIPT}' | sort -o run.sh; sh run.sh`],
  [
    "a script cp copies from stdin, then run",
    `echo 'touch ${SCRIPT}' | cp /dev/stdin run.sh; sh run.sh`,
  ],
  [
    "a script moved to its run name, then run",
    `echo 'touch ${SCRIPT}' > a.sh; mv a.sh run.sh; sh run.sh`,
  ],
  [
    "a script copied to its run name, then run",
    `echo 'touch ${SCRIPT}' > a.sh; cp a.sh run.sh; sh run.sh`,
  ],
  [
    "a script linked to its run name, then run",
    `echo 'touch ${SCRIPT}' > a.sh; ln -s a.sh run.sh; sh run.sh`,
  ],
  [
    "a script linked from a value the hook cannot read, then run",
    `echo 'touch out.log' > a.sh; ln -s "$S" run.sh; sh run.sh`,
  ],
  [
    "a script sort -o writes, run by its own path",
    `echo 'touch ${SCRIPT}' | sort -o run.sh; chmod +x run.sh; ./run.sh`,
  ],
  [
    "a script copied into a folder the line made, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > a.sh; cp a.sh d; sh d/a.sh`,
  ],
  [
    "a script copied into a folder named with a /, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > a.sh; cp a.sh d/; sh d/a.sh`,
  ],
  [
    "a script moved into a folder the line made, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > a.sh; mv a.sh d; sh d/a.sh`,
  ],
  [
    "a script in a folder copied by -r, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > d/run.sh; cp -r d e; sh e/run.sh`,
  ],
  [
    "a script in a folder copied by -r into a folder, then run",
    `mkdir d e; echo 'touch ${SCRIPT}' > d/run.sh; cp -r d e/; sh e/d/run.sh`,
  ],
  [
    "a script in a folder moved, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > d/run.sh; mv d e; sh e/run.sh`,
  ],
  [
    "a script in a folder moved to a new name with a /, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > d/run.sh; mv d e/; sh e/run.sh`,
  ],
  [
    "a script in a folder copied by -r to a new name with a /, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > d/run.sh; cp -r d e/; sh e/run.sh`,
  ],
  [
    "a script moved onto its own path by ./, then run",
    `echo 'touch ${SCRIPT}' > a.sh; mv a.sh ./a.sh; sh a.sh`,
  ],
  [
    "a script moved onto its own name, then run",
    `echo 'touch ${SCRIPT}' > a.sh; mv a.sh a.sh; sh a.sh`,
  ],
  [
    "a script moved onto its own name by -f, then run",
    `echo 'touch ${SCRIPT}' > a.sh; mv -f a.sh a.sh; sh a.sh`,
  ],
  [
    "a script in a folder moved onto its own path by ./, then run",
    `mkdir d; echo 'touch ${SCRIPT}' > d/run.sh; mv d ./d; sh d/run.sh`,
  ],
  [
    "a script kept by a cp -n of a plain one onto it, then run",
    `echo 'touch ${SCRIPT}' > run.sh; echo 'touch out.log' > a.sh; cp -n a.sh run.sh; sh run.sh`,
  ],
  [
    "a script kept by a cp -i of a plain one onto it, then run",
    `echo 'touch ${SCRIPT}' > run.sh; echo 'touch out.log' > a.sh; cp -i a.sh run.sh < /dev/null; sh run.sh`,
  ],
  [
    "a script kept by a mv -n of a plain one onto it, then run",
    `echo 'touch ${SCRIPT}' > run.sh; echo 'touch out.log' > a.sh; mv -n a.sh run.sh; sh run.sh`,
  ],
  [
    "a script a mv -n leaves at its source, then run",
    `echo 'touch out.log' > run.sh; echo 'touch ${SCRIPT}' > a.sh; mv -n a.sh run.sh; sh a.sh`,
  ],
  [
    "a script kept by an ln -s with no -f onto it, then run",
    `echo 'touch ${SCRIPT}' > run.sh; echo 'touch out.log' > a.sh; ln -s a.sh run.sh; sh run.sh`,
  ],
  [
    "a script kept by a cp from a source not there, then run",
    `echo 'touch ${SCRIPT}' > run.sh; cp no-such-3067.sh run.sh; sh run.sh`,
  ],
  [
    "a script whose tail a dd conv=notrunc keeps, then run",
    `echo 'touch ${SCRIPT}' > run.sh; echo ':' | dd of=run.sh conv=notrunc; sh run.sh`,
  ],
  [
    "a script uniq -f 1 writes, then run",
    `echo 'touch ${SCRIPT}' > in.txt; uniq -f 1 in.txt run.sh; sh run.sh`,
  ],
  [
    "a script uniq -s 1 writes, then run",
    `echo 'touch ${SCRIPT}' > in.txt; uniq -s 1 in.txt run.sh; sh run.sh`,
  ],
  [
    "a script uniq -w 9 writes, then run",
    `echo 'touch ${SCRIPT}' > in.txt; uniq -w 9 in.txt run.sh; sh run.sh`,
  ],
]
const writeControls = (): Row[] => [
  ["a plain script written in another case, then run", `echo 'touch out.log' > Run.sh; sh run.sh`],
  ["a plain script written by >& to a name, then run", `echo 'touch out.log' >& run.sh; sh run.sh`],
  ["a plain script dd writes, then run", `echo 'touch out.log' | dd of=run.sh; sh run.sh`],
  [
    "a plain script cp copies from stdin, then run",
    `echo 'touch out.log' | cp /dev/stdin run.sh; sh run.sh`,
  ],
  [
    "a plain script moved to its run name, then run",
    `echo 'touch out.log' > a.sh; mv a.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script copied to its run name, then run",
    `echo 'touch out.log' > a.sh; cp a.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script linked to its run name, then run",
    `echo 'touch out.log' > a.sh; ln -s a.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script copied into a folder the line made, then run",
    `mkdir d; echo 'touch out.log' > a.sh; cp a.sh d; sh d/a.sh`,
  ],
  [
    "a plain script copied into a folder named with a /, then run",
    `mkdir d; echo 'touch out.log' > a.sh; cp a.sh d/; sh d/a.sh`,
  ],
  [
    "a plain script moved into a folder the line made, then run",
    `mkdir d; echo 'touch out.log' > a.sh; mv a.sh d; sh d/a.sh`,
  ],
  [
    "a plain script in a folder copied by -r, then run",
    `mkdir d; echo 'touch out.log' > d/run.sh; cp -r d e; sh e/run.sh`,
  ],
  [
    "a plain script in a folder moved, then run",
    `mkdir d; echo 'touch out.log' > d/run.sh; mv d e; sh e/run.sh`,
  ],
  ["a plain copy to a file, then run", `echo 'touch out.log' > a.sh; cp a.sh d; sh d`],
  [
    "a plain script in a folder moved to a new name with a /, then run",
    `mkdir d; echo 'touch out.log' > d/run.sh; mv d e/; sh e/run.sh`,
  ],
  [
    "a plain script in a folder copied by -r to a new name with a /, then run",
    `mkdir d; echo 'touch out.log' > d/run.sh; cp -r d e/; sh e/run.sh`,
  ],
  [
    "a plain script moved onto its own path by ./, then run",
    `echo 'touch out.log' > a.sh; mv a.sh ./a.sh; sh a.sh`,
  ],
  [
    "a plain script moved onto its own name, then run",
    `echo 'touch out.log' > a.sh; mv a.sh a.sh; sh a.sh`,
  ],
  [
    "a plain script moved onto its own name by -f, then run",
    `echo 'touch out.log' > a.sh; mv -f a.sh a.sh; sh a.sh`,
  ],
  [
    "a plain script in a folder moved onto its own path by ./, then run",
    `mkdir d; echo 'touch out.log' > d/run.sh; mv d ./d; sh d/run.sh`,
  ],
  [
    "a plain script kept by a cp -n of a plain one onto it, then run",
    `echo 'touch out.log' > run.sh; echo 'touch out.log' > a.sh; cp -n a.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script kept by a mv -n of a plain one onto it, then run",
    `echo 'touch out.log' > run.sh; echo 'touch out.log' > a.sh; mv -n a.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script a mv -n leaves at its source, then run",
    `echo 'touch out.log' > run.sh; echo 'touch out.log' > a.sh; mv -n a.sh run.sh; sh a.sh`,
  ],
  [
    "a plain script kept by an ln -s with no -f onto it, then run",
    `echo 'touch out.log' > run.sh; echo 'touch out.log' > a.sh; ln -s a.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script kept by a cp from a source not there, then run",
    `echo 'touch out.log' > run.sh; cp no-such-3067.sh run.sh; sh run.sh`,
  ],
  [
    "a plain script whose tail a dd conv=notrunc keeps, then run",
    `echo 'touch out.log' > run.sh; echo ':' | dd of=run.sh conv=notrunc; sh run.sh`,
  ],
  ["a program copied from the system, then run by its path", "cp /bin/ls t; ./t"],
  ["a program copied from the system, then run by sh", "cp /bin/ls t; sh t"],
]
// shell.ts reads a script's ~ as the process's homedir() while this test sets the root's home by env HOME, so the ~ glob row is judged in the process worktree alone, where the two are one home
const worktreeRuns = (): Row[] => [
  [
    "a script naming the root by a glob, then run",
    "echo 'touch ~/.playground/ext*/login/x' > run.sh; sh run.sh",
  ],
  [
    "a script written then run, writing the git hook",
    `echo 'cat payload > ${HOOK}' > run.sh; bash run.sh`,
  ],
  [
    "a script printf builds from parts, writing the git hook, then run",
    "printf '%s/%s\\n' 'cat payload > .git' 'hooks/pre-commit' > run.sh; sh run.sh",
  ],
]
// a clone's hooks folder holding a hook, and a dangling link into the root, that refused-forms.test.ts makes in the scratch home, and the glob row by the scratch home's absolute path
const linked = ({ DATA, HOME }: Paths): Row[] => [
  [
    "a script naming the root by an absolute glob, then run",
    `echo 'touch ${DATA}/ext*/login/x' > run.sh; sh run.sh`,
  ],
  ["a cat's output into a hook by a ? glob", `cat payload > ${HOME}/hooked/.git/hook?/pre-commit`],
  [
    "a script written then run, writing a hook by a * glob",
    `echo 'cat payload > ${HOME}/hooked/.git/hook*/pre-commit' > run.sh; sh run.sh`,
  ],
  ["a touch through a dangling link into the root", `touch ${HOME}/dangling`],
  ["a redirect through a dangling link into the root", `cat payload > ${HOME}/dangling`],
  ["a cp through a dangling link into the root", `cp payload ${HOME}/dangling`],
  ["a tee through a dangling link into the root", `cat payload | tee ${HOME}/dangling`],
  ["a touch through a relative dangling link in a linked folder", `touch ${HOME}/linked-sub/rel`],
  [
    "a redirect through a relative dangling link in a linked folder",
    `cat payload > ${HOME}/linked-sub/rel`,
  ],
  [
    "an echo naming the root through a dangling link onto a hook",
    `echo 'touch ${SCRIPT}' > ${HOME}/dangling-hook`,
  ],
  [
    "a cat's output into a core.hooksPath folder by a * glob that matches nothing",
    `cat payload > ${HOME}/hookspath/hk/pre-commit*`,
  ],
  [
    "a cat's output into a core.hooksPath folder by a quoted ?",
    `cat payload > '${HOME}/hookspath/hk/pre-commi?'`,
  ],
  [
    "a cat's output into a core.hooksPath folder by a [ ] glob that matches nothing",
    `cat payload > ${HOME}/hookspath/hk/pre-commi[t]`,
  ],
  [
    "a cat's output into a core.hooksPath folder by a * glob in a name",
    `cat payload > ${HOME}/hookspath/hk/lib*.sh`,
  ],
]
// what part 2 leaves running: a script written and not run is data, a plain script runs, a glob that matches no hook, a dangling link to a plain place, and sed's scripts that run nothing
const runControls = (): Row[] => [
  ["a script naming the root, written and not run", `echo 'touch ${SCRIPT}' > run.sh`],
  [
    "a script naming the root by a glob, written and not run",
    "echo 'touch ~/.playground/ext*/login/x' > run.sh",
  ],
  [
    "a script printf builds from parts, written and not run",
    "printf '%s/%s\\n' 'touch ~/.playground' 'extensions/login/x' > run.sh",
  ],
  ["a plain script written then run by bash", "echo 'touch out.log' > run.sh; bash run.sh"],
  [
    "a plain script written then run by its own path",
    "echo 'touch out.log' > run.sh; chmod +x run.sh; ./run.sh",
  ],
  [
    "a plain script printf builds from parts, then run",
    "printf '%s/%s\\n' 'touch out' 'x.log' > run.sh; sh run.sh",
  ],
  ["a sed s between slashes", "sed 's/one/two/' notes.md"],
  ["a sed print of lines matching e", "sed '/e/p' notes.md"],
  ["a sed s whose replacement is e, with g", "sed 's/x/e/g' notes.md"],
]
const worktreeControls = (): Row[] => [
  ["a cat's output into a log by a ? glob", "cat payload > out?.log"],
  ["a plain script with a glob, written then run", "echo 'touch out*.log' > run.sh; sh run.sh"],
]
const linkControls = ({ HOME }: Paths): Row[] => [
  ["a touch through a dangling link to a plain place", `touch ${HOME}/dangling-plain`],
  [
    "an echo naming the root into a glob onto a file named with *",
    `echo 'touch ${SCRIPT}' > ${HOME}/starred/a*`,
  ],
  [
    "an echo naming the root through a dangling link to a plain place",
    `echo 'touch ${SCRIPT}' > ${HOME}/dangling-plain`,
  ],
  [
    "a cat's output into a plain folder of a core.hooksPath repo by a * glob that matches nothing",
    `cat payload > ${HOME}/hookspath/logs/out*.log`,
  ],
  [
    "a cat's output into a plain folder of a core.hooksPath repo by a quoted ?",
    `cat payload > '${HOME}/hookspath/logs/out?.log'`,
  ],
  [
    "a cat's output into a plain folder of a core.hooksPath repo by a [ ] glob that matches nothing",
    `cat payload > ${HOME}/hookspath/logs/ou[t].log`,
  ],
]

export const allowed: string[] = [
  ...controls(),
  dotGit,
  ...runControls(),
  ...writeControls(),
  ...worktreeControls(),
  ...linkControls({ HOME: "" } as Paths),
].map(([what]) => what)
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
    rows: () => [...controls(), dotGit],
  },
  {
    folders: ["data folder", "home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [...runsRoot(), ...runControls(), ...writesRun(), ...writeControls()],
  },
  {
    folders: ["process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [...worktreeRuns(), ...worktreeControls()],
  },
  {
    folders: ["data folder", "home"],
    guards: ["no-extensions-write"],
    rows: (paths) => [...linked(paths), ...linkControls(paths)],
  },
  // every guard that walks a line reads a script the line writes and runs, so no-extension-repo-write judges a push in one as typed, on 1354.ts's made-up repository
  {
    folders: ["checkout"],
    guards: ["no-extension-repo-write"],
    rows: () => [
      [
        "a push by --repo, in a script the line writes and runs",
        "echo 'git push --repo=https://github.com/quillco/acme-skills.git HEAD:feature' > run.sh; sh run.sh",
      ],
    ],
  },
]
