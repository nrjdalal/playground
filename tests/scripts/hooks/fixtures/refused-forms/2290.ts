import { type Group, NEVER_MADE, type Row } from "./_shared"

// #2290: a zsh `=(…)` process substitution, whose commands the reader never lexed, and program words of zsh groups side by side; rows are data, as refused-forms.ts says. Each path row names a program both macOS and Linux keep at that path.

// zsh process substitutions of read-only commands, and side-by-side zsh groups whose every expansion misses rm, pkill and git, so the shell finds no such program
const controls = (): Row[] => [
  ["a file of a listing's output", "cat =(ls)"],
  ["a diff of two listings' output", "diff =(ls a) =(ls b)"],
  ["side-by-side groups in an argument", "echo (a|b)(c|d)"],
]

// gaps-2289-r1 rows 7 to 10: each expansion is rmm, rmx, rxm or rxx, never rm
const sideBySide = (): Row[] => [
  [
    "side-by-side groups whose expansions miss rm, glued to a subshell's paren",
    `(/bin/r(m|x)(m|x) ${NEVER_MADE})`,
  ],
  [
    "side-by-side groups whose expansions miss rm, spaced from a subshell's paren",
    `( /bin/r(m|x)(m|x) ${NEVER_MADE} )`,
  ],
  ["side-by-side groups whose expansions miss rm", `/bin/r(m|x)(m|x) ${NEVER_MADE}`],
  [
    "side-by-side groups whose expansions miss rm, glued to a substitution's paren after an =",
    `x=$(/bin/r(m|x)(m|x) ${NEVER_MADE})`,
  ],
]

const deleteControls = (): Row[] => [
  ["a delete inside a zsh process substitution, in a comment", `# cat =(/bin/rm ${NEVER_MADE})`],
  [
    "a delete a brace sequence spells inside a zsh process substitution, in a comment",
    `# cat =(/bin/r{m..m} ${NEVER_MADE})`,
  ],
]

const killControls = (): Row[] => [
  ["a kill by name inside a zsh process substitution, in a comment", "# cat =(pkill -f watcher)"],
  [
    "a kill by name a zsh alternation spells inside a zsh process substitution, in a comment",
    "# cat =(pk(i|x)ll -f watcher)",
  ],
]

const stashControls = (): Row[] => [
  ["a stash pop inside a zsh process substitution, in a comment", "# cat =(git stash pop)"],
]

export const groups: Group[] = [
  {
    folders: ["process data folder", "process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a plain rm inside a zsh process substitution", `cat =(/bin/rm ${NEVER_MADE})`],
      ["a plain rm spaced inside a zsh process substitution", `cat =( /bin/rm ${NEVER_MADE} )`],
      [
        "a plain rm by a path a brace sequence spells inside a zsh process substitution",
        `cat =(/bin/r{m..m} ${NEVER_MADE})`,
      ],
      [
        "a plain rm by a path a brace sequence spells, spaced inside a zsh process substitution",
        `cat =( /bin/r{m..m} ${NEVER_MADE} )`,
      ],
      [
        "a plain rm by a path a brace sequence spells inside a zsh process substitution, after a header line",
        `#!/bin/sh\ncat =(/bin/r{m..m} ${NEVER_MADE})`,
      ],
      [
        "a plain rm by a path a brace sequence spells across a backslash-newline inside a zsh process substitution",
        `cat =(/bin/r{m..\\\nm} ${NEVER_MADE})`,
      ],
      [
        "a plain rm inside a zsh process substitution read as a redirect's file",
        `cat < =(/bin/rm ${NEVER_MADE})`,
      ],
      [
        "a plain rm inside a zsh process substitution, in a subshell",
        `(cat =(/bin/rm ${NEVER_MADE}))`,
      ],
      // refused at canary and kept as a pin
      [
        "a plain rm inside a zsh process substitution after another",
        `diff =(ls) =(/bin/rm ${NEVER_MADE})`,
      ],
      // side-by-side zsh groups that can spell rm, refused at canary and kept as pins
      [
        "a plain rm by a path side-by-side groups match, one with an empty alternative",
        `/bin/r(m|x)(|y) ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path side-by-side groups match, glued to a subshell's paren",
        `(/bin/r(m|x)(|y) ${NEVER_MADE})`,
      ],
      [
        "a plain rm by a path side-by-side groups match, spaced from a subshell's paren",
        `( /bin/r(m|x)(|y) ${NEVER_MADE} )`,
      ],
      [
        "a plain rm by a path side-by-side groups match, glued to a substitution's paren after an =",
        `x=$(/bin/r(m|x)(|y) ${NEVER_MADE})`,
      ],
      [
        "a plain rm by a path side-by-side groups match, the empty alternative first",
        `/bin/r(|x)(m|y) ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path side-by-side groups match, the empty alternative last",
        `/bin/r(m|x)(m|) ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path side-by-side groups match, one a single alternative",
        `/bin/r(m)(|x) ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path two side-by-side groups match, each one letter",
        `/bin/(r|x)(m|y) ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path two side-by-side groups match, glued to a subshell's paren",
        `(/bin/(r|x)(m|y) ${NEVER_MADE})`,
      ],
      ["a plain rm by a path three side-by-side groups match", `/bin/(r|x)(m|y)(|z) ${NEVER_MADE}`],
      [
        "a plain rm side-by-side groups spell after a cd into a folder it cannot read",
        `cd "$Q" && r(m|x)(|y) ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path a brace list beside a zsh group spells",
        `/bin/r{m,x}(|y) ${NEVER_MADE}`,
      ],
      ...controls(),
      ...sideBySide(),
      ...deleteControls(),
    ],
  },
  {
    folders: ["checkout", "home"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["a kill by name inside a zsh process substitution", "cat =(pkill -f watcher)"],
      ["a kill by name spaced inside a zsh process substitution", "cat =( pkill -f watcher )"],
      [
        "a kill by name a zsh alternation spells inside a zsh process substitution",
        "cat =(pk(i|x)ll -f watcher)",
      ],
      [
        "a kill by name a zsh alternation spells, spaced inside a zsh process substitution",
        "cat =( pk(i|x)ll -f watcher )",
      ],
      [
        "a kill by name at a path a zsh alternation matches inside a zsh process substitution",
        "cat =(/usr/bin/pk(i|x)ll -f watcher)",
      ],
      [
        "a kill by name at a path a zsh alternation matches, spaced inside a zsh process substitution",
        "cat =( /usr/bin/pk(i|x)ll -f watcher )",
      ],
      [
        "a kill by name a zsh alternation spells inside a zsh process substitution, after a header line",
        "#!/bin/sh\ncat =(pk(i|x)ll -f watcher)",
      ],
      [
        "a kill by name a zsh alternation spells across a backslash-newline inside a zsh process substitution",
        "cat =(pk(i|\\\nx)ll -f watcher)",
      ],
      [
        "a kill by name inside a zsh process substitution read as a redirect's file",
        "cat < =(pkill -f watcher)",
      ],
      // side-by-side zsh groups that can spell pkill, refused at canary and kept as pins
      ["a kill by name at a path side-by-side groups match", "/usr/bin/pk(i|x)(l|y)l -f watcher"],
      [
        "a kill by name side-by-side groups spell, one with an empty alternative, glued to a subshell's paren",
        "(pk(i|x)(l|)l -f watcher)",
      ],
      [
        "a kill by name at a path side-by-side groups match, each two letters",
        "/usr/bin/p(k|x)(i|y)ll -f watcher",
      ],
      ...controls(),
      ...killControls(),
    ],
  },
  {
    folders: ["checkout", "data folder", "home"],
    guards: ["no-stash"],
    rows: () => [
      ["a stash pop inside a zsh process substitution", "cat =(git stash pop)"],
      ["a stash pop spaced inside a zsh process substitution", "cat =( git stash pop )"],
      [
        "a stash pop inside a zsh process substitution read as a redirect's file",
        "cat < =(git stash pop)",
      ],
      [
        "a stash pop at a path a zsh alternation matches inside a zsh process substitution",
        "cat =(/usr/bin/g(i|x)t stash pop)",
      ],
      ...controls(),
      ...stashControls(),
    ],
  },
]

export const allowed: string[] = [
  ...controls(),
  ...sideBySide(),
  ...deleteControls(),
  ...killControls(),
  ...stashControls(),
].map(([what]) => what)
