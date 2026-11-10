import { type Group } from "./_shared"

// #1653's round 8: a bunx --cwd typed from the main checkout that names a worktree another repository lists ran turbo there, once the hook trusted any worktree whose .git file and admin gitdir point at each other; canary runs bun x in the shell's own folder, so both stay refused.
export const groups: Group[] = [
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ FOREIGN_TREE, FOREIGN_TREE_IN_MAIN }) => [
      [
        "turbo by bunx --cwd= to a worktree another repository lists, outside the main checkout",
        `bunx --cwd=${FOREIGN_TREE} turbo run build`,
      ],
      [
        "turbo by bunx --cwd= to a worktree another repository lists, under the main checkout's .claude/worktrees",
        `bunx --cwd=${FOREIGN_TREE_IN_MAIN} turbo run build`,
      ],
    ],
  },
]
