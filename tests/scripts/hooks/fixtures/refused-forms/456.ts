import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-desktop-owner-app"],
    rows: () => [
      ["the tool behind watch", "watch agent-desktop click @s1:e2 --headed"],
      ["the tool behind watch -n", "watch -n 1 agent-desktop snapshot --app Slack"],
      [
        "the tool behind flock and its lock file",
        "flock /tmp/x agent-desktop click @s1:e2 --headed",
      ],
      [
        "the tool behind flock -w and its lock file",
        "flock -w 5 /tmp/x agent-desktop snapshot --app Slack",
      ],
      ["the tool behind setsid", "setsid agent-desktop click @s1:e2 --headed"],
      ["the tool behind nohup setsid", "nohup setsid agent-desktop click @s1:e2 --headed"],
      ["the tool behind setsid nohup", "setsid nohup agent-desktop snapshot --app Slack"],
      [
        "the tool behind watch and flock",
        "watch -n 1 flock /tmp/x agent-desktop click @s1:e2 --headed",
      ],
      ["the tool in watch's quoted line", `watch -n 1 'agent-desktop click @s1:e2 --headed'`],
      ["the tool in a line watch joins from two words", `watch 'agent-desktop launch' Slack`],
      [
        "a second call in a line watch joins",
        `watch agent-desktop launch 'Finder; agent-desktop launch Slack'`,
      ],
      ["the tool in flock -c's line", `flock /tmp/x -c 'agent-desktop click @s1:e2 --headed'`],
      ["the tool behind sh -c behind setsid", `setsid sh -c 'agent-desktop snapshot --app Slack'`],
      [
        "the tool behind watch --interval, a long value-taking option",
        "watch --interval 1 agent-desktop snapshot --app Slack",
      ],
      [
        "the tool behind setsid nested in flock",
        "flock /tmp/x setsid agent-desktop click @s1:e2 --headed",
      ],
    ],
  },
]
