import type { Group } from "./_shared"

// #3134: a kill name typed straight after a backslash escape that printf, echo -e or an ANSI-C string decodes into a word break, handed on by xargs; rows are data, as refused-forms.ts says.
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
    ],
  },
]
