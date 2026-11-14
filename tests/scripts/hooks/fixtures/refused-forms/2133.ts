import { type Group, NEVER_MADE } from "./_shared"

// #2133: an unquoted variable the line never sets expands to no word, so the word after it runs as the program; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["a kill by pattern behind an unset variable", "$X pkill -f watcher"],
      [
        "a kill by pattern behind an unset variable through run-slot",
        "~/.playground/ops/run-slot.sh w -- $X pkill -f watcher",
      ],
      ["a kill by name behind a braced unset variable", "${X} killall node"],
      ["a kill by pattern behind two unset variables", "$X $Y pkill -f watcher"],
      ["a kill by pattern behind a word of two unset variables", "$X$Y pkill -f watcher"],
      ["a kill by pattern behind nice and an unset variable", "nice $X pkill -f watcher"],
      ["a kill by pattern behind a quoted list of no arguments", '"$@" pkill -f watcher'],
      ["a kill by pattern behind a list of no arguments", "$@ pkill -f watcher"],
      ["a kill by pattern behind a joined list of no arguments", "$* pkill -f watcher"],
      [
        "a kill by pattern behind an unset variable with an empty default",
        "${X:-} pkill -f watcher",
      ],
      [
        "a kill by pattern behind an unset variable with an empty default for unset alone",
        "${X-} pkill -f watcher",
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["a commit behind an unset variable", "$X git commit -m x"],
      [
        "a commit behind an unset variable through run-slot",
        "~/.playground/ops/run-slot.sh w -- $X git commit -m x",
      ],
      [
        "a commit after a cd behind an unset variable, from a worktree",
        `$X cd ${MAIN} && git commit -m x`,
        "checkout",
      ],
    ],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [["a recursive delete behind an unset variable", `$X rm -rf ${NEVER_MADE}`]],
  },
]
