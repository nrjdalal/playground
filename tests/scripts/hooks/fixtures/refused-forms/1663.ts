import { join } from "node:path"

import { type Group } from "./_shared"

// #1663: git changes into each -C as the kernel does, following a link before a `..`; the worktrees folder and a plain folder in it sit in no worktree, so git, turbo and bun walk up to the main checkout from there; a command after a cd's `||` runs only where the cd failed; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ TREE_LINK }) => [
      [
        "a commit by a -C read from a link into the main checkout",
        "git -C into-main -C .. commit -m x",
      ],
      [
        "a commit by a -C read from a link named by its absolute path",
        `git -C ${TREE_LINK} -C .. commit -m x`,
      ],
      ["a commit by one -C that climbs out of a link", `git -C ${TREE_LINK}/.. commit -m x`],
      [
        "a reset by a --work-tree read from a link into the main checkout",
        "git -C into-main --work-tree=.. reset --hard",
      ],
      ["a commit after a cd that climbs to the worktrees folder", "cd .. && git commit -m x"],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["a commit by -C in the worktrees folder", "git -C .claude/worktrees commit -m x"],
      [
        "a commit by -C in a plain folder of the worktrees folder",
        "git -C .claude/worktrees/plain commit -m x",
      ],
      ["turbo by its --cwd in the worktrees folder", "turbo run build --cwd=.claude/worktrees"],
      [
        "turbo by its --cwd in a plain folder of the worktrees folder",
        "turbo run build --cwd=.claude/worktrees/plain",
      ],
      ["a build after a cd into the worktrees folder", "cd .claude/worktrees && bun run build"],
      [
        "a commit that runs only when the cd before its || failed",
        `cd ${join(MAIN, ".claude", "worktrees", "a")} || git commit -m x`,
      ],
      [
        "turbo by bunx --cwd that runs only when the cd before its || failed",
        `cd ${join(MAIN, ".claude", "worktrees", "a")} || bunx --cwd=api turbo run build`,
      ],
    ],
  },
]
