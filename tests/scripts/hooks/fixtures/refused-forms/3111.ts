import { type Group } from "./_shared"

// #3111: a wrapper's command option with its text attached, mise's command option after a tool, the command watch reruns, and a relative stdin path after a move to the root folder; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      [
        "a kill by name in flock's quoted long option with its text attached",
        "flock /tmp/l '--command=pkill node'",
      ],
      [
        "a kill by name in flock's long option with its quoted text attached",
        "flock /tmp/l --command='pkill node'",
      ],
      [
        "a kill by name in flock's quoted short option with its text attached",
        "flock /tmp/l '-cpkill node'",
      ],
      [
        "a kill by name in flock's short option with its quoted text attached",
        "flock /tmp/l -c'pkill node'",
      ],
      [
        "a kill by name in mise x's quoted command option after a tool",
        "mise x node@20 '-c' 'pkill node'",
      ],
      ["a kill by name in mise x's command option after a tool", "mise x node@20 -c 'pkill node'"],
      ["a kill by name watch reruns after its quoted interval option", "watch '-n' 1 pkill node"],
      ["a kill by name watch reruns after its interval option", "watch -n 1 pkill node"],
      ["a kill by name watch reruns", "watch pkill node"],
    ],
  },
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ LIST }) => [
      [
        "bash reading a relative stdin path from env -C's root folder",
        `env -C / bash dev/stdin <<< 'touch ${LIST}'`,
      ],
      [
        "bash reading a relative stdin path after a cd to the root folder",
        `cd / && bash dev/stdin <<< 'touch ${LIST}'`,
      ],
    ],
  },
]
