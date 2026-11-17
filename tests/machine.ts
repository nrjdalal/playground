import { test } from "bun:test"

import { originRepo } from "../packages/scripts/src/playground/setting"

// What a row needs from the machine it runs on, each the reason it cannot run here or undefined; the runner host's run clone has neither, while GitHub CI's checkout has its origin and its Suite shards install zsh.
export const NO_ORIGIN = originRepo()
  ? undefined
  : "the checkout has no GitHub origin; GitHub CI and a local run cover this row"
// zsh on the PATH a row's child gets, this process's unless the row names its own, since Bun finds a child's program on the PATH its own env holds.
export const noZsh = (PATH?: string) =>
  Bun.which("zsh", { PATH: PATH ?? process.env.PATH ?? "" })
    ? undefined
    : `zsh not on ${PATH ? `PATH ${PATH}` : "PATH"}; GitHub CI (install-zsh) and a local run cover this row`

// Pure: a row runs when nothing it needs is missing, skips when something is, and fails under CI, which provides every need, so a lost install reads red there.
export const rowMode = (reason: string | undefined, ci: string | undefined) =>
  !reason ? "run" : ci ? "fail" : "skip"

// test(), unless the machine lacks what the row needs: then a skip whose name gives the reason, or under CI a failure naming it.
export const machineTest = (
  reason: string | undefined,
  name: string,
  fn: () => void | Promise<unknown>,
) => {
  const mode = rowMode(reason, process.env.CI)
  if (mode === "run") return test(name, fn)
  if (mode === "skip") return test.skip(`${name} (skipped: ${reason})`, fn)
  return test(name, () => {
    throw new Error(`${reason}, but CI runs it: this machine lacks what CI provides`)
  })
}
