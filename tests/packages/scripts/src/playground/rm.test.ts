import { expect, test } from "bun:test"

import { RM_USAGE, rmArgs } from "../../../../../packages/scripts/src/playground/rm"

test("rm takes one path, or --worktree's, with an optional reason", () => {
  expect(rmArgs(["old"])).toEqual({ path: "old", reason: "playground rm", worktree: false })
  expect(rmArgs(["--worktree", "wt", "--reason", "merged"])).toEqual({
    path: "wt",
    reason: "merged",
    worktree: true,
  })
})

test("rm takes --list or --restore <id> alone", () => {
  expect(rmArgs(["--list"])).toEqual({ list: true })
  expect(rmArgs(["--restore", "20261102T120000Z-s/1"])).toEqual({ restore: "20261102T120000Z-s/1" })
})

test.each([
  [[]],
  [["a", "b"]],
  [["--worktree"]],
  [["--force", "a"]],
  [["--list", "a"]],
  [["a", "--worktree", "b"]],
])("rm refuses %j with its usage", (words) => {
  expect(rmArgs(words)).toEqual({ error: RM_USAGE })
})
