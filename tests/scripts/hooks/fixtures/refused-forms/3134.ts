import type { Group } from "./_shared"

// #3134: a kill name joined to a backslash escape, before or after it, that printf, echo -e or an ANSI-C string decodes into a word break, handed on by xargs; a watch xargs gives no program of its own; and an ANSI-C item a fill once read as a replacement pattern; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      [
        "a kill by name after a newline escape printf decodes, handed line by line to run-slot",
        "printf 'x\\npkill node\\n' | xargs -L1 ~/.playground/ops/run-slot.sh w --",
      ],
      [
        "a kill by name after a NUL escape printf decodes, read by xargs -0 into run-slot",
        "xargs -0 ~/.playground/ops/run-slot.sh w -- < <(printf 'x\\0pkill node')",
      ],
      [
        "a kill by name after a newline escape printf decodes, handed line by line to nohup",
        "printf 'x\\npkill node\\n' | xargs -L1 nohup",
      ],
      [
        "a kill by name after a newline escape printf decodes, handed line by line to sh -c",
        "printf 'x\\npkill node\\n' | xargs -L1 sh -c",
      ],
      [
        "a kill by name after a newline escape printf decodes, handed as sh -c's -I string",
        "printf 'x\\npkill node\\n' | xargs -L1 -I{} sh -c {}",
      ],
      [
        "a kill by name after a NUL escape printf decodes, read by xargs -0 into nohup",
        "xargs -0 nohup < <(printf 'x\\0pkill node')",
      ],
      [
        "a kill by name after a NUL escape printf decodes, read by xargs -0 into sh -c",
        "xargs -0 sh -c < <(printf 'x\\0pkill node')",
      ],
      [
        "a kill by name after a NUL escape printf decodes, handed as sh -c's -I string",
        "xargs -0 -I{} sh -c {} < <(printf 'x\\0pkill node')",
      ],
      [
        "a kill by name after a newline escape in an ANSI-C here-string, read by xargs into nohup",
        "xargs nohup <<< $'x\\npkill node'",
      ],
      [
        "a kill by name after a newline escape in an ANSI-C here-string, handed line by line to run-slot",
        "xargs -L1 ~/.playground/ops/run-slot.sh w -- <<< $'x\\npkill node'",
      ],
      [
        "a kill by name after a newline escape echo -e decodes, handed line by line to run-slot",
        "echo -e 'x\\npkill node' | xargs -L1 ~/.playground/ops/run-slot.sh w --",
      ],
      [
        "a kill by name xargs hands watch, given no program of its own",
        "xargs watch <<< 'pkill node'",
      ],
      [
        "a kill name a NUL escape ends, printf's output read by xargs -0 into nohup",
        "printf 'pkill\\0node' | xargs -0 nohup",
      ],
      [
        "a kill name a newline escape ends, printf's output read by xargs into nohup",
        "printf 'pkill\\nnode\\n' | xargs nohup",
      ],
      [
        "a kill name a tab escape ends, echo -e's output read by xargs into nohup",
        "echo -e 'pkill\\tnode' | xargs nohup",
      ],
      [
        "a kill name a hex blank escape ends, printf's output read by xargs into nohup",
        "printf 'pkill\\x20node' | xargs nohup",
      ],
      [
        "a kill name an octal blank escape ends, printf's output appended to sh -c by xargs",
        "printf 'pkill\\040node' | xargs sh -c",
      ],
      [
        "a kill name a newline escape ends in an ANSI-C here-string, read by xargs into nohup",
        "xargs nohup <<< $'pkill\\nnode'",
      ],
      [
        "a kill name between two NUL escapes, filled into sh -c's -I script by xargs -0",
        "printf 'x\\0pkill\\0node' | xargs -0 -I{} sh -c '{} node'",
      ],
      [
        "a kill name a NUL escape ends, a process substitution read by xargs -0 into nohup",
        "xargs -0 nohup < <(printf 'pkill\\0node')",
      ],
      [
        "a kill name an ANSI-C string spells, an item xargs -0 fills into sh -c's -I script",
        "xargs -0 -I{} sh -c {} < <(printf 'x\\0$'\"'\"'\\\\x70kill'\"'\"' node')",
      ],
    ],
  },
  {
    folders: ["process home"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "an append to the roster an ANSI-C string spells, an item xargs fills into sh -c's -I script",
        "xargs -I{} sh -c 'echo x >> {}' <<< '$'\"'\"'\\x7e/.playground/roster.json'\"'\"''",
      ],
    ],
  },
]
