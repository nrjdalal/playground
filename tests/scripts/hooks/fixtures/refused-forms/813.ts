import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // a script's output handed to a shell in a way other than a plain pipe into it, each one a script the hook cannot read
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a script's output handed to sh -c by xargs", "bun run ask list | xargs sh -c"],
      [
        "a script's output handed to a placeholder script by xargs",
        "bun run ask list | xargs -I{} sh -c {}",
      ],
      [
        "a script's output passed through a while loop into a shell",
        "bun run ask list | while read l; do echo $l; done | sh",
      ],
      ["a script's output sourced from stdin", "bun run ask list | . /dev/stdin"],
      [
        "a script's output read by sh -c from a substitution of stdin",
        'bun run ask list | sh -c "$(cat)"',
      ],
    ],
  },
]
