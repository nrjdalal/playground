import type { Group } from "./_shared"

// #2104: after a cd the hook cannot read, a program off every list the hook judges (an editor in script mode, a patch applier, a git subcommand that moves, restores or stages files, a build tool) was let run, though it may write the shell's folder; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["ex in script mode after a cd to a variable", `cd "$X" && ex -sc 'wq' f`],
      ["vim running a write after a cd to a variable", `cd "$X" && vim -c wq f`],
      ["patch from an absolute diff after a cd to a variable", `cd "$X" && patch -p1 < /tmp/d`],
      ["git mv after a cd to a variable", `cd "$X" && git mv a b`],
      ["git checkout of a path after a cd to a variable", `cd "$X" && git checkout -- f`],
      ["git restore after a cd to a variable", `cd "$X" && git restore f`],
      ["git apply after a cd to a variable", `cd "$X" && git apply /tmp/d`],
      ["git reset --hard after a cd to a variable", `cd "$X" && git reset --hard`],
      ["git add after a cd to a variable", `cd "$X" && git add f`],
      ["git add under xargs after a cd to a variable", `cd "$X" && grep -l a f | xargs git add`],
      ["git -C a relative folder after a cd to a variable", `cd "$X" && git -C sub checkout -- f`],
      [
        "git checkout under xargs after a cd to a variable",
        `cd "$X" && grep -l a f | xargs git checkout --`,
      ],
      ["unzip after a cd to a variable", `cd "$X" && unzip /tmp/a.zip`],
      ["bun run after a cd to a variable", `cd "$X" && bun run build`],
      [
        "patch behind nice after a cd to a substitution",
        `cd "$(cat p)" && nice patch -p1 < /tmp/d`,
      ],
      ["a shell running a script file after a cd to a variable", `cd "$X" && bash /tmp/s.sh`],
      [
        "a shell reading a script file as stdin after a cd to a variable",
        `cd "$X" && sh < /tmp/s.sh`,
      ],
      ["a shell piped a file's text after a cd to a variable", `cd "$X" && cat /tmp/s.sh | bash`],
      ["a source of a script after a cd to a variable", `cd "$X" && source ./x.sh`],
      ["a script run by its path after a cd to a variable", `cd "$X" && ./build.sh`],
      ["make after a cd to a variable", `cd "$X" && make`],
      [
        "a program after a cd to the checkout's top",
        `cd "$(git rev-parse --show-toplevel)" && bun test`,
      ],
    ],
  },
]
