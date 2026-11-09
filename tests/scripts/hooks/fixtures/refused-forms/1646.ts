import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // bun x and bunx run their tool in the folder bun's own --cwd names, so a worktree's line aimed at the main checkout by it builds there
  {
    folders: ["worktree"],
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
    ],
  },
]
