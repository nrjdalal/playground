import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "data folder"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      ["awk piping its output into a shell", `awk '{ print | "sh" }'`],
      ["awk piping a division's output into a shell", `awk '{ print $1/2 | "sh" }'`],
      ["awk piping into a shell after a division", `awk '{ x = 3/4; print x | "sh" }'`],
      ["awk reading a command through getline", `awk '{ "cmd" | getline x }'`],
      [
        "awk's system() in BEGIN",
        `awk 'BEGIN { system("rm -rf ~/.playground/extensions/.no-such-folder") }'`,
      ],
      ["awk piping into a shell after a regex alternation", `awk '/a|b/ { print | "sh" }'`],
      ["awk piping into a shell after a string alternation", `awk '$1 ~ "a|b" { print | "sh" }'`],
      [
        "awk piping into a shell after a comment holding a quote",
        'awk \'# "\n{ print | "sh" }\' f',
      ],
      [
        "awk piping into a shell after a block and a comment holding a quote",
        'awk \'{ n++ } # "\n{ print | "sh" }\' f',
      ],
      [
        "awk piping into a shell after a bracketed slash and a quote",
        'awk \'/[/]"/ { print | "sh" }\' f',
      ],
      [
        "awk piping into a shell beside a regex holding a quote after print",
        'awk \'{ print /"/ | "sh"; print /"/ }\' f',
      ],
      [
        "awk piping into a shell beside a regex holding a quote after printf",
        'awk \'{ printf /"/ | "sh"; printf /"/ }\' f',
      ],
      [
        "awk piping into a shell between regexes holding a quote after a plus",
        'awk \'{ x = 1 + /"/; print | "sh"; y = 1 + /"/ }\' f',
      ],
      [
        "awk piping into a shell between regexes holding a quote after a less-than",
        'awk \'{ if (n < /"/) print | "sh"; m = n < /"/ }\' f',
      ],
      [
        "awk piping into a shell between regexes holding a quote after return and a call",
        'awk \'function f() { return /"/ } { print | "sh"; x = f() /"/ }\' f',
      ],
      [
        "awk matching an alternation and printing into the root",
        `awk '/a|b/ { print > "${ROOT}/x" }'`,
      ],
      [
        "awk's heading alternation redirected into the root",
        `awk '/^## .*6|7/{p=1} p' f > ${ROOT}/x`,
      ],
      [
        "sed -i replacing text with a slash and parens in the root",
        `sed -i '' 's/a / b (c)/new/' ${ROOT}/x`,
      ],
    ],
  },
]
