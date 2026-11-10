import { type Group } from "./_shared"

// The package runners' -p and @version forms of turbo and lefthook, through bunx, bun x and npx; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // the main checkout runs no turbo or lefthook, whichever package or version names the tool
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["bunx with -p naming turbo at a version", "bunx -p turbo@2 turbo run build"],
      ["bunx running turbo at a version", "bunx turbo@latest run build"],
      ["bun x running turbo at a version", "bun x turbo@latest run build"],
      ["bunx running lefthook at a version", "bunx lefthook@latest run pre-commit"],
      ["bun x with -p naming another package before turbo", "bun x -p lefthook turbo run build"],
      ["npx running turbo at a version", "npx turbo@latest run build"],
      ["npx -y running turbo at a version", "npx -y turbo@latest run build"],
      ["npx with -p naming turbo", "npx -p turbo turbo run build"],
      ["npx with -p naming turbo at a version", "npx -p turbo@2 turbo run build"],
      ["npx with --package naming turbo", "npx --package turbo turbo run build"],
      ["npx with --package= naming turbo", "npx --package=turbo turbo run build"],
      ["npx with -p and -- before turbo", "npx -p turbo -- turbo run build"],
      ["npx running lefthook at a version", "npx lefthook@latest run pre-commit"],
      [
        "bunx with -p naming turbo and a --cwd into a worktree before it",
        "bunx -p turbo --cwd=.claude/worktrees/a turbo run build",
      ],
      ["bunx past --env-file's value", "bunx --env-file .env turbo run build"],
      ["bunx past --registry's value", "bunx --registry https://registry.example turbo run build"],
    ],
  },
  // -p and --package put the package's programs on PATH, and the runner may run any program there, so naming turbo or lefthook is running it
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["bunx -p turbo then sh -c", "bunx -p turbo sh -c 'turbo run build'"],
      ["bun x -p turbo then bash -c", "bun x -p turbo bash -c 'turbo run build'"],
      ["bunx -p lefthook then sh -c", "bunx -p lefthook sh -c 'lefthook install'"],
      ["bunx -p lefthook then bash -c", "bunx -p lefthook bash -c 'lefthook install'"],
      ["bunx -p turbo then env", "bunx -p turbo env turbo run build"],
      ["bunx -p turbo then nohup", "bunx -p turbo nohup turbo run build"],
      ["bunx -p turbo then command", "bunx -p turbo command turbo run build"],
      ["bunx -p turbo then time", "bunx -p turbo time turbo run build"],
      ["bunx -p turbo then xargs", "bunx -p turbo xargs turbo run build"],
      ["bunx --package turbo then sh -c", "bunx --package turbo sh -c 'turbo run build'"],
      ["bunx --package=turbo then sh -c", "bunx --package=turbo sh -c 'turbo run build'"],
      ["bunx -p turbo@2 then sh -c", "bunx -p turbo@2 sh -c 'turbo run build'"],
      ["bunx -p turbo alone", "bunx -p turbo"],
      ["bunx -p turbo then --version", "bunx -p turbo --version"],
      ["bunx -p turbo then another program", "bunx -p turbo foo"],
      ["bunx -p lefthook then install", "bunx -p lefthook install"],
      ["bun x with two -p, lefthook second", "bun x -p turbo -p lefthook foo"],
      ["bunx -p turbo then a path past turbo@latest", "bunx -p turbo turbo@latest/x run build"],
      ["bunx -p turbo then next", "bunx -p turbo next build"],
      ["bun x -p lefthook then next", "bun x -p lefthook next build"],
      ["npx -p turbo then -c", "npx -p turbo -c 'turbo run build'"],
      ["npx -p turbo then --call", "npx -p turbo --call 'turbo run build'"],
      ["npx -p turbo then sh -c", "npx -p turbo sh -c 'turbo run build'"],
    ],
  },
  // a worktree's turbo run takes a run-slot, whichever package runner and package option names it
  {
    folders: ["checkout"],
    guards: ["no-unslotted-run"],
    rows: () => [
      ["bunx with -p naming turbo", "bunx -p turbo turbo run build"],
      ["bun x with -p naming turbo", "bun x -p turbo turbo run build"],
      ["bun x with -p naming another package before turbo", "bun x -p lefthook turbo run build"],
      ["bunx with -p naming turbo at a version", "bunx -p turbo@2 turbo run build"],
      ["npx with -p naming turbo", "npx -p turbo turbo run build"],
      ["bun x --package turbo then env", "bun x --package turbo env turbo run build"],
      ["bun x -p turbo running its run task", "bun x -p turbo run build"],
    ],
  },
]
