import { type Group, NEVER_MADE } from "./_shared"

// The text each row's same-shell runner is handed, built at run time from pieces, so it spells neither the variable it assigns nor the guarded folder: the assignment of XY to a path under NEVER_MADE.
const BUILT = `"$(printf '\\x58\\x59=%s/.play%sground/exten%ssions/.no-such-folder/x' "$HOME" "" "")"`

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "data folder", "home"],
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
        "cp of a held variable after a DEBUG trap of literal text that sources a file the line writes",
        `printf '%s\\n' ${BUILT} > /tmp/t; trap 'source /tmp/t' DEBUG; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "cp of a held variable after a DEBUG trap of literal text whose command name expands only when it runs",
        `Q=${BUILT}; trap '$C $Q' DEBUG; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "an EXIT trap of literal text that copies into the root",
        `trap 'cp g ${NEVER_MADE}/x' EXIT`,
      ],
      [
        "cp of a held variable after zsh's sched whose text the hook cannot read",
        `sched +0 ${BUILT}; XY=/tmp/a; cp g "$XY"`,
      ],
      [
        "cp of a held variable after zsh's emulate -c whose text the hook cannot read",
        `XY=/tmp/a; emulate zsh -c ${BUILT}; cp g "$XY"`,
      ],
      [
        "cp of a held variable after zsh's emulate -c in sh mode",
        `XY=/tmp/a; emulate sh -c ${BUILT}; cp g "$XY"`,
      ],
      [
        "cp of a held variable after zsh's emulate -c run through builtin",
        `XY=/tmp/a; builtin emulate zsh -c ${BUILT}; cp g "$XY"`,
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
