import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // bun x and bunx run their tool in the folder bun's own --cwd names, so a worktree's line aimed at the main checkout by it builds there
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["turbo through bunx by its --cwd", `bunx --cwd=${MAIN} turbo run build`],
      ["turbo through bun x by its --cwd", `bun x --cwd=${MAIN} turbo run build`],
      ["turbo through bun x by bun's --cwd before x", `bun --cwd=${MAIN} x turbo run build`],
      ["lefthook through bunx by its --cwd", `bunx --cwd=${MAIN} lefthook run pre-commit`],
      [
        "the packages build through bunx by its --cwd, its settings left out",
        `bunx --cwd=${MAIN} turbo run build --filter='./packages/*'`,
      ],
      ["turbo at a version through bunx by its --cwd", `bunx --cwd=${MAIN} turbo@latest run build`],
      [
        "turbo at a version through bun x by its --cwd",
        `bun x --cwd=${MAIN} turbo@latest run build`,
      ],
      ["turbo at a version through bun x by bun's --cwd", `bun --cwd=${MAIN} x turbo@2 run build`],
    ],
  },
  // bun run, bun test and a bare script read each --cwd from the shell's folder, the last one winning (bun 1.4.4, measured), so a later --cwd of . lands back in the main checkout
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a build past a later --cwd of .", "bun --cwd=.claude/worktrees/a --cwd=. run build"],
      ["a test run past a later --cwd of .", "bun --cwd=.claude/worktrees/a --cwd=. run test"],
      [
        "check-types past a later --cwd of .",
        "bun --cwd=.claude/worktrees/a --cwd=. run check-types",
      ],
      ["bun test past a later --cwd of .", "bun --cwd=.claude/worktrees/a --cwd=. test"],
    ],
  },
  // the same last-one-wins reading from a worktree keeps a build there a heavy run
  {
    folders: ["checkout"],
    guards: ["no-unslotted-run"],
    rows: () => [
      ["a build past a later --cwd into the worktree", "bun --cwd=../../.. --cwd=api run build"],
    ],
  },
  // bun x and bunx read each relative --cwd from the one before it, and a --cwd it cannot read leaves the line judged in the shell's folder
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "turbo through bunx, a second --cwd climbing back",
        "bunx --cwd=.claude/worktrees/a --cwd=../../.. turbo run build",
      ],
      [
        "turbo through bun x, a second --cwd climbing back",
        "bun x --cwd=.claude/worktrees/a --cwd=../../.. turbo run build",
      ],
      [
        "turbo through bun x, a --cwd after x climbing back from bun's",
        "bun --cwd=.claude/worktrees/a x --cwd=../../.. turbo run build",
      ],
      [
        "lefthook through bunx, a second --cwd climbing back",
        "bunx --cwd=.claude/worktrees/a --cwd=../../.. lefthook run pre-commit",
      ],
      [
        "turbo through bunx, spaced --cwd words climbing back",
        "bunx --cwd .claude/worktrees/a --cwd ../../.. turbo run build",
      ],
      ["turbo through bunx by a --cwd of a substitution", "bunx --cwd=$(pwd) turbo run build"],
      ["turbo through bunx by a --cwd of a variable", "bunx --cwd=$UNSET_DIR turbo run build"],
      [
        "turbo through bun x by bun's --cwd of a substitution",
        "bun --cwd=$(pwd) x turbo run build",
      ],
      [
        "lefthook through bunx by a --cwd of a substitution",
        "bunx --cwd=$(pwd) lefthook run pre-commit",
      ],
    ],
  },
  // a heavy run in a worktree named by bun x's or bunx's --cwd goes through run-slot, as one typed there does
  {
    folders: ["main checkout"],
    guards: ["no-unslotted-run"],
    rows: ({ MAIN }) => [
      [
        "turbo through bunx into a worktree by a spaced --cwd",
        "bunx --cwd .claude/worktrees/a turbo run build",
      ],
      [
        "turbo through bunx into a worktree by a spaced absolute --cwd",
        `bunx --cwd ${MAIN}/.claude/worktrees/a turbo run build`,
      ],
      [
        "turbo through bunx in a worktree by a spaced absolute --cwd",
        `bunx --cwd ${MAIN}/.claude/worktrees/a turbo run build`,
        "checkout",
      ],
      ["turbo through bunx into a worktree", "bunx --cwd=.claude/worktrees/a turbo run build"],
      ["turbo through bun x into a worktree", "bun x --cwd=.claude/worktrees/a turbo run build"],
      [
        "turbo through bun x into a worktree by bun's --cwd",
        "bun --cwd=.claude/worktrees/a x turbo run build",
      ],
      [
        "check-types through bunx into a worktree",
        "bunx --cwd=.claude/worktrees/a turbo run check-types",
      ],
    ],
  },
]
