import { type Group, NEVER_MADE } from "./_shared"

// #2127: a command held in a shell variable, which bash, and zsh under sh_word_split, splits into the words it runs; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["a kill by pattern held in a variable run as the command", 'C="pkill -f watcher"; $C'],
      ["a kill by name held in a variable run as the program", "P=pkill; $P -f watcher"],
      [
        "a kill by pattern after run-slot's session name and separator held in a variable",
        'W="w --"; ~/.playground/ops/run-slot.sh $W pkill -f watcher',
      ],
      [
        "a kill by pattern whose program run-slot's session name variable holds",
        'W="w -- pkill"; ~/.playground/ops/run-slot.sh $W -- -f watcher',
      ],
      [
        "a kill by pattern held with run-slot's separator in a variable",
        'A="-- pkill -f watcher"; ~/.playground/ops/run-slot.sh w $A',
      ],
      [
        "a kill by pattern held with run-slot's option and separator in a variable",
        'A="--after 5 -- pkill -f watcher"; ~/.playground/ops/run-slot.sh w $A',
      ],
      [
        "a kill by pattern held in run-slot's session name variable",
        'W="w -- pkill -f watcher"; ~/.playground/ops/run-slot.sh $W -- true',
      ],
      [
        "a kill by pattern held in run-slot's session name variable set by export",
        'export W="w -- pkill -f watcher"; ~/.playground/ops/run-slot.sh $W -- true',
      ],
    ],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a recursive delete held with run-slot's separator in a variable",
        `A="-- rm -rf ${NEVER_MADE}"; ~/.playground/ops/run-slot.sh w $A`,
      ],
      [
        "a recursive delete held with run-slot's option and separator in a variable",
        `A="--after 5 -- rm -rf ${NEVER_MADE}"; ~/.playground/ops/run-slot.sh w $A`,
      ],
      [
        "a recursive delete held in run-slot's session name variable",
        `W="w -- rm -rf ${NEVER_MADE}"; ~/.playground/ops/run-slot.sh $W -- true`,
      ],
      [
        "a recursive delete held in run-slot's session name variable set by export",
        `export W="w -- rm -rf ${NEVER_MADE}"; ~/.playground/ops/run-slot.sh $W -- true`,
      ],
    ],
  },
]
