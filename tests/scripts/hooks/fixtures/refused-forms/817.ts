import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // a script's output piped into a command that can run its input as code, whatever its arguments say, each one a script the hook cannot read
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a script's output sourced from /dev/fd/0", "bun run ask list | . /dev/fd/0"],
      ["a script's output sourced from /proc/self/fd/0", "bun run ask list | . /proc/self/fd/0"],
      ["a script's output sourced from -", "bun run ask list | . -"],
      ["a script's output evaluated through a substitution", 'bun run ask list | eval "$(cat)"'],
      [
        "a script's output read by sh -c from a quoted substitution",
        "bun run ask list | sh -c '$(cat)'",
      ],
      ["a script's output read by sh -", "bun run ask list | sh -"],
      ["a script's output read by sh /dev/stdin", "bun run ask list | sh /dev/stdin"],
      [
        "a script's output read by bash from a process substitution",
        "bun run ask list | bash <(cat)",
      ],
      [
        "a script's output evaluated line by line in a loop",
        "bun run ask list | while read l; do eval $l; done",
      ],
      ["a script's output sourced by sh -c", "bun run ask list | sh -c '. /dev/stdin'"],
      ["a script's output piped on by sh -c into a shell", "bun run ask list | sh -c 'cat | sh'"],
      ["a script's output handed by xargs to $SHELL", "bun run ask list | xargs -I{} $SHELL -c {}"],
      ["a script's output piped into node", "bun run ask list | node"],
      ["a script's output piped into python3", "bun run ask list | python3"],
      ["a script's output piped into perl", "bun run ask list | perl"],
      ["a script's output piped into ruby", "bun run ask list | ruby"],
      ["a script's output piped into osascript", "bun run ask list | osascript"],
      ["a script's output piped into bun -", "bun run ask list | bun -"],
      ["a script's output handed by xargs to python3", "bun run ask list | xargs python3"],
      ["a script's output handed by xargs to node -e", "bun run ask list | xargs -I{} node -e {}"],
    ],
  },
  // stdin's other names fed text the hook reads, which it judges as the script, as it judges /dev/stdin's
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a commit sourced from /dev/fd/0", "echo 'git commit -m x' | . /dev/fd/0"],
      ["a commit sourced from /proc/self/fd/0", "echo 'git commit -m x' | . /proc/self/fd/0"],
      ["a commit sourced from -", "echo 'git commit -m x' | . -"],
    ],
  },
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      ["a write into the root sourced from /dev/fd/0", `echo 'touch ${ROOT}/a' | . /dev/fd/0`],
      [
        "a write into the root sourced from /proc/self/fd/0",
        `echo 'touch ${ROOT}/a' | . /proc/self/fd/0`,
      ],
      ["a write into the root sourced from -", `echo 'touch ${ROOT}/a' | . -`],
    ],
  },
]
