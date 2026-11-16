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
      // a subshell zsh keeps after these, refused at canary and kept as pins
      ["a timed subshell running a plain rm", `time (/bin/rm ${NEVER_MADE})`],
      ["a repeated subshell running a plain rm", `repeat 1 (/bin/rm ${NEVER_MADE})`],
      ["a condition's subshell running a plain rm", `if (/bin/rm ${NEVER_MADE}); then :; fi`],
      ["a wrapper before a paren holding a blank and a plain rm", `nice (/bin/rm ${NEVER_MADE})`],
      [
        "command running a plain rm by a path a zsh group matches",
        `command /bin/(r|x)m ${NEVER_MADE}`,
      ],
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
