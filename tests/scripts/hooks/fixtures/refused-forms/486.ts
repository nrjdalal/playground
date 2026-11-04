import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["main checkout"],
    guards: ["no-desktop-owner-app"],
    rows: () => [
      [
        "bun run ask with a prose arg that only names the tool",
        `bun run ask ack '#i2' --no-link "local install; agent-desktop 1.0.2 runs with both grants; ok"`,
      ],
      [
        "bun run thread with a prose arg that only names the tool",
        `bun run thread title t1 "note: agent-desktop 1.0.2 runs with both grants; ok"`,
      ],
      ["the tool as bun run's target", "bun run agent-desktop snapshot --app Slack"],
      ["the tool as bunx's target", "bunx agent-desktop snapshot --app Slack"],
      ["the tool as bun x's target", "bun x agent-desktop snapshot --app Slack"],
      [
        "an unlisted bun run script with a prose arg that names the tool",
        `bun run build ack '#i2' --no-link "local install; agent-desktop 1.0.2 runs with both grants; ok"`,
      ],
      [
        "a listed bun run script with a command-substitution arg that runs the tool",
        `bun run ask x "$(agent-desktop launch Slack)"`,
      ],
      [
        "a listed bun run script with an argument built from a variable",
        `bun run ask x "note: agent-desktop $BUILD ok"`,
      ],
      [
        "bun run ask with a prose arg, in a byte-identical linked worktree",
        `bun run ask x "note; agent-desktop 1.0 ok"`,
        "worktree",
      ],
      [
        "bun run thread with a prose arg, in a byte-identical linked worktree",
        `bun run thread title t1 "note; agent-desktop 1.0 ok"`,
        "worktree",
      ],
      [
        "bun run ask with a prose arg, in a folder with no Playground package.json",
        `bun run ask x "note; agent-desktop 1.0 ok"`,
        "home",
      ],
      [
        "bun run thread with a prose arg, in a folder with no Playground package.json",
        `bun run thread title t1 "note; agent-desktop 1.0 ok"`,
        "home",
      ],
    ],
  },
]

export const allowed: string[] = [
  "bun run ask with a prose arg that only names the tool",
  "bun run thread with a prose arg that only names the tool",
]
