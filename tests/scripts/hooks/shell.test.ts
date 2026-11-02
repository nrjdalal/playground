import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { GIT_TAKES } from "../../../scripts/hooks/shell"

const HOOKS = join(import.meta.dir, "..", "..", "..", "scripts", "hooks")

describe("git's value-taking options live in one list", () => {
  test("GIT_TAKES holds every option git 2.56 steps over before its subcommand", () => {
    expect([...GIT_TAKES].sort()).toEqual([
      "--attr-source",
      "--config-env",
      "--exec-path",
      "--git-dir",
      "--namespace",
      "--work-tree",
      "-C",
      "-c",
    ])
  })

  test("no hook keeps a copy of its own", () => {
    const copies = readdirSync(HOOKS)
      .filter((file) => file.endsWith(".ts") && file !== "shell.ts")
      .filter((file) => readFileSync(join(HOOKS, file), "utf8").includes('"--namespace"'))
    expect(copies).toEqual([])
  })
})
