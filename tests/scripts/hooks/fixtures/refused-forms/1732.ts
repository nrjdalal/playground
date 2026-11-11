import { type Group } from "./_shared"

// A package runner's folders as bun runs them (each --cwd from the one before, bun's own before x included, a tool's relative --cwd from them) and a turbo build inside a shell -p puts turbo beside; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // the main checkout runs no turbo or lefthook, whichever folder option of bun's or the runner's names it
  {
    folders: ["checkout", "home"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["bun's own --cwd at the main checkout before x", `bun --cwd=${MAIN} x turbo run build`],
      [
        "bun's own spaced --cwd at the main checkout before x",
        `bun --cwd ${MAIN} x lefthook install`,
      ],
      [
        "turbo's relative --cwd read from the runner's",
        `bunx --cwd=/ turbo run build --cwd=${MAIN.slice(1)}`,
      ],
      [
        "turbo's relative --cwd read from bun x's after -p",
        `bun x -p turbo --cwd=/ turbo run build --cwd=${MAIN.slice(1)}`,
      ],
      [
        "a runner --cwd read from the one before it",
        `bunx --cwd=/ --cwd=${MAIN.slice(1)} turbo run build`,
      ],
      ["a runner --cwd the hook cannot read", `bunx -p turbo --cwd="$D" turbo run build`],
    ],
  },
  // a worktree's build takes a run-slot, whichever folder option of bun's or the runner's takes it there
  {
    folders: ["main checkout"],
    guards: ["no-unslotted-run"],
    rows: ({ MAIN }) => [
      [
        "bunx next build with its --cwd in a worktree",
        `bunx --cwd ${MAIN}/.claude/worktrees/a next build`,
      ],
      [
        "bunx -p next with its --cwd in a worktree",
        `bunx --cwd=${MAIN}/.claude/worktrees/a -p next next build`,
      ],
      [
        "bun's own --cwd in a worktree before x turbo",
        `bun --cwd=${MAIN}/.claude/worktrees/a x turbo run build`,
      ],
      [
        "bunx -p turbo with its --cwd in a worktree then sh -c",
        `bunx -p turbo --cwd=${MAIN}/.claude/worktrees/a sh -c 'turbo run build'`,
      ],
    ],
  },
  // a shell or program the runner runs with turbo on PATH runs turbo's build as its own words do
  {
    folders: ["checkout"],
    guards: ["no-unslotted-run"],
    rows: () => [
      ["bunx -p turbo then sh -c", "bunx -p turbo sh -c 'turbo run build'"],
      ["bun x -p turbo then bash -c", "bun x -p turbo bash -c 'turbo run check-types'"],
      ["npx -p turbo then sh -c", "npx -p turbo sh -c 'turbo run build'"],
      ["npx -p turbo then -c", "npx -p turbo -c 'turbo run build'"],
      [
        "bunx --package=turbo then sh -c after a light turbo call",
        "bunx --package=turbo sh -c 'turbo --version; turbo run test'",
      ],
      ["bunx -p next then sh -c", "bunx -p next sh -c 'next build'"],
      ["bunx -p next then env", "bunx -p next env next build"],
      ["bun x -p next then bash -c", "bun x -p next bash -c 'cd . && next build'"],
      ["npx -p next then sh -c", "npx -p next sh -c 'next build'"],
      ["bunx -p turbo then sh -c with a quoted task", `bunx -p turbo sh -c 'turbo run "build"'`],
      [
        "bunx -p turbo then sh -c with an empty quote in the task",
        `bunx -p turbo sh -c 'turbo run bu""ild'`,
      ],
      [
        "bunx -p turbo then sh -c with a redirect glued to the task",
        "bunx -p turbo sh -c 'turbo run build>log'",
      ],
      ["bunx -p next then sh -c with a quoted build", `bunx -p next sh -c 'next "build"'`],
      [
        "bunx -p next then sh -c with a redirect glued to build",
        "bunx -p next sh -c 'next build>log'",
      ],
      ["npx -p next then sh -c with a single-quoted build", `npx -p next sh -c "next 'build'"`],
      // a script beside -p is read as a line of its own, so turbo's --dry-run in it excuses no other command there
      [
        "bunx -p turbo then sh -c with a dry run",
        "bunx -p turbo sh -c 'turbo run build --dry-run'",
      ],
    ],
  },
]
