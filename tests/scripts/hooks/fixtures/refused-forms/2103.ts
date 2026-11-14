import type { Group } from "./_shared"

// #2103: a value-taking option the shared runner reader does not list had its value read as the program, so a later --cwd went unread; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: ({ CLI_DIR }) => [
      [
        "ext add by bun run past an unlisted option's value",
        `bun run --env-file /tmp/e bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
      [
        "ext add by bun run past its shell option's value",
        `bun run --shell bun bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
      [
        "ext add by npx past a cache option's value",
        `npx --cache /tmp/c bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
      [
        "ext add by npx past a workspace option's value",
        `npx -w pkg bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
      // a control, refused before this source's fix
      [
        "ext add by bunx past an env file option's value",
        `bunx --env-file /tmp/e bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
      [
        "ext add by bun x past bun's own env file option",
        `bun --env-file /tmp/e x bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
      [
        "ext add by bun past its own env file option",
        `bun --env-file /tmp/e --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
    ],
  },
  {
    folders: ["checkout", "home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: ({ CLI_DIR }) => [
      [
        "ext add by npx past a user config option's value",
        `npx --userconfig /tmp/u bun --cwd ${CLI_DIR} cli.ts ext add login list x y`,
      ],
    ],
  },
  {
    folders: ["checkout", "home", "main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "turbo's build in the main checkout by npx past a user config option's value",
        `npx --userconfig /tmp/u turbo run build --cwd ${MAIN}`,
      ],
    ],
  },
  {
    folders: ["checkout", "main checkout"],
    guards: ["no-unslotted-run"],
    rows: ({ MAIN }) => [
      [
        "turbo's build by npx past a user config option's value",
        `npx --userconfig /tmp/u turbo run build --cwd ${MAIN}/.claude/worktrees/a`,
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "bun's build past more unlisted options than the readings hold",
        "bun run --oa build --o0 v0 --o1 v1 --o2 v2 --o3 v3 --o4 v4 --o5 v5 --o6 v6 --o7 v7 --o8 v8 --o9 v9 --o10 v10 --o11 v11 --o12 v12 --o13 v13 --o14 v14",
      ],
      [
        "turbo's build by npx past more unlisted options than the readings hold",
        "npx --oa turbo --o0 v0 --o1 v1 --o2 v2 --o3 v3 --o4 v4 --o5 v5 --o6 v6 --o7 v7 --o8 v8 --o9 v9 --o10 v10 --o11 v11 --o12 v12 --o13 v13 --o14 v14 run build",
      ],
      // a control, refused before this source's fix
      [
        "bun's build past as many unlisted options as the readings hold",
        "bun run --oa build --o0 v0 --o1 v1 --o2 v2 --o3 v3 --o4 v4 --o5 v5 --o6 v6 --o7 v7 --o8 v8 --o9 v9 --o10 v10 --o11 v11 --o12 v12 --o13 v13",
      ],
    ],
  },
  {
    folders: ["checkout", "main checkout"],
    guards: ["no-unslotted-run"],
    rows: ({ MAIN }) => [
      [
        "bun's build past more unlisted options than the readings hold",
        `bun --cwd ${MAIN}/.claude/worktrees/a run --oa build --o0 v0 --o1 v1 --o2 v2 --o3 v3 --o4 v4 --o5 v5 --o6 v6 --o7 v7 --o8 v8 --o9 v9 --o10 v10 --o11 v11 --o12 v12 --o13 v13 --o14 v14`,
      ],
      // a control, refused before this source's fix
      [
        "bun's build past as many unlisted options as the readings hold",
        `bun --cwd ${MAIN}/.claude/worktrees/a run --oa build --o0 v0 --o1 v1 --o2 v2 --o3 v3 --o4 v4 --o5 v5 --o6 v6 --o7 v7 --o8 v8 --o9 v9 --o10 v10 --o11 v11 --o12 v12 --o13 v13`,
      ],
    ],
  },
]
