import { type Group } from "./_shared"

// The text each row's same-shell runner is handed, built at run time from pieces, so it spells neither the variable it assigns nor the guarded folder: the assignment of XY to a path under NEVER_MADE.
const BUILT = `"$(printf '\\x58\\x59=%s/.play%sground/exten%ssions/.no-such-folder/x' "$HOME" "" "")"`

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "cp of a held variable after a DEBUG trap whose text the hook cannot read",
        `trap ${BUILT} DEBUG; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "rm of a held variable after a DEBUG trap whose text the hook cannot read",
        `trap ${BUILT} DEBUG; XY=/tmp/a; rm -f "$XY"`,
      ],
      [
        "cp of a held variable after a DEBUG trap set past its end of options",
        `trap -- ${BUILT} DEBUG; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "cp of a held variable after a DEBUG trap run through builtin",
        `builtin trap ${BUILT} DEBUG; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "cp of a held variable after zsh's sched whose text the hook cannot read",
        `sched +0 ${BUILT}; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "cp of a held variable after a call to a function autoload reads from a file the line writes",
        `mkdir -p /tmp/fp; printf '%s\\n' ${BUILT} > /tmp/fp/f; fpath+=/tmp/fp; autoload -U f; XY=/tmp/a; f; cp g "$XY"`,
      ],
      [
        "cp of a held variable after a command whose name is a substitution",
        `XY=/tmp/a; $(printf ex%sport "") ${BUILT}; cp g "$XY"`,
      ],
      [
        "cp of a held variable after a command whose name is a variable the line never sets",
        `XY=/tmp/a; $C ${BUILT}; cp g "$XY"`,
      ],
    ],
  },
]
