import { type Group, NEVER_MADE, type Row } from "./_shared"

// #2292: a wrapper's program word whose first character is a zsh group, which zsh globs against the shell's folder, run from a folder holding the program; rows are data, as refused-forms.ts says.

// zsh keeps a paren after these a subshell: `time`, `repeat`, `nocorrect`, a header's opener and a function's `()`; and a wrapper's group word, or an argument's, that matches no guarded program
const controls = (): Row[] => [
  ["a timed subshell", "time (echo sub)"],
  ["a repeated subshell", "repeat 1 (echo sub)"],
  ["a subshell after nocorrect", "nocorrect (echo sub)"],
  ["a case pattern in parens", "case a in (a) echo y;; esac"],
  ["a for list in parens", "for x in (a|b); do echo $x; done"],
  ["a function defined with ()", "f () echo fn"],
  ["a function keyword defined with ()", "function f () echo fn"],
  ["a wrapper running a group word that spells echo", "command (e|x)(c|y)ho hi"],
  ["a wrapper running a group word that spells ls", "nice (l|x)s"],
  ["a group word in an argument that spells rm", "echo (r|x)m"],
  ["a group at command position, which zsh refuses to parse", `(r|x)m ${NEVER_MADE}`],
  [
    "a loop over regex text with a blank inside a group",
    `for pat in 'a' '\\d[\\d,]*\\+? (live )?units'; do echo "$pat"; done`,
  ],
  ["a wrapper running a group word with a blank that spells echo", "command (e|x y)cho hi"],
  ["a wrapper running a group word that spells echo after an unset name", "nice $E (e|x)cho hi"],
  ["an escaped time running a group word that spells echo", "\\time (e|x)cho hi"],
  ["time before a wrapper running a group word that spells echo", "time command (e|x)cho hi"],
  ["a subshell after time and repeat", "time repeat 1 (echo sub)"],
  ["a subshell after repeat and time", "repeat 1 time (echo sub)"],
  ["a subshell after two repeats", "repeat 1 repeat 1 (echo sub)"],
  ["a coprocess's timed subshell", "coproc time (echo sub)"],
  ["a timed subshell in a brace group", "{ time (echo sub) }"],
  ["a paren after two times, read as a subshell", "time time (echo sub)"],
  ["a wrapper before a paren holding a command line of echoes", "nice (echo a; echo b)"],
]

// zsh keeps a subshell after a stack of time, nocorrect and repeat N leads; `time time`'s reading is a known limit the README's shared reader section names
const stacked = (body: string, what: string): Row[] => [
  [`a subshell after time and repeat running ${what}`, `time repeat 1 (${body})`],
  [`a subshell after repeat and time running ${what}`, `repeat 1 time (${body})`],
  [`a subshell after two repeats running ${what}`, `repeat 1 repeat 1 (${body})`],
  [
    `a subshell after time and repeat running ${what}, after a header line`,
    `#!/bin/sh\ntime repeat 1 (${body})`,
  ],
  [`a coprocess's timed subshell running ${what}`, `coproc time (${body})`],
  [`a timed subshell in a brace group running ${what}`, `{ time (${body}) }`],
  [`a paren after two times running ${what}`, `time time (${body})`],
]

// a paren holding a command line after a wrapper, which zsh reads as a glob word but canary read as a subshell whose commands it judged
const lines = (body: string, what: string): Row[] => [
  [`a wrapper before a paren holding ${what}`, `nice (${body})`],
  [`a wrapper before a paren holding ${what} after a semicolon`, `command (ls; ${body})`],
  [`a wrapper before a paren holding ${what} before a semicolon`, `command (${body};x)`],
  [`a wrapper before a paren holding ${what} before an ampersand`, `command (${body}&x)`],
  [`a wrapper before a paren holding ${what} piped`, `nice (${body}|cat)`],
  [`a wrapper before a paren holding ${what}, after a header line`, `#!/bin/sh\nnice (${body})`],
]

const deleteControls = (): Row[] => [
  ["a wrapper running a delete a zsh group spells, in a comment", `# command (r|x)m ${NEVER_MADE}`],
]

const killControls = (): Row[] => [
  [
    "a wrapper running a kill by name zsh groups spell, in a comment",
    "# command (p|x)(k|y)ill -f watcher",
  ],
]

const stashControls = (): Row[] => [
  [
    "a wrapper running a stash pop zsh groups spell, in a comment",
    "# command (g|x)(i|y)t stash pop",
  ],
]

export const groups: Group[] = [
  {
    folders: ["system bin"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["command running a plain rm two zsh groups spell", `command (r|x)(m|y) ${NEVER_MADE}`],
      ["exec running a plain rm two zsh groups spell", `exec (r|x)(m|y) ${NEVER_MADE}`],
      ["command running a plain rm one zsh group spells", `command (r|x)m ${NEVER_MADE}`],
      ["env running a plain rm one zsh group spells", `env (r|x)m ${NEVER_MADE}`],
      ["nohup running a plain rm one zsh group spells", `nohup (r|x)m ${NEVER_MADE}`],
      ["command -p running a plain rm one zsh group spells", `command -p (r|x)m ${NEVER_MADE}`],
      [
        "command running a plain rm one zsh group spells, after a header line",
        `#!/bin/sh\ncommand (r|x)m ${NEVER_MADE}`,
      ],
      [
        "command running a plain rm one zsh group spells across a backslash-newline",
        `command (r|\\\nx)m ${NEVER_MADE}`,
      ],
      // a wrapper after zsh's time, repeat or nocorrect, or a time zsh reads as a program word
      [
        "time before command running a plain rm one zsh group spells",
        `time command (r|x)m ${NEVER_MADE}`,
      ],
      [
        "repeat before command running a plain rm one zsh group spells",
        `repeat 1 command (r|x)m ${NEVER_MADE}`,
      ],
      [
        "nocorrect before command running a plain rm one zsh group spells",
        `nocorrect command (r|x)m ${NEVER_MADE}`,
      ],
      [
        "a negated time before command running a plain rm one zsh group spells",
        `! time command (r|x)m ${NEVER_MADE}`,
      ],
      [
        "time before nice running a plain rm one zsh group spells",
        `time nice (r|x)m ${NEVER_MADE}`,
      ],
      ["an escaped time running a plain rm one zsh group spells", `\\time (r|x)m ${NEVER_MADE}`],
      ["a quoted time running a plain rm one zsh group spells", `'time' (r|x)m ${NEVER_MADE}`],
      [
        "a branch's time before command running a plain rm one zsh group spells",
        `if true; then time command (r|x)m ${NEVER_MADE}; fi`,
      ],
      // a group holding a blank, bare, escaped or quoted
      [
        "command running a plain rm a zsh group with a blank spells",
        `command (r|x y)m ${NEVER_MADE}`,
      ],
      [
        "command running a plain rm a zsh group with an escaped blank spells",
        `command (r|x\\ y)m ${NEVER_MADE}`,
      ],
      [
        "command running a plain rm a zsh group with a single-quoted blank spells",
        `command (r|'x y')m ${NEVER_MADE}`,
      ],
      [
        "nice running a plain rm a zsh group with a double-quoted blank spells",
        `nice (r|"x y")m ${NEVER_MADE}`,
      ],
      // a word that may expand to no word before the group
      [
        "nice running a plain rm one zsh group spells after an unset name",
        `nice $E (r|x)m ${NEVER_MADE}`,
      ],
      [
        "command running a plain rm one zsh group spells after an unset name",
        `command $E (r|x)m ${NEVER_MADE}`,
      ],
      // a subshell zsh keeps after these, refused at canary and kept as pins
      ["a timed subshell running a plain rm", `time (/bin/rm ${NEVER_MADE})`],
      ["a repeated subshell running a plain rm", `repeat 1 (/bin/rm ${NEVER_MADE})`],
      ["a condition's subshell running a plain rm", `if (/bin/rm ${NEVER_MADE}); then :; fi`],
      ["a wrapper before a paren holding a blank and a plain rm", `nice (/bin/rm ${NEVER_MADE})`],
      [
        "a wrapper before a paren holding a slash and a plain rm, from a worktree",
        `nice (/bin/rm ${NEVER_MADE})`,
        "process worktree",
      ],
      [
        "command running a plain rm by a path a zsh group matches",
        `command /bin/(r|x)m ${NEVER_MADE}`,
      ],
      ...stacked(`/bin/rm ${NEVER_MADE}`, "a plain rm"),
      ...lines(`rm ${NEVER_MADE}`, "a plain rm"),
      ...controls(),
      ...deleteControls(),
    ],
  },
  {
    folders: ["system usr bin"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["command running a kill by name two zsh groups spell", "command (p|x)(k|y)ill -f watcher"],
      ["exec running a kill by name two zsh groups spell", "exec (p|x)(k|y)ill -f watcher"],
      ["nice running a kill by name two zsh groups spell", "nice (p|x)(k|y)ill -f watcher"],
      ["env running a kill by name one zsh group spells", "env (p|x)kill -f watcher"],
      ["sudo running a kill by name one zsh group spells", "sudo (p|x)kill -f watcher"],
      ["nohup running a kill by name one zsh group spells", "nohup (p|x)kill -f watcher"],
      ["builtin before a kill by name one zsh group spells", "builtin (p|x)kill -f watcher"],
      ["command -p running a kill by name one zsh group spells", "command -p (p|x)kill -f watcher"],
      [
        "command running a kill by name two zsh groups spell, after a header line",
        "#!/bin/sh\ncommand (p|x)(k|y)ill -f watcher",
      ],
      [
        "command running a kill by name two zsh groups spell across a backslash-newline",
        "command (p|\\\nx)(k|y)ill -f watcher",
      ],
      [
        "time before command running a kill by name one zsh group spells",
        "time command (p|x)kill -f watcher",
      ],
      [
        "an escaped time running a kill by name one zsh group spells",
        "\\time (p|x)kill -f watcher",
      ],
      [
        "repeat before nice running a kill by name one zsh group spells",
        "repeat 1 nice (p|x)kill -f watcher",
      ],
      [
        "command running a kill by name a zsh group with a blank spells",
        "command (p|x y)kill -f watcher",
      ],
      [
        "nice running a kill by name a zsh group with a quoted blank spells",
        "nice (p|'x y')kill -f watcher",
      ],
      // refused at canary and kept as a pin
      [
        "nice running a kill by name one zsh group spells after an unset name",
        "nice $E (p|x)kill -f watcher",
      ],
      ...stacked("pkill -f watcher", "a kill by name"),
      ...lines("pkill -f watcher", "a kill by name"),
      [
        "a wrapper before a paren holding a kill by name before a semicolon, bare",
        "command (pkill;x)",
      ],
      ...controls(),
      ...killControls(),
    ],
  },
  {
    folders: ["system usr bin"],
    guards: ["no-stash"],
    rows: () => [
      ["command running a stash pop two zsh groups spell", "command (g|x)(i|y)t stash pop"],
      ["exec running a stash pop two zsh groups spell", "exec (g|x)(i|y)t stash pop"],
      ["nice running a stash pop two zsh groups spell", "nice (g|x)(i|y)t stash pop"],
      ["command running a stash pop one zsh group spells", "command (g|x)it stash pop"],
      ["env running a stash pop one zsh group spells", "env (g|x)it stash pop"],
      [
        "command running a stash pop two zsh groups spell, after a header line",
        "#!/bin/sh\ncommand (g|x)(i|y)t stash pop",
      ],
      [
        "command running a stash pop two zsh groups spell across a backslash-newline",
        "command (g|\\\nx)(i|y)t stash pop",
      ],
      [
        "time before command running a stash pop one zsh group spells",
        "time command (g|x)it stash pop",
      ],
      ["an escaped time running a stash pop one zsh group spells", "\\time (g|x)it stash pop"],
      [
        "nocorrect before exec running a stash pop one zsh group spells",
        "nocorrect exec (g|x)it stash pop",
      ],
      [
        "command running a stash pop a zsh group with a blank spells",
        "command (g|x y)it stash pop",
      ],
      [
        "exec running a stash pop a zsh group with an escaped blank spells",
        "exec (g|x\\ y)it stash pop",
      ],
      [
        "nice running a stash pop one zsh group spells after an unset name",
        "nice $E (g|x)it stash pop",
      ],
      ...stacked("git stash pop", "a stash pop"),
      ...lines("git stash pop", "a stash pop"),
      ...controls(),
      ...stashControls(),
    ],
  },
]

export const allowed: string[] = [
  ...controls(),
  ...deleteControls(),
  ...killControls(),
  ...stashControls(),
].map(([what]) => what)
