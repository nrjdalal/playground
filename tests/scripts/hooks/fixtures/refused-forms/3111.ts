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
      [
        "a kill by name watch's shell line runs after -d takes the x as its value",
        "watch -dx 'pkill node'",
      ],
      ["a kill by name watch's shell line runs after a flag and -d's x", "watch -bdx 'pkill node'"],
      ["a kill by name watch's shell line runs after -e and -d's x", "watch -edx 'pkill node'"],
      ["killall in watch's shell line after a flag and -d's x", "watch -bdx 'killall node'"],
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
      [
        "bash reading a relative stdin path after a logical cd up to the root",
        `cd /tmp/.. && bash dev/stdin <<< 'touch ${LIST}'`,
      ],
      [
        "bash reading a relative stdin path after cd -L up to the root",
        `cd -L /tmp/.. && bash dev/stdin <<< 'touch ${LIST}'`,
      ],
      [
        "bash reading a relative stdin path after a logical cd up from /etc",
        `cd /etc/.. && bash dev/stdin <<< 'touch ${LIST}'`,
      ],
      [
        "bash reading a relative stdin path after a pushd up to the root",
        `pushd /tmp/.. && bash dev/stdin <<< 'touch ${LIST}'`,
      ],
      [
        "bash reading stdin by its name after a logical cd into /dev",
        `cd /tmp/../dev && bash stdin <<< 'touch ${LIST}'`,
      ],
      [
        "bash reading stdin by its name after a logical cd from /var into /dev",
        `cd /var/../dev && bash stdin <<< 'touch ${LIST}'`,
      ],
    ],
  },
]
