import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "find printing to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp -fprint -x`,
      ],
      [
        "find printing null-ended names to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp -fprint0 -x`,
      ],
      [
        "find printing a format to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp -fprintf -x /%p`,
      ],
      [
        "find listing to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp -fls -x`,
      ],
      [
        "GNU find by its g name deleting the shell's folder after a cd to a variable",
        `cd "$D"; gfind . -delete`,
      ],
      [
        "GNU find by its g name printing to a relative file after a cd to a variable",
        `cd "$D"; gfind /tmp -fprint x`,
      ],
      [
        "GNU find by its g name printing to a dash-led relative file after a cd to a variable",
        `cd "$D"; gfind /tmp -fprint -x`,
      ],
      [
        "GNU find by its g name listing to a dash-led relative file after a cd to a variable",
        `cd "$D"; gfind /tmp -fls -x`,
      ],
      [
        "GNU xargs by its g name running rm on a list after a cd to a variable",
        `cd "$D"; gxargs rm < /tmp/list`,
      ],
      [
        "GNU xargs by its g name with an option running rm on a list after a cd to a variable",
        `cd "$D"; gxargs -0 rm -rf < /tmp/list`,
      ],
    ],
  },
]
