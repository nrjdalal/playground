import { type Group } from "./_shared"

// #2161: a builtin later on the line may change a held variable's value or leave it with no word, so the program after it runs where the reader read the old value; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-kill-by-name"],
    rows: () => [
      [
        "a kill by pattern behind a variable unset after it is set",
        "X=a; unset X; $X pkill -f watcher",
      ],
      ["a kill by pattern behind a variable set to a blank", 'X=" "; $X pkill -f watcher'],
      [
        "a kill by pattern behind a variable set to blanks the line's IFS splits at",
        'IFS=" "; X="  "; $X pkill -f watcher',
      ],
      ["a kill by pattern behind a variable unset with -v", "X=a; unset -v X; $X pkill -f watcher"],
      [
        "a kill by pattern behind a variable zsh unsets by a pattern",
        "X=a; unset -m 'X*'; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable unset behind an &&",
        "X=a; true && unset X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable read sets at the end of its input",
        "X=a; read X < /dev/null; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable read sets with no value before it",
        "read X < /dev/null; $X pkill -f watcher",
      ],
      ["a kill by pattern behind a variable read binds", "read s; $s pkill -f watch"],
      [
        "a kill by pattern behind a variable read binds after its options",
        "read -r -p prompt s; $s pkill -f watch",
      ],
      ["a kill by pattern behind an array read binds", "read -a s; $s pkill -f watch"],
      [
        "a kill by pattern behind a variable a while read loop leaves",
        "X=a; while read X; do :; done < /dev/null; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable printf -v sets",
        "X=a; printf -v X ''; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable declare makes a reference",
        "X=a; declare -n X=Y; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable typeset gives an attribute",
        "X=a; typeset -u X; $X pkill -f watcher",
      ],
      ["a kill by pattern behind a variable local declares", "X=a; local X; $X pkill -f watcher"],
      [
        "a kill by pattern behind a variable zsh's private declares",
        "X=a; private X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable zsh's float declares",
        "X=a; float X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable zsh's integer declares",
        "X=a; integer X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable export gives an option",
        "X=a; export -n X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable readonly gives an option",
        "X=a; readonly -a X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable zsh's set -A sets",
        "X=a; set -A X; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable an unread eval may change",
        'X=a; eval "$Y"; $X pkill -f watcher',
      ],
      [
        "a kill by pattern behind a variable a sourced file may change",
        "X=a; source ./env.sh; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable a dot-sourced file may change",
        "X=a; . ./env.sh; $X pkill -f watcher",
      ],
      [
        "a kill by pattern behind a variable a program the reader cannot read may change",
        "U=unset; X=a; $U X; $X pkill -f watcher",
      ],
    ],
  },
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      [
        "a copy into the root by a literal held past a cd's && chain",
        `cd /tmp && f=${ROOT}/x; cp /tmp/a "$f"`,
      ],
      [
        "a copy by a relative literal held past a cd into the root",
        `cd ${ROOT} && f=x; cp /tmp/a "$f"`,
      ],
      [
        "a copy by a literal held past a cd's && chain whose name the line set before",
        `f=${ROOT}/x; cd /tmp && f=/tmp/y; cp /tmp/a "$f"`,
      ],
      [
        "a copy by a value held past a cd's && chain that is not a literal",
        `cd /tmp && f=$(pwd)/x; cp /tmp/a "$f"`,
      ],
    ],
  },
]
