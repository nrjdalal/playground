import { type Group, NEVER_MADE, type Row } from "./_shared"

// #2259: a program word spelled by a brace list the shell expands, or by a zsh group the Bash tool's zsh globs (`(a|b)`, and the glob qualifiers that close a word), on the command line and in text written into a git hook; rows are data, as refused-forms.ts says. Each path row names a program both macOS and Linux keep at that path.
const hook = (what: string, content: string): Row => [
  what,
  { input: { content, file_path: ".git/hooks/pre-commit" }, tool: "Write" },
]

const held = (): Row[] => [
  hook(
    "a Write of a program a brace list spells into a git hook",
    "#!/bin/sh\n/bin/r{m,} old.log\n",
  ),
  hook(
    "a Write of a program a zsh alternation names into a git hook",
    "#!/bin/sh\n/bin/r(m|x) old.log\n",
  ),
  hook(
    "a Write of a program a brace list spells across a backslash-newline into a git hook",
    "#!/bin/sh\n/bin/r{m,\\\n} old.log\n",
  ),
  hook(
    "a Write of a program a brace list spells after a comment that ends at a backslash into a git hook",
    "#!/bin/sh\n# x \\\n/bin/r{m,} old.log\n",
  ),
]

const controls = (): Row[] => [
  hook(
    "a Write of a brace list used only as an argument into a git hook",
    "#!/bin/sh\necho {a,b}\nbun run lint\n",
  ),
  hook(
    "a Write of a brace-list program in a comment into a git hook",
    "#!/bin/sh\n# /bin/r{m,} old.log\nbun run lint\n",
  ),
  hook(
    "a Write of a function and a subshell into a git hook",
    "#!/bin/sh\nf() { echo hi; }\nf\n(cd x && bun run lint)\n",
  ),
]

export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["a kill by name at a path a brace list spells", "/usr/bin/pk{i,x}ll -f watcher"],
      ["a kill by name at a path a zsh alternation matches", "/usr/bin/pk(i|x)ll -f watcher"],
      ["a kill by name a bare brace list spells", "pk{i,x}ll -f watcher"],
      ["a kill by name as a brace list's first word", "{pkill,true} -f watcher"],
      ["a kill by name at a path a one-word zsh group matches", "/usr/bin/pk(i)ll -f watcher"],
      ["a kill by name at a path a nested zsh group matches", "/usr/bin/pk((i)|x)ll -f watcher"],
      [
        "a kill by name at a path a brace list spells across a backslash-newline",
        "/usr/bin/pk\\\n{i,x}ll -f watcher",
      ],
      [
        "a kill by name at a path a brace list spells beside a quote",
        "/usr/bin/p'k'{i,x}ll -f watcher",
      ],
      ["a kill by name at a path with zsh glob qualifiers", "/usr/bin/pkill(x) -f watcher"],
      [
        "a kill by name at a path a zsh alternation matches, with glob qualifiers",
        "/usr/bin/pk(i|x)ll(x) -f watcher",
      ],
      [
        "a kill by name at a relative path a zsh alternation matches",
        "cd /usr/bin && ./pk(i|x)ll -f watcher",
      ],
      ["a kill by name at a path a brace sequence spells", "/usr/bin/pk{i..i}ll -f watcher"],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-stash"],
    rows: () => [
      ["a stash pop by a git path a zsh alternation matches", "/usr/bin/g(i|x)t stash pop"],
      [
        "a stash pop by a git path a zsh alternation matches, with glob qualifiers",
        "/usr/bin/g(i|x)t(x) stash pop",
      ],
      ["a stash pop by a git path a brace list spells", "/usr/bin/g{i,x}t stash pop"],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a plain rm by a path a zsh alternation matches", `/bin/r(m|x) ${NEVER_MADE}`],
      [
        "a plain rm by a path a zsh alternation matches, with glob qualifiers",
        `/bin/r(m|x)(x) ${NEVER_MADE}`,
      ],
      ["a plain rm by a path a brace list spells", `/bin/r{m,x} ${NEVER_MADE}`],
    ],
  },
  {
    folders: ["data folder", "home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [...held(), ...controls()],
  },
]

export const allowed: string[] = controls().map(([what]) => what)
