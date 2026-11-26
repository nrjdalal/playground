import { type Group } from "./_shared"

// #3102: a wrapper reads its argv, where a quote or a backslash is already gone, so a quoted or escaped option or separator is still its own (flock's -c and --command, mise x's --); rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["a kill by name in flock's escaped shell string option", "flock \\/tmp/l \\-c 'pkill node'"],
      ["a kill by name in flock's quoted shell string option", "flock /tmp/l '-c' 'pkill node'"],
      [
        "a kill by name in flock's escaped long shell string option",
        "flock \\-w \\5 \\/tmp/l \\--command 'pkill node'",
      ],
      [
        "a kill by name mise x runs after a tool and an escaped separator",
        "mise \\x \\node@20 \\-- \\pkill \\node",
      ],
      [
        "a kill by name mise x runs after a tool and a quoted separator",
        "mise x node@20 '--' pkill node",
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-desktop-owner-app"],
    rows: () => [
      [
        "the tool in flock's escaped -c line",
        "flock \\/tmp/x \\-c 'agent-desktop click @s1:e2 --headed'",
      ],
    ],
  },
]
