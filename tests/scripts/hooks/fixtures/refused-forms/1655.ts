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
    ],
  },
]
