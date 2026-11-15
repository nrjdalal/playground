import { type Group, NEVER_MADE, type Row } from "./_shared"

// #2280: a program word spelled by a brace sequence, a brace list fused with a zsh group, a one-word zsh group after a cd into a folder the reader cannot read, or a brace list or zsh group past the spelling cap; rows are data, as refused-forms.ts says. Each path row names a program both macOS and Linux keep at that path.

// a zsh group of more alternatives than a guard's first look spells, its last the program's own letters
const overCap = (last: string) =>
  `(${Array.from({ length: 65 }, (_, k) => `z${k}`).join("|")}|${last})`

const killControls = (): Row[] => [
  ["an echo of a kill path a brace sequence spells", "echo /usr/bin/pk{i..i}ll -f watcher"],
  ["an echo of a kill name a one-word zsh group spells, after a cd", `cd "$Q" && echo pk(i)ll`],
  ["an echo of a brace list past the cap", "echo pk{i,x}{a,}{b,}{c,}{d,}{e,}{f,}ll -f watcher"],
  ["an echo of a zsh group past the cap", `echo /usr/bin/pk${overCap("i")}ll -f watcher`],
  ["a kill by name past the cap in a comment", "# pk{i,x}{a,}{b,}{c,}{d,}{e,}{f,}ll -f watcher"],
  ["a plain program word beside a kill's words", "echo -f watcher"],
]

const deleteControls = (): Row[] => [
  ["an echo of a delete path a brace sequence spells", `echo /bin/r{m..m} ${NEVER_MADE}`],
  ["a brace sequence as a list's argument", "ls {a..c}"],
  ["a delete a brace sequence spells in a comment", `# /bin/r{m..m} ${NEVER_MADE}`],
  ["an echo of a delete path a zsh group past the cap matches", `echo /bin/r${overCap("m")}`],
]

const stashControls = (): Row[] => [
  [
    "an echo of a git path a zsh group past the cap matches",
    `echo /usr/bin/g${overCap("i")}t stash pop`,
  ],
]

export const groups: Group[] = [
  {
    folders: ["process data folder", "process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a plain rm by a path a brace sequence spells", `/bin/r{m..m} ${NEVER_MADE}`],
      [
        "a plain rm by a path a brace sequence spells, after a header line",
        `#!/bin/sh\n/bin/r{m..m} ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path a brace sequence spells across a backslash-newline",
        `/bin/r{m..\\\nm} ${NEVER_MADE}`,
      ],
      ["a plain rm by a path two brace sequences spell", `/bin/{r..r}{m..m} ${NEVER_MADE}`],
      [
        "a plain rm by a path a brace list past the cap spells",
        `/bin/r{m,x}{,a}{,b}{,c}{,d}{,e}{,f} ${NEVER_MADE}`,
      ],
      [
        "a plain rm by a path a zsh group past the cap matches",
        `/bin/r${overCap("m")} ${NEVER_MADE}`,
      ],
      ...deleteControls(),
    ],
  },
  {
    folders: ["checkout", "home"],
    guards: ["no-kill-by-name"],
    rows: () => [
      [
        "a kill by name a brace list fused with a zsh group spells",
        "/usr/bin/pk{(i|x),y}ll -f watcher",
      ],
      [
        "a kill by name a brace list fused with a zsh group spells, after a header line",
        "#!/bin/sh\n/usr/bin/pk{(i|x),y}ll -f watcher",
      ],
      [
        "a kill by name a brace list fused with a zsh group spells across a backslash-newline",
        "/usr/bin/pk{(i|x),\\\ny}ll -f watcher",
      ],
      [
        "a kill by name a one-word zsh group spells, after a cd into a folder it cannot read",
        `cd "$Q" && pk(i)ll -f watcher`,
      ],
      [
        "a kill by name a one-word zsh group spells across a backslash-newline, after a cd into a folder it cannot read",
        `cd "$Q" && pk(\\\ni)ll -f watcher`,
      ],
      [
        "a kill by name a brace list past the cap spells",
        "pk{i,x}{a,}{b,}{c,}{d,}{e,}{f,}ll -f watcher",
      ],
      [
        "a kill by name at a path a zsh group past the cap matches",
        `/usr/bin/pk${overCap("i")}ll -f watcher`,
      ],
      ...killControls(),
    ],
  },
  {
    folders: ["checkout", "data folder", "home"],
    guards: ["no-stash"],
    rows: () => [
      [
        "a stash pop by a git path a zsh group past the cap matches",
        `/usr/bin/g${overCap("i")}t stash pop`,
      ],
      [
        "a stash pop by a git path a brace list past the cap spells",
        "/usr/bin/g{i,x}{,a}{,b}{,c}{,d}{,e}{,f}t stash pop",
      ],
      ...stashControls(),
    ],
  },
]

export const allowed: string[] = [...killControls(), ...deleteControls(), ...stashControls()].map(
  ([what]) => what,
)
