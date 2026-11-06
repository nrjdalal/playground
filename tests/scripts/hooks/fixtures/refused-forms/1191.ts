import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "find printing to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp/x -fprint -x`,
      ],
      [
        "find printing null-ended names to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp/x -fprint0 -x`,
      ],
      [
        "find printing a format to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp/x -fprintf -x /%p`,
      ],
      [
        "find listing to a dash-led relative file after a cd to a variable",
        `cd "$D"; find /tmp/x -fls -x`,
      ],
      [
        "GNU find by its g name deleting the shell's folder after a cd to a variable",
        `cd "$D"; gfind . -delete`,
      ],
      [
        "GNU find by its g name printing to a relative file after a cd to a variable",
        `cd "$D"; gfind /tmp/x -fprint x`,
      ],
      [
        "GNU find by its g name printing to a dash-led relative file after a cd to a variable",
        `cd "$D"; gfind /tmp/x -fprint -x`,
      ],
      [
        "GNU find by its g name listing to a dash-led relative file after a cd to a variable",
        `cd "$D"; gfind /tmp/x -fls -x`,
      ],
      [
        "GNU find by its g name printing null-ended names to a dash-led relative file after a cd to a variable",
        `cd "$D"; gfind /tmp/x -fprint0 -x`,
      ],
      [
        "GNU find by its g name printing a format to a dash-led relative file after a cd to a variable",
        `cd "$D"; gfind /tmp/x -fprintf -x /%p`,
      ],
      [
        "GNU find by its g name run from a path inside the extensions root",
        "~/.playground/extensions/gfind /tmp/x -delete",
      ],
      [
        "GNU find by a path to its g name deleting the shell's folder after a cd to a variable",
        `cd "$D"; /opt/homebrew/bin/gfind . -delete`,
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
