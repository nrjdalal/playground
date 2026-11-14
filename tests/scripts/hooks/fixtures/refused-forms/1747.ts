import { type Group } from "./_shared"

// What bun x runs, read as bun runs it: the tool after an option's value stands in for x, any program in the runner's folder, next build's folder, and the CLI in the folder bun x runs it in; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // the main checkout runs no turbo, build or commit, whichever program bun x runs in it
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "bun x after an option's value that stands in for x",
        `bun --env-file x --cwd=/ --cwd=${MAIN.slice(1)} x turbo run build`,
      ],
      ["bunx running bun's build in its --cwd", `bunx --cwd=${MAIN} bun run build`],
      [
        "bunx running bun's build in a --cwd read from the one before",
        `bunx --cwd=/ --cwd=${MAIN.slice(1)} bun run build`,
      ],
      [
        "bunx running a commit in a --cwd read from the one before",
        `bunx --cwd=/ --cwd=${MAIN.slice(1)} git commit -m x`,
      ],
    ],
  },
  // a worktree's build takes a run-slot, whichever program bun x runs there and whichever folder next build names
  {
    folders: ["main checkout"],
    guards: ["no-unslotted-run"],
    rows: ({ MAIN }) => [
      [
        "bunx running bun's build in a --cwd in a worktree read from the one before",
        `bunx --cwd=/ --cwd=${MAIN.slice(1)}/.claude/worktrees/a bun run build`,
      ],
      ["bunx next build naming a worktree", `bunx next build ${MAIN}/.claude/worktrees/a`],
    ],
  },
  // the CLI that bunx or bun x starts is read in the folder their --cwd options chain to, each read from the one before
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: ({ CLI_DIR }) => [
      [
        "ext add by bun x bun in a runner --cwd read from bun's own",
        `bun --cwd=${CLI_DIR.slice(0, -"/playground".length)} x --cwd=playground bun cli.ts ext add login list x y`,
      ],
      [
        "ext add by bun x bun in a runner --cwd read from the one before",
        `bun x --cwd=${CLI_DIR.slice(0, -"/scripts/src/playground".length)} --cwd=scripts/src/playground bun cli.ts ext add login list x y`,
      ],
      [
        "ext add by bunx bun in a --cwd read from the one before",
        `bunx --cwd=${CLI_DIR.slice(0, -"/scripts/src/playground".length)} --cwd=scripts/src/playground bun cli.ts ext add login list x y`,
      ],
      [
        "ext add by bunx bun in its --cwd",
        `bunx --cwd=${CLI_DIR} bun cli.ts ext add login list x y`,
      ],
    ],
  },
]
